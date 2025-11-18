#!/usr/bin/env python3
"""Simulate a "local" player trying to move while staged bots join.

This helps reproduce the in-browser issue where the user's sprite appears stuck
once other players/bots join. The script connects one primary player that sends a
predictable movement pattern and then spawns additional bot clients. It records
whether the server keeps updating the primary player's position after each bot
joins.
"""

import argparse
import asyncio
import json
import math
import random
import time
from typing import Dict, Optional

import websockets


def build_ws_url(host: str) -> str:
    if host.startswith("ws://") or host.startswith("wss://"):
        return f"{host}/ws" if not host.endswith("/ws") else host
    return f"ws://{host}/ws"


class PrimaryPlayerMonitor:
    def __init__(self, ws_url: str, name: str, duration: float):
        self.ws_url = ws_url
        self.name = name
        self.duration = duration
        self.player_id: Optional[str] = None
        self.server_positions = []
        self.join_events = 0

    async def run(self) -> Dict[str, float]:
        async with websockets.connect(self.ws_url) as websocket:
            await websocket.send(json.dumps({
                "event": "player_join",
                "data": {"name": self.name, "color": "#00ccff"}
            }))

            local_pos = {"x": 0.0, "y": 0.0, "z": 0.0}
            start = time.time()
            last_join = 0

            while time.time() - start < self.duration:
                elapsed = time.time() - start
                dx = math.cos(elapsed * 0.7) * 0.6
                dz = math.sin(elapsed * 0.7) * 0.6
                local_pos["x"] += dx
                local_pos["z"] += dz

                await websocket.send(json.dumps({
                    "event": "player_move",
                    "data": {"position": dict(local_pos)}
                }))

                await self._drain_messages(websocket, timeout=0.05)

                if self.join_events > last_join:
                    last_join = self.join_events
                    if self.server_positions:
                        pos = self.server_positions[-1]
                        print(f"[primary] after join #{last_join}, server pos = {pos}")
                await asyncio.sleep(0.05)

        displacement = 0.0
        if len(self.server_positions) >= 2:
            first = self.server_positions[0]
            last = self.server_positions[-1]
            displacement = ((last['x'] - first['x']) ** 2 + (last['z'] - first['z']) ** 2) ** 0.5
        return {
            "samples": len(self.server_positions),
            "displacement": displacement,
            "join_events": self.join_events
        }

    async def _drain_messages(self, websocket, timeout: float):
        end_time = time.time() + timeout
        while True:
            remaining = end_time - time.time()
            if remaining <= 0:
                break
            try:
                raw = await asyncio.wait_for(websocket.recv(), timeout=remaining)
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            event = msg.get("event")
            if event == "player_joined":
                self.join_events += 1
            if event == "global_state_update":
                for player in msg.get("players", []):
                    if player.get("name") == self.name:
                        if not self.player_id:
                            self.player_id = player.get("id")
                        pos = player.get("position", {})
                        self.server_positions.append({
                            "x": pos.get("x", 0.0),
                            "z": pos.get("z", 0.0)
                        })
                        break


async def bot_task(ws_url: str, idx: int, duration: float):
    name = f"Bot{idx}"
    color = "#%06x" % random.randint(0, 0xFFFFFF)
    try:
        async with websockets.connect(ws_url) as websocket:
            await websocket.send(json.dumps({
                "event": "player_join",
                "data": {"name": name, "color": color}
            }))
            start = time.time()
            local_pos = {"x": 0.0, "y": 0.0, "z": 0.0}
            while time.time() - start < duration:
                local_pos["x"] += random.uniform(-1.5, 1.5)
                local_pos["z"] += random.uniform(-1.5, 1.5)
                await websocket.send(json.dumps({
                    "event": "player_move",
                    "data": {"position": dict(local_pos)}
                }))
                await asyncio.sleep(0.05)
    except Exception as exc:
        print(f"[bot {idx}] error: {exc}")


async def run_test(server: str, duration: float, bot_count: int, bot_stagger: float, primary_count: int):
    ws_url = build_ws_url(server)
    
    # Create multiple primary players
    primary_tasks = []
    for i in range(primary_count):
        primary = PrimaryPlayerMonitor(ws_url, f"Primary{i+1}", duration)
        primary_tasks.append(asyncio.create_task(primary.run()))
        await asyncio.sleep(0.1)  # Small stagger between primary players

    # Spawn bots
    bot_tasks = []
    for i in range(bot_count):
        bot_tasks.append(asyncio.create_task(
            bot_task(ws_url, i + 1, duration)
        ))
        await asyncio.sleep(bot_stagger)

    # Wait for all primary players to complete
    primary_summaries = await asyncio.gather(*primary_tasks)
    
    # Cancel bots
    for task in bot_tasks:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    # Report results for each primary player
    print("\n=== Primary Players Summary ===")
    for idx, summary in enumerate(primary_summaries, 1):
        print(f"\n--- Primary Player {idx} ---")
        print(f"Samples: {summary['samples']}")
        print(f"Displacement (XZ): {summary['displacement']:.2f}")
        print(f"Bot joins observed: {summary['join_events']}")
        if summary['displacement'] < 1.0:
            print("Result: Player appeared stuck (displacement < 1.0 unit).")
        else:
            print("Result: Player moved significantly while bots were active.")
    
    # Overall summary
    avg_displacement = sum(s['displacement'] for s in primary_summaries) / len(primary_summaries)
    stuck_count = sum(1 for s in primary_summaries if s['displacement'] < 1.0)
    print(f"\n=== Overall ===")
    print(f"Total primary players: {primary_count}")
    print(f"Average displacement: {avg_displacement:.2f}")
    print(f"Players stuck: {stuck_count}/{primary_count}")


def parse_args():
    parser = argparse.ArgumentParser(description="Primary-player movement test with concurrent bots")
    parser.add_argument("--server", default="localhost:8000", help="Server host:port or ws/wss URL")
    parser.add_argument("--duration", type=float, default=15.0, help="Run duration for primary player (seconds)")
    parser.add_argument("--bots", type=int, default=4, help="Number of bot clients to spawn")
    parser.add_argument("--bot-stagger", type=float, default=1.0, help="Delay between bot joins (seconds)")
    parser.add_argument("--primary-players", type=int, default=1, help="Number of primary players to monitor")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(run_test(
        server=args.server,
        duration=args.duration,
        bot_count=args.bots,
        bot_stagger=args.bot_stagger,
        primary_count=args.primary_players,
    ))
