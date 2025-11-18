#!/usr/bin/env python3
import argparse
import asyncio
import json
import time
import random
from typing import Dict, List, Optional

import websockets
import requests


class MultiplayerTestbench:
    def __init__(
        self,
        server_url: str = "localhost:8000",
        num_players: int = 5,
        duration_seconds: float = 10.0,
        join_mode: str = "simultaneous",  # "simultaneous" or "staggered"
        stagger_join_interval: float = 1.0,
    ):
        self.server_url = server_url
        self.ws_url = f"ws://{server_url}/ws"
        self.http_url = f"http://{server_url}"
        self.num_players = num_players
        self.duration_seconds = duration_seconds
        self.join_mode = join_mode
        self.stagger_join_interval = stagger_join_interval

        self.position_errors: Dict[str, List[float]] = {}
        self.messages_sent = 0
        self.messages_received = 0

        # Simple reset detection: track last server position per player
        self.last_server_pos: Dict[str, Optional[Dict[str, float]]] = {}
        self.reset_counts: Dict[str, int] = {}

        # Remote visibility: for each local player, track how many times it sees
        # each other player's position change over time.
        # remote_motion_counts[observer_id][remote_id] = count_of_position_changes
        self.remote_motion_counts: Dict[str, Dict[str, int]] = {}

        # Expected final position and path length per player based on all local
        # movement deltas we applied (integration of dx/dz over time).
        self.expected_final_pos: Dict[str, Dict[str, float]] = {}
        self.total_path_length: Dict[str, float] = {}

    async def simulate_player(self, idx: int, join_delay: float = 0.0):
        name = f"BenchBot{idx}"
        color = "#%06x" % random.randint(0, 0xFFFFFF)
        local_pos = {"x": 0.0, "y": 0.0, "z": 0.0}
        player_id = None

        try:
            if join_delay > 0:
                await asyncio.sleep(join_delay)

            async with websockets.connect(self.ws_url) as websocket:
                join_msg = {
                    "event": "player_join",
                    "data": {"name": name, "color": color},
                }
                await websocket.send(json.dumps(join_msg))
                self.messages_sent += 1

                join_deadline = time.time() + 2.0
                while time.time() < join_deadline and player_id is None:
                    try:
                        raw = await asyncio.wait_for(websocket.recv(), timeout=0.5)
                        msg = json.loads(raw)
                        self.messages_received += 1
                        if msg.get("event") == "current_players":
                            for p in msg.get("players", []):
                                if p.get("name") == name:
                                    player_id = p.get("id")
                                    break
                    except asyncio.TimeoutError:
                        break

                if player_id is None:
                    return

                self.position_errors[player_id] = []
                self.last_server_pos[player_id] = None
                self.reset_counts[player_id] = 0
                self.remote_motion_counts[player_id] = {}
                # Initialise expected position and path length from spawn
                self.expected_final_pos[player_id] = dict(local_pos)
                self.total_path_length[player_id] = 0.0

                start = time.time()
                step_interval = 0.05
                while time.time() - start < self.duration_seconds:
                    dx = random.uniform(-0.1, 0.1)
                    dz = random.uniform(-0.1, 0.1)
                    local_pos["x"] += dx
                    local_pos["z"] += dz

                    # Integrate path length and expected final position
                    self.total_path_length[player_id] += (dx * dx + dz * dz) ** 0.5
                    self.expected_final_pos[player_id]["x"] = local_pos["x"]
                    self.expected_final_pos[player_id]["z"] = local_pos["z"]

                    move_msg = {
                        "event": "player_move",
                        "data": {"position": dict(local_pos)},
                    }
                    await websocket.send(json.dumps(move_msg))
                    self.messages_sent += 1

                    recv_deadline = time.time() + 0.04
                    while time.time() < recv_deadline:
                        try:
                            raw = await asyncio.wait_for(websocket.recv(), timeout=0.01)
                            msg = json.loads(raw)
                            self.messages_received += 1

                            if msg.get("event") == "global_state_update":
                                players_state = msg.get("players", [])
                                for p in players_state:
                                    pid = p.get("id")
                                    server_pos = p.get("position", {})

                                    # Local player: track error and potential resets
                                    if pid == player_id:
                                        e2 = (
                                            (server_pos.get("x", 0.0) - local_pos["x"]) ** 2
                                            + (server_pos.get("y", 0.0) - local_pos["y"]) ** 2
                                            + (server_pos.get("z", 0.0) - local_pos["z"]) ** 2
                                        )
                                        error = e2 ** 0.5
                                        self.position_errors[player_id].append(error)

                                        prev = self.last_server_pos.get(player_id)
                                        if prev is not None:
                                            prev_x = prev.get("x", 0.0)
                                            prev_z = prev.get("z", 0.0)
                                            dx_prev = server_pos.get("x", 0.0) - prev_x
                                            dz_prev = server_pos.get("z", 0.0) - prev_z
                                            jump_dist = (dx_prev * dx_prev + dz_prev * dz_prev) ** 0.5

                                            origin_dist = (
                                                server_pos.get("x", 0.0) ** 2
                                                + server_pos.get("z", 0.0) ** 2
                                            ) ** 0.5

                                            if jump_dist > 1.0 and origin_dist < 0.5:
                                                self.reset_counts[player_id] += 1

                                        self.last_server_pos[player_id] = dict(server_pos)

                                    # Remote players: track if their positions change over time
                                    else:
                                        if pid is None:
                                            continue
                                        key = (player_id, pid)
                                        prev_remote = self.last_server_pos.get("::".join(key))
                                        if prev_remote is not None:
                                            dx_r = server_pos.get("x", 0.0) - prev_remote.get("x", 0.0)
                                            dz_r = server_pos.get("z", 0.0) - prev_remote.get("z", 0.0)
                                            move_dist = (dx_r * dx_r + dz_r * dz_r) ** 0.5
                                            if move_dist > 0.01:
                                                self.remote_motion_counts[player_id].setdefault(pid, 0)
                                                self.remote_motion_counts[player_id][pid] += 1

                                        # Store last seen remote position for this observer/remote pair
                                        self.last_server_pos["::".join(key)] = dict(server_pos)
                        except asyncio.TimeoutError:
                            break

                    await asyncio.sleep(step_interval)

        except Exception:
            return

    async def run(self):
        try:
            requests.get(f"{self.http_url}/health", timeout=2)
        except Exception:
            pass

        if self.join_mode == "staggered":
            tasks = [
                self.simulate_player(i, join_delay=i * self.stagger_join_interval)
                for i in range(self.num_players)
            ]
        else:
            tasks = [self.simulate_player(i) for i in range(self.num_players)]
        await asyncio.gather(*tasks)

        self.report()

    def report(self):
        print("MULTIPLAYER TESTBENCH RESULTS")
        print("Mode:", self.join_mode)
        if self.join_mode == "staggered":
            print("Stagger interval (s):", self.stagger_join_interval)
        print("Players simulated:", self.num_players)
        print("Messages sent:", self.messages_sent)
        print("Messages received:", self.messages_received)

        if not self.position_errors:
            print("No position error data collected.")
            return

        for pid, errors in self.position_errors.items():
            if not errors:
                continue
            avg_error = sum(errors) / len(errors)
            max_error = max(errors)
            resets = self.reset_counts.get(pid, 0)
            remote_movements = self.remote_motion_counts.get(pid, {})
            active_remotes = sum(1 for c in remote_movements.values() if c > 0)
            expected_pos = self.expected_final_pos.get(pid, {"x": 0.0, "y": 0.0, "z": 0.0})
            final_server_pos = self.last_server_pos.get(pid, {"x": 0.0, "y": 0.0, "z": 0.0})
            path_length = self.total_path_length.get(pid, 0.0)
            print(
                f"Player {pid}: samples={len(errors)} avg_error={avg_error:.3f} "
                f"max_error={max_error:.3f} resets={resets} "
                f"remote_movers={active_remotes}/{len(remote_movements) or 0} "
                f"expected_final=({expected_pos['x']:.2f},{expected_pos['z']:.2f}) "
                f"server_final=({final_server_pos.get('x',0.0):.2f},{final_server_pos.get('z',0.0):.2f}) "
                f"path_len={path_length:.2f}"
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AWorld multiplayer testbench",
        epilog=(
            "Examples:\n"
            "  Local, simultaneous joins (default):\n"
            "    python test_multiplayer_bench.py\n\n"
            "  Local, staggered joins every 1s:\n"
            "    python test_multiplayer_bench.py --mode staggered --stagger-interval 1.0\n\n"
            "  Remote (default aworld.nalostta.studio):\n"
            "    python test_multiplayer_bench.py --remote\n\n"
            "  Remote with custom host:port:\n"
            "    python test_multiplayer_bench.py --remote --remote-url myhost.example.com:8000\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--server", default="localhost:8000", help="Local server host:port")
    parser.add_argument("--players", type=int, default=5, help="Number of simulated players")
    parser.add_argument("--duration", type=float, default=10.0, help="Duration in seconds")
    parser.add_argument(
        "--mode",
        choices=["simultaneous", "staggered"],
        default="simultaneous",
        help="Join mode for players",
    )
    parser.add_argument(
        "--stagger-interval",
        type=float,
        default=1.0,
        help="Join delay between players in staggered mode (seconds)",
    )
    parser.add_argument(
        "--remote",
        action="store_true",
        help="Test against remote hosted deployment instead of local server",
    )
    parser.add_argument(
        "--remote-url",
        default="aworld.nalostta.studio",
        help="Remote server host:port (used when --remote is set)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    # Determine which server URL to use
    if args.remote:
        server_url = args.remote_url
    else:
        server_url = args.server

    bench = MultiplayerTestbench(
        server_url=server_url,
        num_players=args.players,
        duration_seconds=args.duration,
        join_mode=args.mode,
        stagger_join_interval=args.stagger_interval,
    )
    asyncio.run(bench.run())
