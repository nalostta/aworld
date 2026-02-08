from fastapi import (
    FastAPI,
    Request,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    Form,
    Body,
)
from fastapi.responses import (
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware
from starlette.status import HTTP_302_FOUND
import uuid
import os
import time
import json
import re
import io
import gzip
from collections import deque
from typing import Dict, Any, List, Optional, Deque
import asyncio
import psutil
from pathlib import Path
from datetime import datetime

from utils.config_manager import ConfigManager, DEFAULT_CONFIG
from utils.position_recorder import PositionRecorder
from pydantic import BaseModel

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "test123")
ADMIN_SESSION_SECRET = os.getenv("ADMIN_SESSION_SECRET", "dev-session-secret")
SESSION_MAX_AGE = 60 * 60  # 1 hour

app.add_middleware(
    SessionMiddleware,
    secret_key=ADMIN_SESSION_SECRET,
    https_only=False,
    max_age=SESSION_MAX_AGE,
)

players: Dict[str, Any] = {}
wall_display_content = "Welcome to AWorld!"
CHAT_EXPIRY_SECONDS = 15
SERVER_GRAVITY = 0.02  # units per tick
SERVER_JUMP_VELOCITY = 0.25  # units per jump
GROUND_LEVEL = 0.0  # logical ground level for player center
MOVE_SPEED = 0.1  # base movement speed
SPRINT_MULTIPLIER = 2.0
CROUCH_MULTIPLIER = 0.5
connected_websockets = set()
sid_to_websocket: Dict[str, WebSocket] = {}
player_id_to_sid: Dict[str, str] = {}
admin_ws_connections: set[WebSocket] = set()

# Per-client outbound queues for dedicated writer tasks
ws_out_queues: Dict[WebSocket, "asyncio.Queue[Dict[str, Any]]"] = {}
WS_OUT_QUEUE_MAXSIZE = 200

# Throttled global broadcast loop
GLOBAL_BROADCAST_HZ = float(os.getenv("GLOBAL_BROADCAST_HZ", "10"))
_global_state_dirty = False
_global_broadcast_task: Optional[asyncio.Task] = None
_global_broadcast_stop: Optional[asyncio.Event] = None

ADMIN_SESSION_FLAG = "admin_authenticated"
MAX_LOG_ENTRIES = 500
ADMIN_WS_THROTTLE = 1.0

server_start_time = time.time()  # For uptime tracking
last_broadcast_time = 0  # For broadcast rate limiting
broadcast_count = 0  # Performance tracking
broadcast_time_total = 0  # Performance tracking

config_manager = ConfigManager("config/server_config.json")

log_buffer: Deque[Dict[str, Any]] = deque(maxlen=MAX_LOG_ENTRIES)


def metrics_snapshot(include_recording: bool = False) -> Dict[str, Any]:
    process = psutil.Process()
    memory_info = process.memory_info()
    cpu_percent = process.cpu_percent(interval=None)
    uptime_seconds = round(time.time() - server_start_time, 2)
    players_count = len(players)
    websocket_connections = len(connected_websockets)
    avg_broadcast_time = (
        broadcast_time_total / broadcast_count if broadcast_count > 0 else 0.0
    )

    metrics = {
        "status": "healthy",
        "uptime_seconds": uptime_seconds,
        "players_count": players_count,
        "websocket_connections": websocket_connections,
        "memory_usage_mb": round(memory_info.rss / 1024 / 1024, 2),
        "cpu_percent": cpu_percent,
        "broadcast_count": broadcast_count,
        "broadcast_time_total": broadcast_time_total,
        "broadcast_time_average": avg_broadcast_time,
        "timestamp": time.time(),
    }

    if hasattr(memory_info, "peak_wss"):
        metrics["memory_peak_mb"] = round(memory_info.peak_wss / 1024 / 1024, 2)

    if include_recording:
        metrics["recording"] = position_recorder.get_status()

    return metrics


