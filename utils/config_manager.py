import json
from pathlib import Path
from threading import Lock
from typing import Any, Dict
import copy


DEFAULT_CONFIG = {
    "physics": {
        "gravity": 0.02,
        "jumpVelocity": 0.25,
        "groundLevel": 0.0,
        "terminalVelocity": 0.6,
    },
    "network": {
        "broadcastThrottle": 1,
        "positionUpdateFrequency": 20,
        "reconciliationThreshold": 0.5,
        "messageCompression": False,
    },
    "game": {
        "world": {
            "boundary": 250,
            "defaultSpawn": [0, 0, 0],
        },
        "player": {
            "maxPlayers": 64,
            "timeoutSeconds": 60,
        },
    },
    "recording": {
        "maxEntries": 10000,
        "autoDeleteHours": 24,
        "maxQps": 200,
        "maxActiveRecordings": 1,
        "tickSkipThresholdMs": 75,
        "cpuThrottlePercent": 70,
        "roundRobinSampleSize": 8,
    },
}


class ConfigManager:
    def __init__(self, path: str):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._config = self._load()

    def _load(self) -> Dict[str, Any]:
        if not self._path.exists():
            self._write(DEFAULT_CONFIG)
            return copy.deepcopy(DEFAULT_CONFIG)
        with self._path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def _write(self, config: Dict[str, Any]) -> None:
        with self._path.open("w", encoding="utf-8") as fh:
            json.dump(config, fh, indent=2)

    def get_config(self) -> Dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._config)

    def get_section(self, section: str, default: Any = None) -> Any:
        with self._lock:
            return copy.deepcopy(self._config.get(section, default))

    def update(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            self._deep_update(self._config, patch)
            self._write(self._config)
            return copy.deepcopy(self._config)

    def reload(self) -> Dict[str, Any]:
        with self._lock:
            self._config = self._load()
            return copy.deepcopy(self._config)

    def get_recording_config(self) -> Dict[str, Any]:
        recording = self.get_section("recording", {})
        merged = copy.deepcopy(DEFAULT_CONFIG["recording"])
        merged.update(recording)
        return merged

    def _deep_update(self, base: Dict[str, Any], updates: Dict[str, Any]) -> None:
        for key, value in updates.items():
            if isinstance(value, dict) and isinstance(base.get(key), dict):
                self._deep_update(base[key], value)
            else:
                base[key] = value
