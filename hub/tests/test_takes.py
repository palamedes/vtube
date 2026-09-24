import json
import wave
from datetime import datetime
from pathlib import Path

import pytest

from vtube_hub.audio import AudioTake
from vtube_hub.frames import Frame, rest_blendshapes
from vtube_hub.takes import TakeRecorder, TakeStore


def frame(t: float, jaw: float = 0.0) -> Frame:
    bs = rest_blendshapes()
    bs[17] = jaw
    return Frame(t=t, source="livelink", seq=int(t * 60), face=True, bs=bs, head=(0.1, 0.0, 0.0))


def write_wav(path: Path, samples: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(3)
        w.setframerate(48000)
        w.writeframes(b"\x00\x00\x00" * samples)


def test_record_and_read_back(tmp_path: Path):
    store = TakeStore(tmp_path / "takes")
    take_id = store.new_id(datetime(2026, 9, 24, 15, 30, 12))
    assert take_id == "20260924-153012"
    rec = TakeRecorder(store, take_id, "First read", t_start=100.0, settings={"mirror": True})
    rec.add(frame(99.9))  # before the take started: ignored
    rec.add(frame(100.5, jaw=0.4))
    rec.add(frame(101.0, jaw=0.2))
    write_wav(rec.audio_path, 48000)
    audio = AudioTake(path=rec.audio_path, samples=48000, sample_rate=48000, start_time=100.012, device="mic")
    meta = rec.finish(t_end=102.0, audio=audio)

    assert meta["duration"] == 2.0
    assert meta["frames"]["count"] == 2
    assert meta["audio"]["startOffset"] == 0.012
    assert meta["settings"] == {"mirror": True}
    lines = (tmp_path / "takes" / take_id / "frames.jsonl").read_text().splitlines()
    first = json.loads(lines[0])
    assert first["t"] == 0.5
    assert first["bs"][17] == 0.4

    [listed] = store.list()
    assert listed["name"] == "First read"
    assert "settings" not in listed


def test_ids_never_collide(tmp_path: Path):
    store = TakeStore(tmp_path)
    now = datetime(2026, 9, 24, 15, 30, 12)
    first = store.new_id(now)
    store.path(first).mkdir()
    assert store.new_id(now) == "20260924-153012-2"


def test_take_without_audio_drops_the_empty_wav(tmp_path: Path):
    store = TakeStore(tmp_path)
    rec = TakeRecorder(store, "20260924-100000", "Silent", t_start=0.0, settings={})
    rec.audio_path.write_bytes(b"")
    meta = rec.finish(t_end=1.0, audio=None)
    assert meta["audio"] is None
    assert not rec.audio_path.exists()


def test_update_and_delete(tmp_path: Path):
    store = TakeStore(tmp_path)
    rec = TakeRecorder(store, "20260924-100000", "Old", t_start=0.0, settings={})
    rec.finish(t_end=1.0, audio=None)
    assert store.update("20260924-100000", {"name": "  New name  ", "syncOffset": 0.08})["name"] == "New name"
    assert store.read("20260924-100000")["syncOffset"] == 0.08
    with pytest.raises(ValueError):
        store.update("20260924-100000", {"syncOffset": 5})
    with pytest.raises(ValueError):
        store.update("20260924-100000", {"duration": 1})
    store.delete("20260924-100000")
    assert store.list() == []


@pytest.mark.parametrize("bad", ["../etc", "20260924-100000/../../x", "", "abc"])
def test_rejects_unsafe_ids(tmp_path: Path, bad: str):
    with pytest.raises(KeyError):
        TakeStore(tmp_path).path(bad)