async def push_admin_metrics(force: bool = False):
    now = time.time()
    if not admin_ws_connections:
        return
    last_push = getattr(push_admin_metrics, "_last_push", 0)
    if not force and now - last_push < ADMIN_WS_THROTTLE:
        return
    await broadcast_admin_json({"type": "metrics", "data": metrics_snapshot(True)})
    push_admin_metrics._last_push = now


async def push_admin_players(force: bool = False):
    now = time.time()
    if not admin_ws_connections:
        return
    last_push = getattr(push_admin_players, "_last_push", 0)
    if not force and now - last_push < ADMIN_WS_THROTTLE * 2:
        return
    payload = {
        "type": "players",
        "data": [serialize_player(p) for p in players.values()],
    }
    await broadcast_admin_json(payload)
    push_admin_players._last_push = now


async def broadcast_admin_json(message: Dict[str, Any]):
    to_remove = set()
    for ws in list(admin_ws_connections):
        try:
            await ws.send_json(message)
        except Exception:
            to_remove.add(ws)
    for ws in to_remove:
        admin_ws_connections.discard(ws)


position_recorder = PositionRecorder(
    config_manager,
    lambda: players,
    lambda: metrics_snapshot(include_recording=False),
)


def is_admin_session(request: Request) -> bool:
    return bool(request.session.get(ADMIN_SESSION_FLAG))


def require_admin(request: Request):
    if not is_admin_session(request):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    return True


def serialize_player(player: Dict[str, Any]) -> Dict[str, Any]:
    position = player.get("position", {})
    return {
        "id": player.get("id"),
        "name": player.get("name"),
        "color": player.get("color"),
        "position": position,
        "last_rtt_ms": player.get("last_rtt_ms"),
        "connected_at": player.get("connected_at"),
        "last_activity": player.get("last_activity"),
        "sid": player.get("sid"),
        "velocity": player.get("velocity", {}),
        "last_inputs": player.get("last_inputs", {}),
        "server_delta_per_sec": player.get("server_delta_per_sec"),
        "server_delta_dt_ms": player.get("server_delta_dt_ms"),
        "client_delta_per_sec": player.get("client_delta_per_sec"),
        "client_delta_dt_ms": player.get("client_delta_dt_ms"),
        "client_telemetry_ts_ms": player.get("client_telemetry_ts_ms"),
    }


def update_server_delta(player: Dict[str, Any], new_position: Dict[str, float], timestamp_ms: int) -> None:
    prev_pos = player.get("_server_prev_pos")
    prev_ts = player.get("_server_prev_ts_ms")
    if not isinstance(prev_pos, dict) or not isinstance(prev_ts, int):
        player["_server_prev_pos"] = dict(new_position)
        player["_server_prev_ts_ms"] = int(timestamp_ms)
        player["_server_window_start_ts_ms"] = int(timestamp_ms)
        player["_server_window_dist"] = 0.0
        player["server_delta_per_sec"] = None
        player["server_delta_dt_ms"] = None
        return

    dt_ms = timestamp_ms - prev_ts
    if dt_ms <= 0:
        return

    dx = float(new_position.get("x", 0.0)) - float(prev_pos.get("x", 0.0))
    dy = float(new_position.get("y", 0.0)) - float(prev_pos.get("y", 0.0))
    dz = float(new_position.get("z", 0.0)) - float(prev_pos.get("z", 0.0))
    dist = (dx * dx + dy * dy + dz * dz) ** 0.5

    window_start = player.get("_server_window_start_ts_ms")
    window_dist = player.get("_server_window_dist")
    if not isinstance(window_start, int) or not isinstance(window_dist, (int, float)):
        window_start = prev_ts
        window_dist = 0.0

    window_dist = float(window_dist) + dist
    window_dt = timestamp_ms - int(window_start)
    if window_dt >= 1000:
        player["server_delta_per_sec"] = (window_dist / window_dt) * 1000.0
        player["server_delta_dt_ms"] = window_dt
        player["_server_window_start_ts_ms"] = int(timestamp_ms)
        player["_server_window_dist"] = 0.0
    else:
        player["_server_window_start_ts_ms"] = int(window_start)
        player["_server_window_dist"] = window_dist

    player["_server_prev_pos"] = dict(new_position)
    player["_server_prev_ts_ms"] = int(timestamp_ms)


