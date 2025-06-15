from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import uuid
import os
import time
from typing import Dict, Any
import asyncio

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

players: Dict[str, Any] = {}
wall_display_content = 'Welcome to AWorld!'
CHAT_EXPIRY_SECONDS = 15
GRAVITY = 0.02  # units per tick
JUMP_VELOCITY = 0.25  # units per jump
connected_websockets = set()

# Utility: send to all, removing closed sockets
async def safe_broadcast(message):
    to_remove = set()
    for ws in connected_websockets:
        try:
            await ws.send_json(message)
        except Exception:
            to_remove.add(ws)
    for ws in to_remove:
        connected_websockets.remove(ws)

# Store active players with position, vertical velocity, and chat info
players = {}

# --- Wall Display State ---
wall_display_content = 'Welcome to AWorld!'

CHAT_EXPIRY_SECONDS = 15
GRAVITY = 0.02  # units per tick
JUMP_VELOCITY = 0.25  # units per jump

def prune_expired_chats():
    now = time.time()
    for p in players.values():
        if 'chat_expiry' in p and p['chat_expiry'] and p['chat_expiry'] < now:
            p['chat_message'] = ''
            p['chat_expiry'] = None

async def broadcast_global_state():
    prune_expired_chats()
    await safe_broadcast({"event": "global_state_update", "players": list(players.values())})

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# API to update wall display (admin or server-side only)
from pydantic import BaseModel

class WallDisplayRequest(BaseModel):
    content: str

@app.post("/api/wall_display")
async def update_wall_display(req: WallDisplayRequest):
    global wall_display_content
    wall_display_content = req.content
    # Broadcast to all websockets
    await safe_broadcast({"event": "wall_display_update", "content": req.content})
    return {"status": "ok"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    sid = str(uuid.uuid4())
    connected_websockets.add(websocket)
    print(f'Client connected: sid={sid}')
    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("event")
            payload = data.get('data', data)
            if event == "player_join":
                # Handle player join
                name = payload.get('name', '').strip() if payload else ''
                color = payload.get('color', '').strip() if payload else ''
                print(f'[WebSocket] player_join received: name={name}, color={color}')
                if not name or not color:
                    print(f'[WebSocket] player_join error: missing name or color (name={name}, color={color})')
                    await websocket.send_json({"event": "join_error", "error": "Missing name or color"})
                    continue
                player_id = str(uuid.uuid4())
                players[sid] = {
                    'id': player_id,
                    'name': name,
                    'color': color,
                    'position': {'x': 0, 'y': 0, 'z': 0},
                    'vy': 0.0,
                    'chat_message': '',
                    'chat_expiry': None
                }
                print(f'[WebSocket] New player created: {players[sid]}')
                # Broadcast to all
                await safe_broadcast({"event": "player_joined", "data": players[sid]})
                await safe_broadcast({"event": "player_count_update", "count": len(players)})
                print(f'[WebSocket] Sent player_joined to all clients: {players[sid]}')
                await websocket.send_json({"event": "current_players", "players": list(players.values())})
                await websocket.send_json({"event": "wall_display_update", "content": wall_display_content})
                await broadcast_global_state()
            elif event == "player_input":
                # Handle input-based movement (more responsive)
                if sid in players:
                    input_data = payload.get('input')
                    timestamp = payload.get('timestamp', time.time() * 1000)
                    sequence = payload.get('sequence', 0)
                    
                    if input_data:
                        player = players[sid]
                        
                        # Apply movement on server (same logic as client prediction)
                        new_x = player['position']['x'] + input_data['x']
                        new_z = player['position']['z'] + input_data['z']
                        
                        # Handle jumping and gravity on server
                        if input_data['y'] > 0 and player['position']['y'] <= 0.01 and abs(player['vy']) < 1e-5:
                            player['vy'] = JUMP_VELOCITY
                        
                        # Apply gravity
                        player['vy'] -= GRAVITY
                        new_y = player['position']['y'] + player['vy']
                        
                        # Ground clamp
                        if new_y <= 0:
                            new_y = 0
                            player['vy'] = 0
                        
                        # Update server position
                        player['position'] = {'x': new_x, 'y': new_y, 'z': new_z}
                        
                        # Send authoritative position back to the player for reconciliation
                        await websocket.send_json({
                            "event": "server_position_update",
                            "data": {
                                "position": player['position'],
                                "timestamp": timestamp,
                                "sequence": sequence
                            }
                        })
                        
                        # Broadcast position to other players
                        await broadcast_global_state()
            elif event == "player_move":
                # LEGACY: Keep for backward compatibility
                if sid in players:
                    pos = payload.get('position')
                    player = players[sid]
                    if pos is not None:
                        # Detect jump: if y > ground and vy == 0, treat as jump
                        if pos['y'] > 0.01 and player['position']['y'] <= 0.01 and abs(player['vy']) < 1e-5:
                            player['vy'] = JUMP_VELOCITY
                        # Apply gravity
                        player['vy'] -= GRAVITY
                        # Update y position
                        new_y = player['position']['y'] + player['vy']
                        # Clamp to ground
                        if new_y <= 0:
                            new_y = 0
                            player['vy'] = 0
                        # Update position
                        player['position'] = {'x': pos['x'], 'y': new_y, 'z': pos['z']}
                        await broadcast_global_state()
            elif event == "chat_message":
                player = players.get(sid)
                if player:
                    text = payload.get('text', '')[:120]
                    player['chat_message'] = text
                    player['chat_expiry'] = time.time() + CHAT_EXPIRY_SECONDS
                    await broadcast_global_state()
    except WebSocketDisconnect:
        print(f"Client disconnected: sid={sid}, name={players.get(sid, {}).get('name', 'UNKNOWN')}")
        if sid in players:
            del players[sid]
            await safe_broadcast({"event": "player_disconnected", "id": sid, "name": players.get(sid, {}).get('name', 'UNKNOWN')})
            await safe_broadcast({"event": "player_count_update", "count": len(players)})
            await broadcast_global_state()
        connected_websockets.discard(websocket)