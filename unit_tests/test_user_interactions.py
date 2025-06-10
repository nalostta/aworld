import pytest
import asyncio
import json
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from server import app

import os
print(f"DEBUG: TestClient={TestClient}, module={TestClient.__module__}, file={os.path.abspath(TestClient.__module__.replace('.', '/') + '.py')}")
client = TestClient(app)

def test_player_join():
    """Test player join event via websocket."""
    with client.websocket_connect("/ws") as websocket:
        join_data = {"event": "player_join", "data": {"name": "TestPlayer", "color": "#123456"}}
        websocket.send_json(join_data)
        # Expect a global_state_update or player_count_update event
        result = websocket.receive_json()
        assert "event" in result
        assert result["event"] in ["global_state_update", "player_count_update"]

def test_player_movement():
    """Test movement event via websocket (simulate WASD)."""
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"event": "player_join", "data": {"name": "Mover", "color": "#654321"}})
        # Simulate movement event (e.g., move forward to x=1, y=0, z=0)
        move_data = {"event": "player_move", "data": {"position": {"x": 1, "y": 0, "z": 0}}}
        websocket.send_json(move_data)
        # Expect a global_state_update
        result = websocket.receive_json()
        assert "event" in result
        assert result["event"] == "global_state_update"

def test_chat_message():
    """Test chat message event via websocket."""
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"event": "player_join", "data": {"name": "Chatter", "color": "#abcdef"}})
        chat_data = {"event": "chat_message", "data": {"text": "Hello world!"}}
        websocket.send_json(chat_data)
        # Receive global state or chat update
        result = websocket.receive_json()
        assert "event" in result
        assert result["event"] in ["global_state_update", "chat_message"]

def test_object_interaction():
    """Test object interaction events (pick up, move, place, delete)."""
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"event": "player_join", "data": {"name": "ObjUser", "color": "#ff00ff"}})
        # Simulate pick up
        websocket.send_json({"event": "pick_up", "data": {"object_id": "tree1"}})
        # Simulate move
        websocket.send_json({"event": "move_object", "data": {"object_id": "tree1", "to": {"x": 1, "y": 0, "z": 2}}})
        # Simulate place
        websocket.send_json({"event": "place_object", "data": {"object_id": "tree1"}})
        # Simulate delete
        websocket.send_json({"event": "delete_object", "data": {"object_id": "tree1"}})
        # Receive global state update
        result = websocket.receive_json()
        assert "event" in result
        assert result["event"] == "global_state_update"

def test_portal_usage():
    """Test portal usage event via websocket."""
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"event": "player_join", "data": {"name": "Portaler", "color": "#00ffff"}})
        portal_data = {"event": "use_portal", "data": {"portal_id": "portal1"}}
        websocket.send_json(portal_data)
        result = websocket.receive_json()
        assert "event" in result
        assert result["event"] == "global_state_update"

def test_wall_display_update():
    """Test wall display update via REST endpoint."""
    response = client.post("/api/wall_display", json={"content": "Test Announcement"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
