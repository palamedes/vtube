"""A synthetic performer, for building and testing without the phone.

It talks in phrases with pauses, blinks every few seconds, reads a script
(the eyes sweep across each line and snap back, which is exactly the motion
gaze damping has to tame), smiles now and then, raises its brows on emphasis,
and sways its head. The output is a pure function of time, so tests can rely
on it.
"""

from __future__ import annotations

import asyncio
import math
import random
import time
from collections.abc import Callable

from .arkit import INDEX
from .frames import Frame, rest_blendshapes

TAU = 2 * math.pi


def _smoothstep(edge0: float, edge1: float, x: float) -> float:
    k = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return k * k * (3 - 2 * k)


def _pulse(t: float, start: float, length: float) -> float:
    """A smooth 0 -> 1 -> 0 bump over [start, start + length]."""
    x = (t - start) / length
    return math.sin(math.pi * x) ** 2 if 0.0 <= x <= 1.0 else 0.0


class Simulator:
    def __init__(
        self,
        on_frame: Callable[[Frame], None],
        *,
        clock: Callable[[], float] = time.monotonic,
        fps: float = 60.0,
        seed: int = 7,
    ) -> None:
        self._on_frame = on_frame
        self._clock = clock
        self._fps = fps
        rng = random.Random(seed)
        # Blink schedule: every 2.2 to 5.5 s, looped every ~5 minutes.
        self._blinks: list[float] = []
        t = 1.0
        while t < 300.0:
            self._blinks.append(t)
            t += rng.uniform(2.2, 5.5)
        self._task: asyncio.Task | None = None
        self._start = 0.0
        self._seq = 0

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        if not self.running:
            self._start = self._clock()
            self._task = asyncio.create_task(self._run(), name="simulator")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        period = 1.0 / self._fps
        next_tick = self._clock()
        while True:
            now = self._clock()
            self._seq += 1
            self._on_frame(self.sample(now - self._start, now, self._seq))
            next_tick += period
            await asyncio.sleep(max(0.0, next_tick - self._clock()))

    def sample(self, t: float, stamp: float | None = None, seq: int = 0) -> Frame:
        bs = rest_blendshapes()

        def put(name: str, value: float) -> None:
            bs[INDEX[name]] = min(1.0, max(0.0, value))

        # Phrases of ~6 s of talking, then ~1.4 s of pause.
        phase = t % 7.4
        talking = _smoothstep(0.0, 0.25, phase) * (1.0 - _smoothstep(5.8, 6.1, phase))
        syllable = max(0.0, math.sin(TAU * 4.2 * t + 0.9 * math.sin(TAU * 0.63 * t))) ** 1.4
        jaw = talking * (0.12 + 0.48 * syllable * (0.7 + 0.3 * math.sin(TAU * 0.37 * t)))
        put("jawOpen", jaw)
        put("mouthClose", 0.06 * (1.0 - talking))
        oo = talking * max(0.0, math.sin(TAU * 0.83 * t + 1.1)) ** 8
        put("mouthFunnel", 0.55 * oo)
        put("mouthPucker", 0.35 * oo + 0.4 * talking * max(0.0, math.sin(TAU * 1.31 * t)) ** 12)
        put("mouthLowerDownLeft", 0.3 * jaw)
        put("mouthLowerDownRight", 0.3 * jaw)
        put("mouthUpperUpLeft", 0.15 * jaw)
        put("mouthUpperUpRight", 0.15 * jaw)
        put("mouthStretchLeft", 0.15 * talking * syllable)
        put("mouthStretchRight", 0.15 * talking * syllable)

        # A slow smile that comes and goes, slightly lopsided.
        smile = 0.12 + 0.5 * _smoothstep(0.55, 0.95, math.sin(TAU * t / 23.0))
        put("mouthSmileLeft", smile)
        put("mouthSmileRight", smile * 0.9)
        put("cheekSquintLeft", 0.6 * smile)
        put("cheekSquintRight", 0.55 * smile)
        put("eyeSquintLeft", 0.25 * smile)
        put("eyeSquintRight", 0.25 * smile)

        # Emphasis: brows up and a small nod every ~4.7 s while talking.
        emphasis = talking * _pulse(t % 4.7, 1.6, 0.7)
        put("browInnerUp", 0.1 + 0.55 * emphasis)
        put("browOuterUpLeft", 0.45 * emphasis)
        put("browOuterUpRight", 0.45 * emphasis)
        frown = _pulse(t % 31.0, 18.0, 2.5)
        put("browDownLeft", 0.5 * frown)
        put("browDownRight", 0.5 * frown)
        put("mouthFrownLeft", 0.3 * frown)
        put("mouthFrownRight", 0.3 * frown)

        # Blinks.
        loop_t = t % 300.0
        blink = max((_pulse(loop_t, b, 0.16) for b in self._blinks if b - 0.2 < loop_t < b + 0.4), default=0.0)
        put("eyeBlinkLeft", 0.95 * blink)
        put("eyeBlinkRight", 0.95 * blink)

        # Reading: eyes sweep across a line toward the performer's left over
        # 2.4 s, then snap back to the start of the next line. Glance up at
        # the camera now and then.
        line = t % 2.8
        sweep = -0.55 + 1.1 * min(1.0, line / 2.4) if line < 2.4 else 0.55 - 1.1 * (line - 2.4) / 0.4
        glance = _pulse(t % 13.0, 9.0, 1.6)
        gaze_x = sweep * (1.0 - glance)
        gaze_down = 0.35 * (1.0 - glance)
        left_look = max(0.0, gaze_x)
        right_look = max(0.0, -gaze_x)
        put("eyeLookOutLeft", left_look)
        put("eyeLookInRight", left_look)
        put("eyeLookInLeft", right_look)
        put("eyeLookOutRight", right_look)
        put("eyeLookDownLeft", gaze_down)
        put("eyeLookDownRight", gaze_down)

        yaw = 0.10 * math.sin(TAU * 0.11 * t) + 0.04 * math.sin(TAU * 0.37 * t + 1.3)
        pitch = 0.04 * math.sin(TAU * 0.17 * t + 0.4) - 0.05 * emphasis - 0.03
        roll = 0.05 * math.sin(TAU * 0.09 * t + 2.1)
        eye_yaw = 0.35 * gaze_x
        eye_pitch = -0.2 * gaze_down
        return Frame(
            t=self._clock() if stamp is None else stamp,
            source="simulator",
            seq=seq,
            face=True,
            bs=bs,
            head=(yaw, pitch, roll),
            eye_left=(eye_yaw, eye_pitch, 0.0),
            eye_right=(eye_yaw, eye_pitch, 0.0),
        )