def log_event(level: str, message: str, **metadata) -> Dict[str, Any]:
    entry = {
        "timestamp": time.time(),
        "iso": datetime.utcnow().isoformat() + "Z",
        "level": level.upper(),
        "message": message,
        "metadata": metadata,
    }
    log_buffer.append(entry)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(broadcast_admin_json({"type": "log", "data": entry}))
    except RuntimeError:
        pass
    return entry


async def safe_broadcast(message):
    to_remove = set()
    for ws in list(connected_websockets):
        try:
            await enqueue_ws_message(ws, message)
        except Exception:
            to_remove.add(ws)
    for ws in to_remove:
        connected_websockets.discard(ws)
        ws_out_queues.pop(ws, None)


async def safe_broadcast_except(exclude_ws: WebSocket, message: Dict[str, Any]):
    to_remove = set()
    for ws in list(connected_websockets):
        if ws is exclude_ws:
            continue
        try:
            await enqueue_ws_message(ws, message)
        except Exception:
            to_remove.add(ws)
    for ws in to_remove:
        connected_websockets.discard(ws)
        ws_out_queues.pop(ws, None)

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
    
    player['velocity'] = {'x': dx, 'z': dz}

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
            "timestamp_ms": int(time.time() * 1000),
            "players": list(players.values()),
        })
        end_time = time.time()
        broadcast_time_total += (end_time - start_time)
        broadcast_count += 1


def mark_global_state_dirty() -> None:
    global _global_state_dirty
    _global_state_dirty = True


async def enqueue_ws_message(ws: WebSocket, message: Dict[str, Any]) -> None:
    q = ws_out_queues.get(ws)
    if q is None:
        # No queue means writer task not set up or already torn down.
        raise RuntimeError("WebSocket outbound queue missing")
    try:
        q.put_nowait(message)
    except asyncio.QueueFull:
        # Drop oldest message to keep latency low.
        try:
            _ = q.get_nowait()
        except asyncio.QueueEmpty:
            pass
        q.put_nowait(message)


async def ws_writer_loop(ws: WebSocket, queue: "asyncio.Queue[Dict[str, Any]]") -> None:
    while True:
        try:
            message = await queue.get()
        except asyncio.CancelledError:
            break
        try:
            await ws.send_json(message)
        except Exception:
            # Connection closed or send failure.
            break


async def global_broadcast_loop() -> None:
    global _global_state_dirty
    assert _global_broadcast_stop is not None
    interval = 1.0 / max(1.0, GLOBAL_BROADCAST_HZ)
    try:
        while not _global_broadcast_stop.is_set():
            await asyncio.sleep(interval)
            if not _global_state_dirty:
                continue
            _global_state_dirty = False
            try:
                await broadcast_global_state()
            except Exception:
                # Avoid crashing the loop; individual websocket failures are handled elsewhere.
                pass
    except asyncio.CancelledError:
        return


@app.on_event("startup")
async def _start_global_broadcast_loop() -> None:
    global _global_broadcast_task, _global_broadcast_stop
    if _global_broadcast_task and not _global_broadcast_task.done():
        return
    _global_broadcast_stop = asyncio.Event()
    _global_broadcast_task = asyncio.create_task(global_broadcast_loop())


@app.on_event("shutdown")
async def _stop_global_broadcast_loop() -> None:
    global _global_broadcast_task, _global_broadcast_stop
    if _global_broadcast_stop:
        _global_broadcast_stop.set()
    if _global_broadcast_task:
        _global_broadcast_task.cancel()
        try:
            await _global_broadcast_task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/admin/login", response_class=HTMLResponse)
async def admin_login(request: Request):
    if is_admin_session(request):
        return RedirectResponse("/admin/dashboard", status_code=HTTP_302_FOUND)
    return templates.TemplateResponse("admin/login.html", {"request": request, "error": None})


