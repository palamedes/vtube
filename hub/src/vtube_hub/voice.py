"""A face driven by the voice alone: no camera, the microphone moves the mouth.

Loudness opens the jaw, and a formant estimate of each moment tells open
vowels ("ah") from rounded ones ("oo", "oh") and spread ones ("ee"); silence
closes the mouth. Around that it adds what a talking face does anyway:
blinks every few seconds, small nods and brow lifts on emphasis, and a slow
sway. Frames go out 60 times a second, stamped with the time of the audio
they describe, so a recorded take lines up with its own sound.

Levels adapt to the room and the microphone: the quietest recent level is
taken as silence and the loudest recent speech as fully open.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable

import numpy as np

from .arkit import INDEX
from .frames import Frame, rest_blendshapes

SAMPLE_RATE = 48_000
HOP = SAMPLE_RATE // 60  # one frame per 1/60 s of audio
WINDOW = 1536  # 32 ms analysed per frame
DECIMATE = 4  # formants are estimated at 12 kHz
LPC_RATE = SAMPLE_RATE // DECIMATE
LPC_ORDER = 12


def _smoothstep(edge0: float, edge1: float, x: float) -> float:
    k = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return k * k * (3 - 2 * k)


def _lowpass_taps(cutoff: float, rate: float, taps: int = 63) -> np.ndarray:
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * cutoff / rate * n) * np.hamming(taps)
    return h / h.sum()


_LOWPASS = _lowpass_taps(5_000, SAMPLE_RATE)
_HANN = np.hanning(WINDOW).astype(np.float32)


def formants(x: np.ndarray, rate: float = LPC_RATE, order: int = LPC_ORDER) -> list[float]:
    """Resonance frequencies (Hz, rising) of a short voiced sound, by linear prediction."""
    x = np.append(x[0], x[1:] - 0.9 * x[:-1]) * np.hamming(len(x))  # pre-emphasis, window
    r = np.correlate(x, x, "full")[len(x) - 1 : len(x) + order]
    if r[0] <= 1e-12:
        return []
    # Levinson-Durbin recursion for the predictor coefficients.
    a = np.zeros(order + 1)
    a[0] = 1.0
    err = r[0]
    for i in range(1, order + 1):
        k = -(r[i] + np.dot(a[1:i], r[i - 1 : 0 : -1])) / err
        a[1 : i + 1] = a[1 : i + 1] + k * a[i - 1 :: -1][: i]
        err *= 1 - k * k
        if err <= 0:
            return []
    roots = np.roots(a)
    roots = roots[np.imag(roots) > 0.01]
    freqs = np.angle(roots) * rate / (2 * math.pi)
    bandwidths = -np.log(np.abs(roots)) * rate / math.pi
    keep = (freqs > 200) & (freqs < rate / 2 - 200) & (bandwidths < 500)
    return sorted(float(f) for f in freqs[keep])


def voicing(x: np.ndarray, rate: float = LPC_RATE) -> float:
    """How periodic the sound is (0 noise .. 1 a clean tone), from autocorrelation at speaking pitches."""
    x = x - x.mean()
    r = np.correlate(x, x, "full")[len(x) - 1 :]
    if r[0] <= 1e-12:
        return 0.0
    lo, hi = int(rate / 400), int(rate / 70)
    return float(max(0.0, r[lo:hi].max() / r[0]))


class VoiceFace:
    """Microphone chunks in, face frames out (through `on_frame`)."""

    def __init__(self, on_frame: Callable[[Frame], None], *, seed: int = 11) -> None:
        self._on_frame = on_frame
        self._rng = random.Random(seed)
        self.running = False
        self._buffer = np.zeros(0, dtype=np.float32)
        self._buffer_start = 0  # sample index of _buffer[0]
        self._next_hop = WINDOW  # sample index where the next frame's window ends
        self._seq = 0
        self._floor = -70.0  # quietest recent level, dBFS
        self._peak = -30.0  # loudest recent speech, dBFS
        self._shape = {"jaw": 0.0, "funnel": 0.0, "pucker": 0.0, "stretch": 0.0, "smile": 0.0}
        self._history: list[float] = []  # recent levels, for spotting emphasis
        self._emphasis_at = -10.0
        self._next_blink = 1.5
        self._blink_at = -10.0
        self.last_level = -120.0

    def start(self) -> None:
        if not self.running:
            self.running = True
            self._buffer = np.zeros(0, dtype=np.float32)
            self._next_hop = self._buffer_start + WINDOW

    def stop(self) -> None:
        self.running = False

    def feed(self, chunk: np.ndarray, t_end: float) -> None:
        """Add samples; `t_end` is the hub clock time of the chunk's last sample."""
        if not self.running:
            return
        self._buffer = np.concatenate([self._buffer, np.asarray(chunk, dtype=np.float32)])
        end = self._buffer_start + len(self._buffer)
        while self._next_hop <= end:
            lo = self._next_hop - WINDOW - self._buffer_start
            window = self._buffer[lo : lo + WINDOW]
            center = self._next_hop - WINDOW // 2
            self._emit(window, t_end - (end - center) / SAMPLE_RATE)
            self._next_hop += HOP
        # Keep only what the next window needs.
        drop = max(0, self._next_hop - WINDOW - self._buffer_start)
        if drop:
            self._buffer = self._buffer[drop:]
            self._buffer_start += drop

    def _emit(self, window: np.ndarray, t: float) -> None:
        dt = HOP / SAMPLE_RATE
        rms = float(np.sqrt(np.mean(window.astype(np.float64) ** 2)))
        level = 20 * math.log10(max(rms, 1e-7))
        self.last_level = level
        # Silence drifts up slowly and drops at once; speech peaks rise at once and fade slowly.
        self._floor = level if level < self._floor else self._floor + 1.0 * dt
        self._floor = min(max(self._floor, -100.0), -25.0)
        self._peak = level if level > self._peak else self._peak - 2.5 * dt
        self._peak = max(self._peak, self._floor + 24)
        gate = self._floor + 10
        loud = _smoothstep(gate, self._peak - 4, level) ** 0.8

        # Vowel quality from the formants of voiced sound.
        low = np.convolve(window, _LOWPASS, "valid")[::DECIMATE]
        spectrum = np.abs(np.fft.rfft(window * _HANN)) ** 2
        freqs = np.fft.rfftfreq(WINDOW, 1 / SAMPLE_RATE)
        total = float(spectrum[freqs > 80].sum()) + 1e-12
        hiss = float(spectrum[freqs > 3_500].sum()) / total  # s, sh, f, t
        periodic = voicing(low)
        open_amount, back, front = 0.45, 0.0, 0.0
        if loud > 0 and periodic > 0.3:
            found = formants(low)
            if len(found) >= 2:
                f1, f2 = found[0], found[1]
                open_amount = _smoothstep(300, 750, f1)
                back = 1 - _smoothstep(900, 1_250, f2)
                front = _smoothstep(1_700, 2_300, f2)
        fricative = hiss > 0.35 and periodic < 0.3

        target = {
            "jaw": loud * (0.25 + 0.75 * open_amount),
            "funnel": loud * back * (0.35 + 0.65 * open_amount),
            "pucker": loud * back * (1 - open_amount),
            "stretch": loud * front * 0.75,
            "smile": loud * front * 0.25,
        }
        if fricative:
            target["jaw"] = min(target["jaw"], 0.12)
            target["stretch"] = max(target["stretch"], 0.35 * loud)
        # Mouths open fast and close a little slower; shapes glide.
        for key, value in target.items():
            tau = (0.012 if value > self._shape[key] else 0.05) if key == "jaw" else 0.04
            self._shape[key] += (value - self._shape[key]) * (1 - math.exp(-dt / tau))

        # Emphasis: a jump in loudness over the last 0.1 s starts a small nod and brow lift.
        self._history.append(level)
        if len(self._history) > 7:
            self._history.pop(0)
        if level > gate and level - self._history[0] > 9 and t - self._emphasis_at > 0.6:
            self._emphasis_at = t
        emphasis = _pulse(t, self._emphasis_at, 0.45)

        if t >= self._next_blink:
            self._blink_at = t
            self._next_blink = t + self._rng.uniform(2.2, 5.5)
        blink = _pulse(t, self._blink_at, 0.17)

        s = self._shape
        bs = rest_blendshapes()
        values = {
            "jawOpen": s["jaw"],
            "mouthFunnel": s["funnel"],
            "mouthPucker": s["pucker"],
            "mouthStretchLeft": s["stretch"],
            "mouthStretchRight": s["stretch"],
            "mouthSmileLeft": s["smile"],
            "mouthSmileRight": s["smile"],
            "mouthLowerDownLeft": s["jaw"] * 0.3,
            "mouthLowerDownRight": s["jaw"] * 0.3,
            "mouthUpperUpLeft": s["jaw"] * 0.15,
            "mouthUpperUpRight": s["jaw"] * 0.15,
            "eyeBlinkLeft": blink,
            "eyeBlinkRight": blink,
            "browInnerUp": emphasis * 0.35,
            "browOuterUpLeft": emphasis * 0.25,
            "browOuterUpRight": emphasis * 0.25,
        }
        for name, value in values.items():
            bs[INDEX[name]] = min(1.0, max(0.0, value))
        tau = 2 * math.pi
        yaw = 0.05 * math.sin(tau * t / 7.3) + 0.025 * math.sin(tau * t / 3.1 + 1.0)
        pitch = 0.02 * math.sin(tau * t / 4.4) - 0.06 * emphasis
        roll = 0.03 * math.sin(tau * t / 5.7 + 2.0)
        self._seq += 1
        self._on_frame(Frame(t=t, source="voice", seq=self._seq, face=True, bs=bs, head=(yaw, pitch, roll)))


def _pulse(t: float, start: float, length: float) -> float:
    """A smooth 0 -> 1 -> 0 bump over [start, start + length]."""
    x = (t - start) / length
    return math.sin(math.pi * x) ** 2 if 0.0 <= x <= 1.0 else 0.0
