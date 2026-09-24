"""Takes: recorded performances, stored outside the repo.

Each take is a folder under <data dir>/takes/<id>/:

    take.json      metadata (see docs/architecture.md)
    frames.jsonl   one raw face frame per line; t is seconds since the take started
    audio.wav      the voice, 48 kHz mono 24-bit, straight from the microphone

Frames are stored raw, before calibration and smoothing, so a take can be
re-tuned and re-rendered later with any character.
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from .audio import AudioTake
from .frames import Frame
from .store import write_json

TAKE_FORMAT = 1
_ID = re.compile(r"^\d{8}-\d{6}(-\d{1,3})?$")
MAX_NAME = 120
MAX_SYNC_OFFSET = 2.0


class TakeStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def path(self, take_id: str) -> Path:
        if not _ID.match(take_id):
            raise KeyError(take_id)
        return self.root / take_id

    def new_id(self, now: datetime) -> str:
        base = now.strftime("%Y%m%d-%H%M%S")
        take_id, n = base, 1
        while (self.root / take_id).exists():
            n += 1
            take_id = f"{base}-{n}"
        return take_id

    def read(self, take_id: str) -> dict:
        meta_path = self.path(take_id) / "take.json"
        if not meta_path.is_file():
            raise KeyError(take_id)
        return json.loads(meta_path.read_text(encoding="utf-8"))

    def list(self) -> list[dict]:
        takes = []
        for folder in sorted(self.root.iterdir(), reverse=True):
            if not folder.is_dir() or not _ID.match(folder.name):
                continue
            try:
                takes.append(summary(self.read(folder.name)))
            except (KeyError, ValueError, OSError):
                continue  # a take that's still recording, or a damaged one
        return takes

    def update(self, take_id: str, changes: dict) -> dict:
        meta = self.read(take_id)
        unknown = set(changes) - {"name", "syncOffset"}
        if unknown:
            raise ValueError(f"can't change {', '.join(sorted(unknown))}")
        if "name" in changes:
            name = changes["name"]
            if not isinstance(name, str) or not name.strip():
                raise ValueError("name must be a non-empty string")
            meta["name"] = name.strip()[:MAX_NAME]
        if "syncOffset" in changes:
            offset = changes["syncOffset"]
            if isinstance(offset, bool) or not isinstance(offset, (int, float)) or abs(offset) > MAX_SYNC_OFFSET:
                raise ValueError(f"syncOffset must be a number of seconds within ±{MAX_SYNC_OFFSET}")
            meta["syncOffset"] = round(float(offset), 4)
        write_json(self.path(take_id) / "take.json", meta)
        return meta

    def delete(self, take_id: str) -> None:
        folder = self.path(take_id)
        if not folder.is_dir():
            raise KeyError(take_id)
        shutil.rmtree(folder)


def summary(meta: dict) -> dict:
    """What the takes list needs, without the settings snapshot."""
    audio = meta.get("audio")
    return {
        "id": meta["id"],
        "name": meta.get("name", meta["id"]),
        "createdAt": meta.get("createdAt"),
        "duration": meta.get("duration", 0.0),
        "frameCount": meta.get("frames", {}).get("count", 0),
        "sources": meta.get("frames", {}).get("sources", []),
        "primarySource": meta.get("primarySource"),
        "audio": audio,
        "syncOffset": meta.get("syncOffset", 0.0),
    }


class TakeRecorder:
    """Writes one take: frames as they arrive, take.json when it stops."""

    def __init__(
        self,
        store: TakeStore,
        take_id: str,
        name: str,
        t_start: float,
        settings: dict,
        primary_source: str | None = None,
    ) -> None:
        self.id = take_id
        self.name = name
        self.t_start = t_start
        self.primary_source = primary_source
        self.created = datetime.now().astimezone()
        self.dir = store.path(take_id)
        self.dir.mkdir(parents=True)
        self._frames = open(self.dir / "frames.jsonl", "w", encoding="utf-8")  # noqa: SIM115 (closed in finish)
        self._settings = settings
        self.frame_count = 0
        self.sources: set[str] = set()

    @property
    def audio_path(self) -> Path:
        return self.dir / "audio.wav"

    def add(self, frame: Frame) -> None:
        if frame.t < self.t_start:
            return
        self._frames.write(json.dumps(frame.to_json(self.t_start), separators=(",", ":")) + "\n")
        self.frame_count += 1
        self.sources.add(frame.source)

    def finish(self, t_end: float, audio: AudioTake | None) -> dict:
        self._frames.close()
        audio_meta = None
        if audio is not None and audio.samples > 0:
            start_offset = 0.0 if audio.start_time is None else audio.start_time - self.t_start
            audio_meta = {
                "file": audio.path.name,
                "sampleRate": audio.sample_rate,
                "channels": 1,
                "sampleFormat": "s24",
                "samples": audio.samples,
                "device": audio.device,
                "startOffset": round(start_offset, 4),
                "interrupted": audio.interrupted,
            }
        elif self.audio_path.exists():
            self.audio_path.unlink()
        meta = {
            "format": TAKE_FORMAT,
            "id": self.id,
            "name": self.name,
            "createdAt": self.created.isoformat(timespec="seconds"),
            "duration": round(max(0.0, t_end - self.t_start), 3),
            "frames": {"file": "frames.jsonl", "count": self.frame_count, "sources": sorted(self.sources)},
            "primarySource": self.primary_source,
            "audio": audio_meta,
            "syncOffset": 0.0,
            "settings": self._settings,
        }
        write_json(self.dir / "take.json", meta)
        return meta
