import asyncio
import time
import uuid
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional

import psutil


class PositionRecorder:
    def __init__(
        self,
        config_manager,
        players_provider: Callable[[], Dict[str, Any]],
        metrics_provider: Callable[[], Dict[str, Any]],
    ) -> None:
        self._config_manager = config_manager
        self._players_provider = players_provider
        self._metrics_provider = metrics_provider
        self._lock = asyncio.Lock()
        self._active_task: Optional[asyncio.Task] = None
        self._stop_event: Optional[asyncio.Event] = None
        self._entries: Deque[Dict[str, Any]] = deque()
        self._status: Dict[str, Any] = self._build_idle_status()
        self._round_robin_index = 0

    def _build_idle_status(self) -> Dict[str, Any]:
        return {
            "recording_id": None,
            "active": False,
            "started_at": None,
            "stopped_at": None,
            "config": None,
            "total_entries": 0,
            "skipped_samples": 0,
            "last_skip_reason": None,
        }

    async def start(self, request_config: Dict[str, Any]) -> Dict[str, Any]:
        async with self._lock:
            if self._active_task and not self._active_task.done():
                raise RuntimeError("Recording already in progress")

            merged_config = self._merge_config(request_config)
            self._entries = deque(maxlen=merged_config["max_entries"])
            self._stop_event = asyncio.Event()
            self._status = {
                "recording_id": str(uuid.uuid4()),
                "active": True,
                "started_at": time.time(),
                "stopped_at": None,
                "config": merged_config,
                "total_entries": 0,
                "skipped_samples": 0,
                "last_skip_reason": None,
            }
            self._active_task = asyncio.create_task(self._run())
            return self._status.copy()

    async def stop(self) -> Dict[str, Any]:
        async with self._lock:
            if self._stop_event:
                self._stop_event.set()
            if self._active_task:
                await self._active_task
            self._status["active"] = False
            self._status["stopped_at"] = time.time()
            return self._status.copy()

    def get_status(self) -> Dict[str, Any]:
        return self._status.copy()

    def get_entries(self) -> List[Dict[str, Any]]:
        return list(self._entries)

    def _merge_config(self, overrides: Dict[str, Any]) -> Dict[str, Any]:
        recording_cfg = self._config_manager.get_recording_config()
        merged = {
            "interval_ms": overrides.get("interval_ms", 100),
            "duration_sec": overrides.get("duration_sec", 300),
            "target": overrides.get("target", "all"),
            "sampling_mode": overrides.get("sampling_mode", "all"),
            "priority_player_ids": overrides.get("priority_player_ids", []),
            "round_robin_sample_size": overrides.get(
                "round_robin_sample_size",
                recording_cfg.get("roundRobinSampleSize", 8),
            ),
            "max_entries": recording_cfg.get("maxEntries", 10000),
            "max_qps": recording_cfg.get("maxQps", 200),
            "max_active_recordings": recording_cfg.get("maxActiveRecordings", 1),
            "tick_skip_threshold_ms": recording_cfg.get("tickSkipThresholdMs", 75),
            "cpu_throttle_percent": recording_cfg.get("cpuThrottlePercent", 70),
        }
        merged["interval_ms"] = max(50, min(1000, int(merged["interval_ms"])))
        if merged["duration_sec"]:
            merged["duration_sec"] = max(10, int(merged["duration_sec"]))
        return merged

    async def _run(self) -> None:
        assert self._stop_event is not None
        sampling_config = self._status["config"]
        duration = sampling_config.get("duration_sec")
        start_time = self._status["started_at"]
        process = psutil.Process()

        while not self._stop_event.is_set():
            loop_start = time.perf_counter()
            now = time.time()
            if duration and now - start_time >= duration:
                self._stop_event.set()
                break

            players_snapshot = self._select_players()
            metrics = self._metrics_provider()
            cpu_usage = metrics.get("cpu_percent") or process.cpu_percent(interval=None)
            skip_reason = None

            if cpu_usage and cpu_usage >= sampling_config["cpu_throttle_percent"]:
                skip_reason = "high_cpu"
            else:
                entries_to_record = self._build_entries(players_snapshot, metrics)
                estimated_qps = self._estimate_qps(len(entries_to_record), sampling_config)
                if estimated_qps > sampling_config["max_qps"]:
                    limit = max(1, int((sampling_config["max_qps"] * sampling_config["interval_ms"]) / 1000))
                    entries_to_record = entries_to_record[:limit]
                    skip_reason = "qps_throttled"

                if entries_to_record:
                    self._entries.extend(entries_to_record)
                    self._status["total_entries"] = min(
                        sampling_config["max_entries"],
                        self._status["total_entries"] + len(entries_to_record),
                    )
                else:
                    skip_reason = skip_reason or "no_entries"

            loop_duration_ms = (time.perf_counter() - loop_start) * 1000
            if loop_duration_ms >= sampling_config["tick_skip_threshold_ms"]:
                skip_reason = skip_reason or "tick_overrun"

            if skip_reason:
                self._status["skipped_samples"] += 1
                self._status["last_skip_reason"] = skip_reason

            sleep_time = max(0.001, (sampling_config["interval_ms"] / 1000) - (loop_duration_ms / 1000))
            await asyncio.sleep(sleep_time)

        self._status["active"] = False
        self._status["stopped_at"] = time.time()

    def _estimate_qps(self, entries_len: int, config: Dict[str, Any]) -> float:
        if entries_len == 0:
            return 0.0
        return entries_len * (1000 / config["interval_ms"])

    def _select_players(self) -> List[Dict[str, Any]]:
        players = list(self._players_provider().values())
        sampling_mode = self._status["config"].get("sampling_mode", "all")
        if sampling_mode == "priority":
            priority_ids = set(self._status["config"].get("priority_player_ids", []))
            filtered = [p for p in players if p.get("id") in priority_ids]
            return filtered or players
        if sampling_mode == "round_robin":
            chunk_size = max(1, int(self._status["config"].get("round_robin_sample_size", 8)))
            if not players:
                return []
            start = self._round_robin_index % len(players)
            end = start + chunk_size
            selection = players[start:end]
            if len(selection) < chunk_size:
                selection.extend(players[: chunk_size - len(selection)])
            self._round_robin_index += chunk_size
            return selection
        return players

    def _build_entries(self, players: List[Dict[str, Any]], metrics: Dict[str, Any]) -> List[Dict[str, Any]]:
        timestamp_ms = int(time.time() * 1000)
        entries = []
        for player in players:
            position = player.get("position", {})
            entry = {
                "timestamp": timestamp_ms,
                "player_id": player.get("id"),
                "name": player.get("name"),
                "position": {
                    "x": position.get("x"),
                    "y": position.get("y"),
                    "z": position.get("z"),
                },
                "velocity": {
                    "x": player.get("velocity", {}).get("x", 0.0),
                    "y": player.get("vy", 0.0),
                    "z": player.get("velocity", {}).get("z", 0.0),
                },
                "input_state": player.get("last_inputs", {}),
                "server_processing_ms": metrics.get("avg_processing_ms", 0.0),
                "client_rtt_ms": player.get("last_rtt_ms"),
            }
            entries.append(entry)
        return entries

    def export(self, fmt: str = "json") -> Any:
        entries = self.get_entries()
        if fmt == "csv":
            import csv
            import io

            buffer = io.StringIO()
            writer = csv.DictWriter(
                buffer,
                fieldnames=[
                    "timestamp",
                    "player_id",
                    "name",
                    "x",
                    "y",
                    "z",
                    "vy",
                    "rtt_ms",
                    "server_processing_ms",
                ],
            )
            writer.writeheader()
            for entry in entries:
                writer.writerow(
                    {
                        "timestamp": entry["timestamp"],
                        "player_id": entry["player_id"],
                        "name": entry.get("name"),
                        "x": entry["position"].get("x"),
                        "y": entry["position"].get("y"),
                        "z": entry["position"].get("z"),
                        "vy": entry["velocity"].get("y"),
                        "rtt_ms": entry.get("client_rtt_ms"),
                        "server_processing_ms": entry.get("server_processing_ms"),
                    }
                )
            buffer.seek(0)
            return buffer.getvalue()
        return {
            "metadata": {
                "recording_id": self._status.get("recording_id"),
                "total_entries": len(entries),
                "started_at": self._status.get("started_at"),
                "stopped_at": self._status.get("stopped_at"),
            },
            "entries": entries,
        }