@app.post("/admin/login")
async def admin_login_submit(request: Request, token: str = Form(...)):
    if token.strip() == ADMIN_TOKEN:
        request.session[ADMIN_SESSION_FLAG] = True
        request.session["admin_authenticated_at"] = time.time()
        return RedirectResponse("/admin/dashboard", status_code=HTTP_302_FOUND)
    context = {"request": request, "error": "Invalid admin token."}
    return templates.TemplateResponse("admin/login.html", context, status_code=401)


@app.post("/admin/logout")
async def admin_logout(request: Request):
    request.session.pop(ADMIN_SESSION_FLAG, None)
    request.session.pop("admin_authenticated_at", None)
    return RedirectResponse("/admin/login", status_code=HTTP_302_FOUND)


@app.get("/admin/dashboard", response_class=HTMLResponse)
async def admin_dashboard(request: Request):
    require_admin(request)
    context = {
        "request": request,
        "build_time": time.time(),
    }
    return templates.TemplateResponse("admin/dashboard.html", context)


@app.get("/admin/api/metrics", response_class=JSONResponse)
async def admin_metrics(request: Request):
    require_admin(request)
    return metrics_snapshot(include_recording=True)


@app.get("/admin/api/players", response_class=JSONResponse)
async def admin_players(request: Request):
    require_admin(request)
    serialized = [serialize_player(p) for p in players.values()]
    return {"players": serialized, "count": len(serialized)}


@app.post("/admin/api/players/{player_id}/kick")
async def admin_kick_player(player_id: str, request: Request):
    require_admin(request)
    sid = player_id_to_sid.get(player_id)
    if not sid:
        return JSONResponse({"status": "not_found"}, status_code=404)
    ws = sid_to_websocket.get(sid)
    if ws:
        try:
            await ws.close(code=4001)
        except Exception:
            pass
    player = players.pop(sid, None)
    player_id_to_sid.pop(player_id, None)
    sid_to_websocket.pop(sid, None)
    await safe_broadcast({"event": "player_disconnected", "id": sid})
    await safe_broadcast({"event": "player_count_update", "count": len(players)})
    await push_admin_players(force=True)
    await push_admin_metrics(force=True)
    log_event(
        "INFO",
        "Player kicked",
        player_id=player_id,
        name=player.get('name') if player else None,
        color=player.get('color') if player else None,
        ip=player.get('ip') if player else None,
    )
    return {"status": "kicked"}


@app.get("/admin/api/logs", response_class=JSONResponse)
async def admin_logs(request: Request, limit: int = 100):
    require_admin(request)
    limit = max(1, min(limit, MAX_LOG_ENTRIES))
    return {"logs": list(log_buffer)[-limit:]}


@app.post("/admin/api/recording/start", response_class=JSONResponse)
async def admin_start_recording(
    request: Request, payload: Optional[Dict[str, Any]] = Body(None)
):
    require_admin(request)
    payload = payload or {}
    try:
        status = await position_recorder.start(payload)
        await push_admin_metrics(force=True)
        log_event("INFO", "Recording started", config=payload)
        return status
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/api/recording/stop", response_class=JSONResponse)
async def admin_stop_recording(request: Request):
    require_admin(request)
    status = await position_recorder.stop()
    await push_admin_metrics(force=True)
    log_event("INFO", "Recording stopped")
    return status


@app.get("/admin/api/recording/status", response_class=JSONResponse)
async def admin_recording_status(request: Request):
    require_admin(request)
    return position_recorder.get_status()


