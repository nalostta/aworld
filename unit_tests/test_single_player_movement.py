#!/usr/bin/env python3
"""Single-player movement and position stability test.

This script connects a single test player to the AWorld server, performs a
simple movement pattern, and prints how the server-authoritative position
changes over time.

It helps verify:
- Positions update as expected when movement messages are sent.
- Positions remain stable when no movement messages are sent.

Note: camera rotation (Q/E) is client-only and not sent over the network, so
it cannot affect server-side positions and is not represented here.
"""

import asyncio
import json
import time
from typing import Dict

import websockets

WS_URL = "ws://localhost:8000/ws"


async def single_player_test(steps: int = 40) -> None:
    name = "SingleTestBot"
    color = "#ff8800"

    async with websockets.connect(WS_URL) as websocket:
        join_msg = {"event": "player_join", "data": {"name": name, "color": color}}
        await websocket.send(json.dumps(join_msg))

        player_id = None
        server_pos: Dict[str, float] = {"x": 0.0, "y": 0.0, "z": 0.0}

        join_deadline = time.time() + 2.0
        while time.time() < join_deadline and player_id is None:
            try:
                raw = await asyncio.wait_for(websocket.recv(), timeout=0.5)
                msg = json.loads(raw)
                if msg.get("event") == "current_players":
                    for p in msg.get("players", []):
                        if p.get("name") == name:
                            player_id = p.get("id")
                            server_pos = p.get("position", server_pos)
                            break
            except asyncio.TimeoutError:
                break

        print("Joined as:", name, "id=", player_id)
        print("Initial server position:", server_pos)

        # Phase 1: move in +X direction only
        local_pos = dict(server_pos)
        print("\nPhase 1: moving +X for", steps, "steps")
        for i in range(steps):
            local_pos["x"] += 0.1
            move_msg = {"event": "player_move", "data": {"position": dict(local_pos)}}
            await websocket.send(json.dumps(move_msg))

            # Read a couple of updates
            end = time.time() + 0.05
            while time.time() < end:
                try:
                    raw = await asyncio.wait_for(websocket.recv(), timeout=0.01)
                    msg = json.loads(raw)
                    if msg.get("event") == "global_state_update":
                        for p in msg.get("players", []):
                            if p.get("id") == player_id:
                                server_pos = p.get("position", server_pos)
                                break
                except asyncio.TimeoutError:
                    break

            print(f"step {i+1:02d}: server_pos = {server_pos}")
            await asyncio.sleep(0.05)

        # Phase 2: idle, ensure position stays stable
        print("\nPhase 2: idle (no movement) for 20 samples")
        for i in range(20):
            end = time.time() + 0.05
            last_seen = dict(server_pos)
            while time.time() < end:
                try:
                    raw = await asyncio.wait_for(websocket.recv(), timeout=0.01)
                    msg = json.loads(raw)
                    if msg.get("event") == "global_state_update":
                        for p in msg.get("players", []):
                            if p.get("id") == player_id:
                                server_pos = p.get("position", server_pos)
                                break
                except asyncio.TimeoutError:
                    break
            print(f"idle {i+1:02d}: server_pos = {server_pos}")
            await asyncio.sleep(0.05)

        print("\nSingle-player movement test complete.")


if __name__ == "__main__":
    asyncio.run(single_player_test())
