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
GROUND_LEVEL = 0.0  # logical ground level for player center
MOVE_SPEED = 0.1  # base movement speed
SPRINT_MULTIPLIER = 2.0
CROUCH_MULTIPLIER = 0.5
connected_websockets = set()

# Utility: send to all, removing closed sockets
async def safe_broadcast(message):
    to_remove = set()
    for ws in list(connected_websockets):
        try:
            await ws.send_json(message)
        except Exception:
            to_remove.add(ws)
    for ws in to_remove:
        connected_websockets.discard(ws)

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

def process_input(player: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, float]:
    """Process input commands and return new position"""
    import math
    
    inputs = input_data.get('inputs', {})
    camera_rotation = input_data.get('cameraRotation', 0)
    
    # Calculate movement speed
    speed = MOVE_SPEED
    if 'sprint' in inputs and inputs['sprint']['pressed']:
        speed *= SPRINT_MULTIPLIER
    if 'crouch' in inputs and inputs['crouch']['pressed']:
        speed *= CROUCH_MULTIPLIER
    
    # Calculate horizontal movement
    dx = 0.0
    dz = 0.0
    
    if 'forward' in inputs and inputs['forward']['pressed']:
        dz -= math.cos(camera_rotation) * speed
        dx -= math.sin(camera_rotation) * speed
    if 'backward' in inputs and inputs['backward']['pressed']:
        dz += math.cos(camera_rotation) * speed
        dx += math.sin(camera_rotation) * speed
    if 'left' in inputs and inputs['left']['pressed']:
        dx -= math.cos(camera_rotation) * speed
        dz += math.sin(camera_rotation) * speed
    if 'right' in inputs and inputs['right']['pressed']:
        dx += math.cos(camera_rotation) * speed
        dz -= math.sin(camera_rotation) * speed
    
    # Get current position
    current_pos = player['position']
    current_y = current_pos['y']
    
    # Handle jumping
    jump_pressed = 'jump' in inputs and inputs['jump']['pressed']
    if jump_pressed and current_y <= 0.01:  # On ground
        player['vy'] = SERVER_JUMP_VELOCITY
    
    # Apply gravity
    if current_y > 0:
        player['vy'] -= SERVER_GRAVITY
        new_y = current_y + player['vy']
    else:
        new_y = current_y
    
    # Ground clamp
    if new_y <= GROUND_LEVEL:
        new_y = GROUND_LEVEL
        player['vy'] = 0
    
    # Return new position
    return {
        'x': current_pos['x'] + dx,
        'y': new_y,
        'z': current_pos['z'] + dz
    }

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

@app.get("/physics")
async def physics():
    """Expose server physics parameters so clients can configure themselves dynamically."""
    return {
        "gravity": SERVER_GRAVITY,
        "jumpVelocity": SERVER_JUMP_VELOCITY,
        "groundLevel": GROUND_LEVEL,
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
            elif event == "player_input":
                # Handle input commands with timestamps
                if sid in players:
                    player = players[sid]
                    # Process input and calculate new position server-side
                    new_position = process_input(player, payload)
                    player['position'] = new_position
                    
                    # Send authoritative position back to client
                    await websocket.send_json({
                        "event": "server_position_update",
                        "data": {
                            "sequence": payload.get('sequence'),
                            "position": new_position
                        }
                    })
                    
                    # Broadcast updated state to all players
                    await broadcast_global_state()
            elif event == "player_move":
                # Handle direct position updates from client (legacy support)
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