@app.get("/admin/api/recording/export")
async def admin_recording_export(
    request: Request, fmt: str = "json", compress: bool = False
):
    require_admin(request)
    fmt = fmt.lower()
    if fmt not in {"json", "csv"}:
        raise HTTPException(status_code=400, detail="Unsupported export format")

    data = position_recorder.export(fmt=fmt)
    timestamp = int(time.time())
    base_filename = f"recording_{timestamp}.{ 'csv' if fmt == 'csv' else 'json'}"
    headers = {"Content-Disposition": f"attachment; filename={base_filename}"}

    if fmt == "csv":
        payload_bytes = data.encode("utf-8")
        media_type = "text/csv"
    else:
        payload_bytes = json.dumps(data, separators=(",", ":")).encode("utf-8")
        media_type = "application/json"

    if compress:
        buffer = io.BytesIO()
        with gzip.GzipFile(fileobj=buffer, mode="wb") as gz:
            gz.write(payload_bytes)
        buffer.seek(0)
        headers["Content-Disposition"] = (
            f"attachment; filename={base_filename}.gz"
        )
        return StreamingResponse(buffer, media_type="application/gzip", headers=headers)

    if fmt == "csv":
        return StreamingResponse(
            iter([payload_bytes]), media_type=media_type, headers=headers
        )

    return JSONResponse(data, headers=headers)


@app.get("/admin/api/recording/entries", response_class=JSONResponse)
async def admin_recording_entries(
    request: Request, limit: int = 1000, since: Optional[int] = None
):
    require_admin(request)
    limit = max(10, min(limit, 5000))
    entries = position_recorder.get_entries()
    if since is not None:
        entries = [entry for entry in entries if entry.get("timestamp") >= since]
    if len(entries) > limit:
        entries = entries[-limit:]
    return {"entries": entries, "count": len(entries)}


