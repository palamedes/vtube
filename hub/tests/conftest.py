"""Shared test doubles: a hub with fake audio and a fake camera, so tests never touch real devices."""

import wave
from pathlib import Path

import pytest

from vtube_hub.audio import AudioTake
from vtube_hub.hub import Hub


class FakeAudio:
    """Stands in for pw-record: writes half a second of silence per take."""

    def __init__(self) -> None:
        self.device = "unset"
        self.path: Path | None = None

    def status(self) -> dict:
        return {"running": True, "device": self.device, "error": None, "sampleRate": 48000}

    async def start(self, device):
        self.device = device

    async def stop(self):
        pass

    def begin_take(self, path: Path) -> None:
        self.path = path

    def end_take(self):
        if self.path is None:
            return None
        with wave.open(str(self.path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(3)
            w.setframerate(48000)
            w.writeframes(b"\x00\x00\x00" * 24000)
        take = AudioTake(path=self.path, samples=24000, sample_rate=48000, start_time=None, device=self.device)
        self.path = None
        return take


class FakeWebcam:
    """Stands in for the camera tracker; tests push frames through `emit`."""

    def __init__(self, on_frame, on_metrics, models_dir, clock=None) -> None:
        self.on_frame = on_frame
        self.on_metrics = on_metrics
        self.settings = None
        self.device = None
        self.running = False

    def status(self) -> dict:
        return {"state": "running" if self.running else "off", "running": self.running, "device": self.device}

    async def start(self, settings) -> None:
        self.settings, self.device, self.running = settings, settings.device or "/dev/video0", True

    async def stop(self) -> None:
        self.running = False

    def want_preview(self) -> None:
        pass

    def preview(self):
        return (0, None)

    def emit(self, frame) -> None:
        self.on_frame(frame)


@pytest.fixture
def hub(tmp_path: Path) -> Hub:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>studio</title>")
    (dist / "render.html").write_text("<!doctype html><title>render</title>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    return Hub(
        data_dir=tmp_path / "data",
        web_dist=dist,
        audio=FakeAudio(),
        livelink_host="127.0.0.1",
        livelink_port=0,
        webcam_factory=FakeWebcam,
    )
