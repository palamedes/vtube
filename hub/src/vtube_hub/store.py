"""Small JSON files for the hub's persistent state."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger(__name__)


def write_json(path: Path, data: dict) -> None:
    """Write JSON atomically so a crash never leaves a half-written file."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


class JsonFile:
    def __init__(self, path: Path, default: dict) -> None:
        self.path = path
        self.default = default

    def load(self) -> dict:
        if not self.path.is_file():
            return dict(self.default)
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            backup = self.path.with_name(f"{self.path.name}.broken-{int(time.time())}")
            log.warning("%s is unreadable (%s); moved it to %s and started fresh", self.path, exc, backup.name)
            self.path.rename(backup)
            return dict(self.default)
        return data if isinstance(data, dict) else dict(self.default)

    def save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_json(self.path, data)