# API to update wall display (admin or server-side only)
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
    sid_to_websocket[sid] = websocket
    out_q: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=WS_OUT_QUEUE_MAXSIZE)
    ws_out_queues[websocket] = out_q
    writer_task = asyncio.create_task(ws_writer_loop(websocket, out_q))
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
                    'chat_expiry': None,
                    'sid': sid,
                    'connected_at': time.time(),
                    'last_activity': time.time(),
                    'last_inputs': {},
                    'velocity': {'x': 0.0, 'z': 0.0},
                    'last_rtt_ms': None,
                    'ip': websocket.client.host if websocket.client else None,
                    'server_delta_per_sec': None,
                    'server_delta_dt_ms': None,
                    'client_delta_per_sec': None,
                    'client_delta_dt_ms': None,
                    'client_telemetry_ts_ms': None,
                }
                player_id_to_sid[player_id] = sid
                log_event(
                    "INFO",
                    "Player joined",
                    player_id=player_id,
                    name=name,
                    color=color,
                    ip=players[sid]['ip'],
                )
                print(f'[WebSocket] New player created: {players[sid]}')

                # Tell the connecting client its authoritative player id.
                await enqueue_ws_message(
                    websocket,
                    {
                        "event": "join_success",
                        "data": {
                            "playerId": player_id,
                            "timestamp_ms": int(time.time() * 1000),
                        },
                    },
                )
                # Broadcast to all
                await safe_broadcast({"event": "player_joined", "data": players[sid]})
                await safe_broadcast({"event": "player_count_update", "count": len(players)})
                print(f'[WebSocket] Sent player_joined to all clients: {players[sid]}')
                await enqueue_ws_message(websocket, {"event": "current_players", "players": list(players.values())})
                await enqueue_ws_message(websocket, {"event": "wall_display_update", "content": wall_display_content})
                mark_global_state_dirty()
                await push_admin_players(force=True)
                await push_admin_metrics(force=True)
            elif event == "player_input":
                # Handle input commands with timestamps
                if sid in players:
                    player = players[sid]
                    player['last_activity'] = time.time()
                    inputs = payload.get('inputs', {})
                    player['last_inputs'] = inputs

                    # Process input and calculate new position server-side
                    new_position = process_input(player, payload)
                    player['position'] = new_position

                    now_ms = int(time.time() * 1000)
                    update_server_delta(player, new_position, now_ms)

                    # Broadcast authoritative position update to all clients
                    await safe_broadcast(
                        {
                            "event": "server_position_update",
                            "data": {
                                "playerId": player.get("id"),
                                "sequence": payload.get('sequence'),
                                "position": new_position,
                                "timestamp_ms": now_ms,
                            },
                        }
                    )
                    
                    # Broadcast updated state to all players (throttled)
                    mark_global_state_dirty()
                    await push_admin_players()
            elif event == "player_move":
                # Handle client-authoritative position updates
                if sid in players:
                    pos = payload.get('position')
                    player = players[sid]
                    if pos is not None:
                        player['last_activity'] = time.time()
                        try:
                            x = float(pos.get('x'))
                            y = float(pos.get('y'))
                            z = float(pos.get('z'))
                        except Exception:
                            continue

                        player['position'] = {'x': x, 'y': y, 'z': z}

                        now_ms = (
                            int(payload.get('timestamp_ms'))
                            if isinstance(payload.get('timestamp_ms'), int)
                            else int(time.time() * 1000)
                        )
                        update_server_delta(player, player['position'], now_ms)

                        # Broadcast to other clients only (sender already has its authoritative position).
                        await safe_broadcast_except(
                            websocket,
                            {
                                "event": "server_position_update",
                                "data": {
                                    "playerId": player.get("id"),
                                    "position": player['position'],
                                    "timestamp_ms": now_ms,
                                },
                            },
                        )

                        mark_global_state_dirty()
                        await push_admin_players()
            elif event == "client_telemetry":
                player = players.get(sid)
                if player:
                    player_id = payload.get("playerId")
                    if player_id and player_id == player.get("id"):
                        local_dps = payload.get("local_delta_per_sec")
                        dt_ms = payload.get("dt_ms")
                        ts_ms = payload.get("timestamp_ms")
                        if isinstance(local_dps, (int, float)):
                            player["client_delta_per_sec"] = float(local_dps)
                        if isinstance(dt_ms, int):
                            player["client_delta_dt_ms"] = dt_ms
                        if isinstance(ts_ms, int):
                            player["client_telemetry_ts_ms"] = ts_ms
                        await push_admin_players()
            elif event == "chat_message":
                player = players.get(sid)
                if player:
                    text = payload.get('text', '')[:120]
                    player['chat_message'] = text
                    player['chat_expiry'] = time.time() + CHAT_EXPIRY_SECONDS
                    mark_global_state_dirty()
                    await push_admin_players()
            elif event == "ping":
                # Handle ping for RTT measurement
                player = players.get(sid)
                if player:
                    if 'rttMs' in payload:
                        player['last_rtt_ms'] = payload['rttMs']
                    player['last_activity'] = time.time()
                await enqueue_ws_message(
                    websocket,
                    {
                        "event": "ping",
                        "data": {"timestamp": payload.get('timestamp', time.time() * 1000)},
                    },
                )
    except WebSocketDisconnect:
        pass
    finally:
        print(f"Client disconnected: sid={sid}, name={players.get(sid, {}).get('name', 'UNKNOWN')}")
        player = players.pop(sid, None)
        if player:
            player_id_to_sid.pop(player.get('id'), None)
            log_event(
                "INFO",
                "Player disconnected",
                player_id=player.get('id'),
                name=player.get('name'),
                color=player.get('color'),
                ip=player.get('ip'),
            )
            try:
                await safe_broadcast({"event": "player_disconnected", "id": sid, "name": player.get('name', 'UNKNOWN')})
                await safe_broadcast({"event": "player_count_update", "count": len(players)})
                mark_global_state_dirty()
                await push_admin_players(force=True)
                await push_admin_metrics(force=True)
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        connected_websockets.discard(websocket)
        sid_to_websocket.pop(sid, None)
        ws_out_queues.pop(websocket, None)
        writer_task.cancel()
        try:
            await writer_task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass


@app.websocket("/admin/ws")
async def admin_ws(websocket: WebSocket):
    await websocket.accept()
    if not websocket.session.get(ADMIN_SESSION_FLAG):
        await websocket.close(code=4401)
        return
    admin_ws_connections.add(websocket)
    try:
        await websocket.send_json({"type": "logs", "data": list(log_buffer)})
        await push_admin_metrics(force=True)
        await push_admin_players(force=True)
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "timestamp": message.get("timestamp")})
    except WebSocketDisconnect:
        admin_ws_connections.discard(websocket)