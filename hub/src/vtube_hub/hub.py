"""The hub itself: sources in, frames out, takes recorded."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections import deque
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from . import __version__
from .audio import AudioBackend
from .bus import Bus
from .frames import Frame, Orientation, orient
from .livelink import LiveLinkReceiver
from .netinfo import active_firewalls, lan_addresses
from .simulator import Simulator
from .store import JsonFile
from .takes import TakeRecorder, TakeStore
from .webcam import CameraSettings, WebcamTracker

log = logging.getLogger(__name__)

SOURCES = ("livelink", "webcam", "simulator")
WEBCAM_DEFAULTS = {"device": None, "width": 1280, "height": 720, "fps": 60, "keepRunning": False}
DEFAULT_CONFIG = {"activeSource": "livelink", "audioDevice": None, "webcam": WEBCAM_DEFAULTS, "orientation": {}}
MAX_SETTINGS_BYTES = 256 * 1024
METRICS_INTERVAL = 1 / 15


class Conflict(Exception):
    """The request doesn't make sense in the hub's current state."""


def _load_config(raw: dict) -> dict:
    """Saved config over the defaults, dropping anything no longer valid."""
    config = {**DEFAULT_CONFIG, **raw}
    webcam = raw.get("webcam")
    config["webcam"] = {**WEBCAM_DEFAULTS, **(webcam if isinstance(webcam, dict) else {})}
    if config["activeSource"] not in SOURCES:
        config["activeSource"] = DEFAULT_CONFIG["activeSource"]
    orientation = {}
    saved = raw.get("orientation")
    for source, fix in (saved.items() if isinstance(saved, dict) else ()):
        with contextlib.suppress(ValueError):
            if source in SOURCES:
                orientation[source] = Orientation.from_json(fix).to_json()
    config["orientation"] = orientation
    return config


def _updated_webcam(current: dict, changes: object) -> dict:
    if not isinstance(changes, dict):
        raise ValueError("webcam settings must be an object")
    unknown = set(changes) - set(WEBCAM_DEFAULTS)
    if unknown:
        raise ValueError(f"unknown webcam settings: {', '.join(sorted(unknown))}")
    new = dict(current)
    if "device" in changes:
        device = changes["device"]
        if device is not None and not isinstance(device, str):
            raise ValueError("webcam device must be a path or null")
        new["device"] = device or None
    for key, low, high in (("width", 160, 3840), ("height", 120, 2160), ("fps", 5, 120)):
        if key in changes:
            value = changes[key]
            if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
                raise ValueError(f"webcam {key} must be a whole number from {low} to {high}")
            new[key] = value
    if "keepRunning" in changes:
        if not isinstance(changes["keepRunning"], bool):
            raise ValueError("keepRunning must be true or false")
        new["keepRunning"] = changes["keepRunning"]
    return new


class Hub:
    def __init__(
        self,
        *,
        data_dir: Path,
        web_dist: Path,
        audio: AudioBackend | None,
        http_port: int = 8750,
        livelink_host: str = "0.0.0.0",
        livelink_port: int = 11111,
        clock: Callable[[], float] = time.monotonic,
        webcam_factory: Callable[..., WebcamTracker] = WebcamTracker,
    ) -> None:
        self.data_dir = data_dir
        self.web_dist = web_dist
        self.http_port = http_port
        self.clock = clock
        self.epoch = clock()
        self.bus = Bus()
        self.takes = TakeStore(data_dir / "takes")
        self._settings_file = JsonFile(data_dir / "settings.json", {})
        self._config_file = JsonFile(data_dir / "hub.json", DEFAULT_CONFIG)
        self.settings: dict = self._settings_file.load()
        self.config: dict = _load_config(self._config_file.load())
        self._orientation = self._orientation_fixes(self.config)
        self.audio = audio
        self.livelink = LiveLinkReceiver(self._on_frame, clock=clock)
        self.simulator = Simulator(self._on_frame, clock=clock)
        self.webcam = webcam_factory(self._on_frame, self._on_camera_metrics, data_dir / "models", clock=clock)
        self._livelink_addr = (livelink_host, livelink_port)
        self.recorder: TakeRecorder | None = None
        self._published: deque[float] = deque(maxlen=400)
        self._status_task: asyncio.Task | None = None
        self._webcam_lock = asyncio.Lock()
        self._webcam_task: asyncio.Task | None = None
        self._last_metrics = 0.0
        self._network: tuple[float, dict] | None = None

    # Lifecycle

    async def start(self) -> None:
        await self.livelink.listen(*self._livelink_addr)
        if self.audio is not None:
            await self.audio.start(self.config["audioDevice"])
        await self._sync_sources()
        self._status_task = asyncio.create_task(self._status_loop(), name="status")

    async def stop(self) -> None:
        if self.recorder is not None:
            with contextlib.suppress(Exception):
                await self.stop_recording()
        if self._status_task:
            self._status_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._status_task
        if self._webcam_task:
            with contextlib.suppress(Exception):
                await self._webcam_task
        await self.webcam.stop()
        await self.simulator.stop()
        self.livelink.close()
        if self.audio is not None:
            await self.audio.stop()
        await self.bus.close()

    async def _sync_sources(self) -> None:
        """Run the sources the config asks for; stop the rest."""
        if self.config["activeSource"] == "simulator":
            self.simulator.start()
        else:
            await self.simulator.stop()
        # The camera can take a few seconds (first run downloads the face model),
        # so it starts in the background; each request applies the latest config.
        self._webcam_task = asyncio.create_task(self._sync_webcam(), name="webcam-sync")

    async def _sync_webcam(self) -> None:
        async with self._webcam_lock:
            cam = self.config["webcam"]
            if self.config["activeSource"] == "webcam" or cam["keepRunning"]:
                await self.webcam.start(CameraSettings(cam["device"], cam["width"], cam["height"], cam["fps"]))
            else:
                await self.webcam.stop()

    # Frames, levels, camera metrics

    @staticmethod
    def _orientation_fixes(config: dict) -> dict[str, Orientation]:
        return {source: Orientation.from_json(fix) for source, fix in config["orientation"].items()}

    def _on_frame(self, frame: Frame) -> None:
        fix = self._orientation.get(frame.source)
        if fix is not None:
            frame = orient(frame, fix)
        if frame.source == self.config["activeSource"]:
            self._published.append(frame.t)
        # Every running source goes out (pages drive characters from the active one;
        # the Studio can compare the others) and into the take.
        self.bus.publish({"type": "frame", **frame.to_json(self.epoch)}, droppable=True)
        if self.recorder is not None:
            self.recorder.add(frame)

    def _on_camera_metrics(self, metrics: dict) -> None:
        now = self.clock()
        if now - self._last_metrics >= METRICS_INTERVAL:
            self._last_metrics = now
            self.bus.publish({"type": "camera", "metrics": metrics}, droppable=True)

    def on_level(self, rms_db: float, peak_db: float) -> None:
        self.bus.publish({"type": "level", "rms": round(rms_db, 1), "peak": round(peak_db, 1)}, droppable=True)

    async def _status_loop(self) -> None:
        while True:
            await asyncio.sleep(1.0)
            self.bus.publish({"type": "status", "status": self.status()})

    # State for the Studio

    def status(self) -> dict:
        now = self.clock()
        return {
            "activeSource": self.config["activeSource"],
            "activeFps": sum(1 for t in self._published if now - t <= 1.0),
            "livelink": self.livelink.status(),
            "webcam": self.webcam.status(),
            "simulator": {"running": self.simulator.running},
            "audio": self.audio.status() if self.audio is not None else {"running": False, "disabled": True},
            "recording": self.recording_status(),
            "clients": len(self.bus),
        }

    def recording_status(self) -> dict:
        rec = self.recorder
        if rec is None:
            return {"active": False}
        return {
            "active": True,
            "takeId": rec.id,
            "name": rec.name,
            "elapsed": round(self.clock() - rec.t_start, 2),
            "frames": rec.frame_count,
        }

    def network(self) -> dict:
        """Addresses and firewalls, refreshed at most every 10 s (they shell out to ip and systemctl)."""
        now = self.clock()
        if self._network is None or now - self._network[0] > 10.0:
            info = {
                "addresses": lan_addresses(),
                "firewalls": active_firewalls(),
                "livelinkPort": self.livelink.port or self._livelink_addr[1],
                "httpPort": self.http_port,
            }
            self._network = (now, info)
        return self._network[1]

    def state(self) -> dict:
        return {
            "version": __version__,
            "settings": self.settings,
            "config": self.config,
            "status": self.status(),
            "takes": self.takes.list(),
            "network": self.network(),
            "dataDir": str(self.data_dir),
        }

    def camera_device(self) -> str:
        device = self.webcam.device or self.config["webcam"]["device"]
        if not device or not device.startswith("/dev/"):
            raise Conflict("the camera isn't running")
        return device

    # Changes from the Studio

    def set_settings(self, settings: object) -> dict:
        if not isinstance(settings, dict):
            raise ValueError("settings must be a JSON object")
        if len(json.dumps(settings)) > MAX_SETTINGS_BYTES:
            raise ValueError("settings are too large")
        self.settings = settings
        self._settings_file.save(settings)
        self.bus.publish({"type": "settings", "settings": settings})
        return settings

    async def update_config(self, changes: object) -> dict:
        if not isinstance(changes, dict):
            raise ValueError("config changes must be a JSON object")
        unknown = set(changes) - set(DEFAULT_CONFIG)
        if unknown:
            raise ValueError(f"unknown config keys: {', '.join(sorted(unknown))}")
        new = dict(self.config)
        if "activeSource" in changes:
            if changes["activeSource"] not in SOURCES:
                raise ValueError(f"activeSource must be one of {', '.join(SOURCES)}")
            new["activeSource"] = changes["activeSource"]
        if "audioDevice" in changes:
            device = changes["audioDevice"]
            if device is not None and not isinstance(device, str):
                raise ValueError("audioDevice must be a source name or null")
            new["audioDevice"] = device or None
        if "webcam" in changes:
            new["webcam"] = _updated_webcam(self.config["webcam"], changes["webcam"])
        if "orientation" in changes:
            fixes = changes["orientation"]
            if not isinstance(fixes, dict):
                raise ValueError("orientation must map sources to fixes")
            orientation = dict(self.config["orientation"])
            for source, fix in fixes.items():
                if source not in SOURCES:
                    raise ValueError(f"unknown source {source!r}")
                orientation[source] = Orientation.from_json(fix).to_json()
            new["orientation"] = orientation
        device_changed = new["audioDevice"] != self.config["audioDevice"]
        if device_changed and self.recorder is not None:
            raise Conflict("can't switch microphones while recording")
        old, self.config = self.config, new
        self._orientation = self._orientation_fixes(new)
        self._config_file.save(new)
        if new["activeSource"] != old["activeSource"] or new["webcam"] != old["webcam"]:
            await self._sync_sources()
        if device_changed and self.audio is not None:
            await self.audio.start(new["audioDevice"])
        self.bus.publish({"type": "config", "config": new})
        return new

    async def start_recording(self, name: object = None) -> dict:
        if self.recorder is not None:
            raise Conflict("already recording")
        if name is not None and not isinstance(name, str):
            raise ValueError("name must be a string")
        now = datetime.now()
        take_id = self.takes.new_id(now)
        title = (name or "").strip()[:120] or f"Take {now:%b %d %H:%M:%S}"
        self.recorder = TakeRecorder(
            self.takes, take_id, title, self.clock(), self.settings, primary_source=self.config["activeSource"]
        )
        if self.audio is not None:
            self.audio.begin_take(self.recorder.audio_path)
        status = self.recording_status()
        self.bus.publish({"type": "recording", "recording": status})
        log.info("recording take %s", take_id)
        return status

    async def stop_recording(self) -> dict:
        rec, self.recorder = self.recorder, None
        if rec is None:
            raise Conflict("not recording")
        audio = self.audio.end_take() if self.audio is not None else None
        meta = rec.finish(self.clock(), audio)
        self.bus.publish({"type": "recording", "recording": self.recording_status()})
        self.publish_takes()
        log.info("saved take %s (%.1f s, %d frames)", rec.id, meta["duration"], meta["frames"]["count"])
        return meta

    def publish_takes(self) -> None:
        self.bus.publish({"type": "takes", "takes": self.takes.list()})
