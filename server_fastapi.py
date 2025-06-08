import os
import time
import uuid

import socketio
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Socket.IO server configured for ASGI
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

fast_app = FastAPI()
fast_app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- Game State ---
players = {}
wall_display_content = "Welcome to AWorld!"

CHAT_EXPIRY_SECONDS = 15
GRAVITY = 0.02
JUMP_VELOCITY = 0.25


@fast_app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main game page."""
    return templates.TemplateResponse("index.html", {"request": request})


@fast_app.post("/api/wall_display")
async def update_wall_display(data: dict):
    """Update the wall display text and notify clients."""
    global wall_display_content
    content = data.get("content", "")
    wall_display_content = content
    await sio.emit("wall_display_update", {"content": content})
    return {"status": "ok"}


def prune_expired_chats():
    now = time.time()
    for p in players.values():
        if p.get("chat_expiry") and p["chat_expiry"] < now:
            p["chat_message"] = ""
            p["chat_expiry"] = None


async def broadcast_global_state():
    prune_expired_chats()
    await sio.emit("global_state_update", list(players.values()))


@sio.event
async def connect(sid, environ):
    print(f"Client connected: sid={sid}")


@sio.event
async def disconnect(sid):
    player = players.get(sid)
    if player:
        print(f"Client disconnected: sid={sid}, name={player['name']}")
        del players[sid]
        await sio.emit("player_disconnected", {"id": sid, "name": player["name"]})
        await sio.emit("player_count_update", {"count": len(players)})
        await broadcast_global_state()
    else:
        print(f"Client disconnected: sid={sid}, name=UNKNOWN")


@sio.on("player_join")
async def handle_player_join(sid, data):
    name = data.get("name", "").strip() if data.get("name") else ""
    color = data.get("color", "").strip() if data.get("color") else ""
    if not name or not color:
        print("Rejected player_join: missing name or color", data)
        await sio.emit("join_error", {"error": "Missing name or color"}, room=sid)
        return
    player_id = str(uuid.uuid4())
    players[sid] = {
        "id": player_id,
        "name": name,
        "color": color,
        "position": {"x": 0, "y": 0, "z": 0},
        "vy": 0.0,
        "chat_message": "",
        "chat_expiry": None,
    }
    await sio.emit("player_joined", players[sid])
    await sio.emit("player_count_update", {"count": len(players)})
    await sio.emit("current_players", list(players.values()), room=sid)
    await sio.emit("wall_display_update", {"content": wall_display_content}, room=sid)
    await broadcast_global_state()


@sio.on("player_move")
async def handle_player_move(sid, data):
    if sid in players:
        pos = data["position"]
        player = players[sid]
        if pos["y"] > 0.01 and player["position"]["y"] <= 0.01 and abs(player["vy"]) < 1e-5:
            player["vy"] = JUMP_VELOCITY
        player["vy"] -= GRAVITY
        new_y = player["position"]["y"] + player["vy"]
        if new_y <= 0:
            new_y = 0
            player["vy"] = 0
        player["position"] = {"x": pos["x"], "y": new_y, "z": pos["z"]}
        await broadcast_global_state()


@sio.on("chat_message")
async def handle_chat_message(sid, data):
    player = players.get(sid)
    if player:
        text = data["text"][:120]
        player["chat_message"] = text
        player["chat_expiry"] = time.time() + CHAT_EXPIRY_SECONDS
        await broadcast_global_state()


app = socketio.ASGIApp(sio, other_asgi_app=fast_app)

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 5001))
    print(f"\nGame server running! Enter the game at: http://localhost:{port}/\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
