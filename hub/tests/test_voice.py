import math

import numpy as np
import pytest

from vtube_hub.arkit import INDEX
from vtube_hub.voice import DECIMATE, SAMPLE_RATE, WINDOW, VoiceFace, _LOWPASS, formants


def _one_pole(x, cutoff):
    a = math.exp(-2 * math.pi * cutoff / SAMPLE_RATE)
    y, acc = np.empty_like(x), 0.0
    for n, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[n] = acc
    return y


def _resonator(x, f, bw):
    r = math.exp(-math.pi * bw / SAMPLE_RATE)
    a1, a2 = -2 * r * math.cos(2 * math.pi * f / SAMPLE_RATE), r * r
    y, y1, y2 = np.zeros_like(x), 0.0, 0.0
    for n, v in enumerate(x):
        y0 = v - a1 * y1 - a2 * y2
        y[n], y2, y1 = y0, y1, y0
    return y


def vowel(f1, f2, seconds=0.8, f0=120, amp=0.2):
    """A synthetic vowel: voice-like pulses (-12 dB/octave) through three formants, plus lip radiation."""
    src = np.zeros(int(seconds * SAMPLE_RATE))
    src[:: SAMPLE_RATE // f0] = 1.0
    src = _one_pole(_one_pole(src, 100), 100)
    y = np.diff(_resonator(_resonator(_resonator(src, f1, 80), f2, 100), 2600, 140), prepend=0.0)
    return (y / np.abs(y).max() * amp).astype(np.float32)


VOWELS = {"ah": (750, 1200), "oo": (300, 800), "oh": (500, 900), "ee": (280, 2300)}


@pytest.mark.parametrize("name", VOWELS)
def test_formants_of_a_vowel(name):
    f1, f2 = VOWELS[name]
    window = vowel(f1, f2)[20_000 : 20_000 + WINDOW]
    found = formants(np.convolve(window, _LOWPASS, "valid")[::DECIMATE])
    assert found[0] == pytest.approx(f1, rel=0.06)
    assert found[1] == pytest.approx(f2, rel=0.06)


class Talker:
    """Feeds a VoiceFace 20 ms chunks on a steady clock, like the microphone does."""

    def __init__(self):
        self.frames = []
        self.face = VoiceFace(self.frames.append)
        self.face.start()
        self.t = 0.0
        self.rng = np.random.default_rng(3)

    def say(self, signal):
        start = len(self.frames)
        signal = signal + (self.rng.standard_normal(len(signal)) * 0.0005).astype(np.float32)
        for i in range(0, len(signal), 960):
            chunk = signal[i : i + 960]
            self.t += len(chunk) / SAMPLE_RATE
            self.face.feed(chunk, self.t)
        return self.frames[start:]

    def pause(self, seconds):
        return self.say(np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32))


def mean(frames, name):
    steady = frames[15:-3]  # past the attack, before the tail
    return float(np.mean([f.bs[INDEX[name]] for f in steady]))


def test_mouth_shapes_follow_the_vowels():
    talker = Talker()
    talker.pause(1.0)  # learns what silence sounds like
    ah = talker.say(vowel(*VOWELS["ah"]))
    talker.pause(0.3)
    oo = talker.say(vowel(*VOWELS["oo"]))
    talker.pause(0.3)
    ee = talker.say(vowel(*VOWELS["ee"]))

    assert mean(ah, "jawOpen") > 0.8
    assert mean(ah, "mouthFunnel") < 0.2 and mean(ah, "mouthPucker") < 0.2
    assert mean(oo, "mouthPucker") > 0.6 and mean(oo, "jawOpen") < 0.5
    assert mean(ee, "mouthStretchLeft") > 0.5 and mean(ee, "jawOpen") < 0.5
    assert mean(ee, "mouthPucker") < 0.1


def test_silence_closes_the_mouth():
    talker = Talker()
    talker.pause(1.0)
    talker.say(vowel(*VOWELS["ah"]))
    after = talker.pause(0.5)
    assert after[-1].bs[INDEX["jawOpen"]] < 0.02


def test_frames_come_60_a_second_stamped_with_the_audio_time():
    talker = Talker()
    frames = talker.pause(2.0)
    assert len(frames) == pytest.approx(120, abs=2)
    gaps = np.diff([f.t for f in frames])
    assert gaps == pytest.approx(np.full(len(gaps), 1 / 60), abs=1e-6)
    # Each frame describes the 32 ms of audio centered on its time.
    assert frames[0].t == pytest.approx((WINDOW / 2) / SAMPLE_RATE, abs=1e-6)
    assert all(f.source == "voice" and f.face for f in frames)


def test_it_blinks_on_its_own():
    frames = Talker().pause(6.0)
    assert max(f.bs[INDEX["eyeBlinkLeft"]] for f in frames) > 0.9


def test_nothing_comes_out_until_started():
    frames = []
    face = VoiceFace(frames.append)
    face.feed(np.zeros(9600, dtype=np.float32), 0.2)
    assert frames == []
