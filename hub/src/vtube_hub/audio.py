"""Microphone capture through PipeWire.

The hub records the voice itself; the phone only sends face data. `pw-record`
streams raw float samples from the chosen source, the hub meters them for
the Studio, and while a take is recording it writes them to a 24-bit WAV.

Every chunk's arrival time feeds a clock fit, so each take knows when its
first audio sample happened on the same clock that stamps the face frames.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import shutil
import time
import wave
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 48_000
CHUNK_FRAMES = 960  # 20 ms per read
CHUNK_BYTES = CHUNK_FRAMES * 4  # mono float32
LEVEL_EVERY = 2  # chunks per level update, so 25 updates a second
RESTART_DELAY = 2.0


@dataclass(slots=True)
class AudioTake:
    """What a finished take needs to know about its audio file."""

    path: Path
    samples: int
    sample_rate: int
    start_time: float | None  # hub clock time of sample 0, None if unknown
    device: str | None
    interrupted: bool = False


class AudioBackend(Protocol):
    def status(self) -> dict: ...
    async def start(self, device: str | None) -> None: ...
    async def stop(self) -> None: ...
    def begin_take(self, path: Path) -> None: ...
    def end_take(self) -> AudioTake | None: ...


def pcm24(samples: np.ndarray) -> bytes:
    """Float samples in [-1, 1] to little-endian 24-bit PCM."""
    ints = np.round(np.clip(samples, -1.0, 1.0) * 8_388_607.0).astype("<i4")
    return ints.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()


def dbfs(value: float) -> float:
    return 20.0 * math.log10(max(value, 1e-6))


class ClockFit:
    """Estimates the hub-clock time of sample 0 from chunk arrival times.

    A chunk arrives some time after its last sample was captured. The delay
    varies but never drops below the true pipeline latency, so the earliest
    arrival relative to sample position within a recent window is the best
    estimate. The window lets the fit follow slow drift between the sound
    card's clock and the system clock.
    """

    def __init__(self, sample_rate: int = SAMPLE_RATE, window: int = 500) -> None:
        self.sample_rate = sample_rate
        self._origins: deque[float] = deque(maxlen=window)

    def add(self, arrival: float, samples_end: int) -> None:
        self._origins.append(arrival - samples_end / self.sample_rate)

    def time_of(self, sample_index: int) -> float | None:
        if not self._origins:
            return None
        return min(self._origins) + sample_index / self.sample_rate


async def list_sources() -> list[dict]:
    """PipeWire/Pulse sources, microphones first, monitors last."""
    exe = shutil.which("pactl")
    if exe is None:
        return []
    proc = await asyncio.create_subprocess_exec(
        exe, "-f", "json", "list", "sources", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
    )
    out, _ = await proc.communicate()
    try:
        sources = json.loads(out or b"[]")
    except json.JSONDecodeError:
        return []
    result = [
        {
            "name": s["name"],
            "description": s.get("description") or s["name"],
            "monitor": s["name"].endswith(".monitor"),
        }
        for s in sources
        if isinstance(s, dict) and s.get("name")
    ]
    result.sort(key=lambda s: (s["monitor"], s["description"].lower()))
    return result


async def default_source() -> str | None:
    exe = shutil.which("pactl")
    if exe is None:
        return None
    proc = await asyncio.create_subprocess_exec(
        exe, "get-default-source", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
    )
    out, _ = await proc.communicate()
    name = out.decode().strip()
    return name or None


class AudioCapture:
    """Always-on capture of one PipeWire source, with take recording on demand."""

    def __init__(
        self,
        on_level: Callable[[float, float], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
        on_chunk: Callable[[np.ndarray, float], None] | None = None,
    ) -> None:
        self._on_level = on_level
        self._on_chunk = on_chunk  # every chunk and the time it arrived, for the voice source
        self._clock = clock
        self._device: str | None = None
        self._resolved: str | None = None
        self._task: asyncio.Task | None = None
        self._running = False
        self._error: str | None = None
        self._fit = ClockFit()
        self._samples = 0
        self._pending_take: Path | None = None
        self._writer: wave.Wave_write | None = None
        self._take_path: Path | None = None
        self._take_first = 0
        self._take_samples = 0
        self._take_start: float | None = None
        self._take_interrupted = False

    def status(self) -> dict:
        return {
            "running": self._running,
            "device": self._device,
            "resolvedDevice": self._resolved,
            "error": self._error,
            "sampleRate": SAMPLE_RATE,
        }

    async def start(self, device: str | None) -> None:
        await self.stop()
        self._device = device
        self._resolved = device or await default_source()
        self._error = None
        self._task = asyncio.create_task(self._supervise(), name="audio-capture")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._running = False

    def begin_take(self, path: Path) -> None:
        self._pending_take = path

    def end_take(self) -> AudioTake | None:
        self._pending_take = None
        writer, self._writer = self._writer, None
        if writer is None or self._take_path is None:
            return None
        writer.close()
        return AudioTake(
            path=self._take_path,
            samples=self._take_samples,
            sample_rate=SAMPLE_RATE,
            start_time=self._take_start,
            device=self._resolved,
            interrupted=self._take_interrupted,
        )

    async def _supervise(self) -> None:
        while True:
            try:
                await self._capture()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # keep the hub alive; the Studio shows the error
                self._error = f"audio capture failed: {exc}"
                log.exception("audio capture failed")
            self._running = False
            await asyncio.sleep(RESTART_DELAY)

    async def _capture(self) -> None:
        exe = shutil.which("pw-record")
        if exe is None:
            self._error = "pw-record not found; install PipeWire's tools to record audio"
            return
        cmd = [exe, "--raw", "--format", "f32", "--rate", str(SAMPLE_RATE), "--channels", "1", "--latency", "20ms"]
        if self._device:
            cmd += ["--target", self._device]
        cmd.append("-")
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        assert proc.stdout is not None and proc.stderr is not None
        # Sample positions restart with every pw-record process.
        self._fit = ClockFit()
        self._samples = 0
        chunks = 0
        sum_sq = 0.0
        peak = 0.0
        try:
            while True:
                data = await proc.stdout.readexactly(CHUNK_BYTES)
                now = self._clock()
                chunk = np.frombuffer(data, dtype="<f4")
                first = self._samples
                self._samples += CHUNK_FRAMES
                self._fit.add(now, self._samples)
                if not self._running:
                    self._running = True
                    self._error = None
                self._record(chunk, first)
                if self._on_chunk:
                    self._on_chunk(chunk, now)
                chunks += 1
                sum_sq += float(np.dot(chunk, chunk))
                peak = max(peak, float(np.max(np.abs(chunk))))
                if chunks == LEVEL_EVERY:
                    if self._on_level:
                        self._on_level(dbfs(math.sqrt(sum_sq / (CHUNK_FRAMES * chunks))), dbfs(peak))
                    chunks, sum_sq, peak = 0, 0.0, 0.0
        except asyncio.IncompleteReadError:
            detail = (await proc.stderr.read()).decode(errors="replace").strip()
            self._error = f"pw-record stopped: {detail[-200:] or 'no output'}"
            log.warning(self._error)
        finally:
            if proc.returncode is None:
                proc.terminate()
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(proc.wait(), 2.0)
            if self._writer is not None:
                # The rest of this take has no audio; keep what was captured.
                self._take_interrupted = True
                self._pending_take = None

    def _record(self, chunk: np.ndarray, first: int) -> None:
        if self._pending_take is not None and self._writer is None:
            path = self._pending_take
            writer = wave.open(str(path), "wb")
            writer.setnchannels(1)
            writer.setsampwidth(3)
            writer.setframerate(SAMPLE_RATE)
            self._writer = writer
            self._take_path = path
            self._take_first = first
            self._take_samples = 0
            self._take_interrupted = False
        if self._writer is not None and not self._take_interrupted:
            self._writer.writeframes(pcm24(chunk))
            self._take_samples += len(chunk)
            self._take_start = self._fit.time_of(self._take_first)
