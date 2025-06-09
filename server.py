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
    for ws in connected_websockets:
        await ws.send_json({"event": "global_state_update", "players": list(players.values())})

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
    for ws in connected_websockets:
        await ws.send_json({"event": "wall_display_update", "content": req.content})
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
            print(f'[WebSocket] Received data: {data}')
            event = data.get("event")
            if event == "player_join":
                # Handle player join
                join_data = data.get('data') if 'data' in data else data
                name = join_data.get('name', '').strip() if join_data else ''
                color = join_data.get('color', '').strip() if join_data else ''
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
                for ws in connected_websockets:
                    try:
                        await ws.send_json({"event": "player_joined", "data": players[sid]})
                        await ws.send_json({"event": "player_count_update", "count": len(players)})
                        print(f'[WebSocket] Sent player_joined to ws: {players[sid]}')
                    except Exception as e:
                        print(f'[WebSocket] Error sending player_joined: {e}')
                await websocket.send_json({"event": "current_players", "players": list(players.values())})
                await websocket.send_json({"event": "wall_display_update", "content": wall_display_content})
                await broadcast_global_state()
            elif event == "player_move":
                if sid in players:
                    pos = data['position']
                    player = players[sid]
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
                    text = data['text'][:120]
                    player['chat_message'] = text
                    player['chat_expiry'] = time.time() + CHAT_EXPIRY_SECONDS
                    await broadcast_global_state()
    except WebSocketDisconnect:
        print(f"Client disconnected: sid={sid}, name={players.get(sid, {}).get('name', 'UNKNOWN')}")
        if sid in players:
            del players[sid]
            for ws in connected_websockets:
                await ws.send_json({"event": "player_disconnected", "id": sid, "name": players.get(sid, {}).get('name', 'UNKNOWN')})
                await ws.send_json({"event": "player_count_update", "count": len(players)})
            await broadcast_global_state()
        connected_websockets.remove(websocket)