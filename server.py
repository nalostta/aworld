from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import uuid
import os
import time
from typing import Dict, Any
import asyncio
import psutil

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

players: Dict[str, Any] = {}
wall_display_content = 'Welcome to AWorld!'
CHAT_EXPIRY_SECONDS = 15
SERVER_GRAVITY = 0.02  # units per tick
SERVER_JUMP_VELOCITY = 0.25  # units per jump
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
server_start_time = time.time()  # For uptime tracking
last_broadcast_time = 0  # For broadcast rate limiting
broadcast_count = 0  # Performance tracking
broadcast_time_total = 0  # Performance tracking

# --- Wall Display State ---
wall_display_content = 'Welcome to AWorld!'

CHAT_EXPIRY_SECONDS = 15
SERVER_GRAVITY = 0.02  # units per tick
SERVER_JUMP_VELOCITY = 0.25  # units per jump

def prune_expired_chats():
    now = time.time()
    for p in players.values():
        if 'chat_expiry' in p and p['chat_expiry'] and p['chat_expiry'] < now:
            p['chat_message'] = ''
            p['chat_expiry'] = None

async def broadcast_global_state():
    """Simple broadcast of all player states"""
    global broadcast_count, broadcast_time_total
    
    if players:
        start_time = time.time()
        await safe_broadcast({
            "event": "global_state_update", 
            "players": list(players.values())
        })
        end_time = time.time()
        broadcast_time_total += (end_time - start_time)
        broadcast_count += 1

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

@app.get("/health")
async def health():
    """Server health and performance metrics endpoint"""
    process = psutil.Process()
    memory_info = process.memory_info()
    cpu_percent = process.cpu_percent()
    
    return {
        "status": "healthy",
        "uptime_seconds": round(time.time() - server_start_time, 2),
        "players_count": len(players),
        "websocket_connections": len(connected_websockets),
        "memory_usage_mb": round(memory_info.rss / 1024 / 1024, 2),
        "memory_peak_mb": round(memory_info.peak_wss / 1024 / 1024, 2) if hasattr(memory_info, 'peak_wss') else "N/A",
        "cpu_percent": cpu_percent,
        "broadcast_count": broadcast_count,
        "broadcast_time_total": broadcast_time_total,
        "broadcast_time_average": broadcast_time_total / broadcast_count if broadcast_count > 0 else 0,
        "timestamp": time.time()
    }

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
            elif event == "player_move":
                # Handle direct position updates from client
                if sid in players:
                    pos = payload.get('position')
                    player = players[sid]
                    if pos is not None:
                        # Apply server-side physics for jumping and gravity
                        current_y = player['position']['y']
                        new_y = pos['y']
                        
                        # Detect jump: if player is moving upward from ground
                        if new_y > current_y + 0.1 and current_y <= 0.01:
                            player['vy'] = SERVER_JUMP_VELOCITY
                        
                        # Apply gravity if player is in the air
                        if player['position']['y'] > 0:
                            player['vy'] -= SERVER_GRAVITY
                            new_y = player['position']['y'] + player['vy']
                        
                        # Ground clamp
                        if new_y <= 0:
                            new_y = 0
                            player['vy'] = 0
                        
                        # Update position with server authority
                        player['position'] = {'x': pos['x'], 'y': new_y, 'z': pos['z']}
                        
                        # Broadcast updated state to all players
                        await broadcast_global_state()
            elif event == "chat_message":
                player = players.get(sid)
                if player:
                    text = payload.get('text', '')[:120]
                    player['chat_message'] = text
                    player['chat_expiry'] = time.time() + CHAT_EXPIRY_SECONDS
                    await broadcast_global_state()
            elif event == "ping":
                # Handle ping for RTT measurement
                await websocket.send_json({
                    "event": "ping",
                    "data": {
                        "timestamp": payload.get('timestamp', time.time() * 1000)
                    }
                })
    except WebSocketDisconnect:
        print(f"Client disconnected: sid={sid}, name={players.get(sid, {}).get('name', 'UNKNOWN')}")
        if sid in players:
            del players[sid]
            await safe_broadcast({"event": "player_disconnected", "id": sid, "name": players.get(sid, {}).get('name', 'UNKNOWN')})
            await safe_broadcast({"event": "player_count_update", "count": len(players)})
            await broadcast_global_state()
        connected_websockets.discard(websocket)