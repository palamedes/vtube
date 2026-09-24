import numpy as np

from vtube_hub.audio import ClockFit, pcm24


def test_pcm24_packs_little_endian_24_bit():
    data = pcm24(np.array([0.0, 1.0, -1.0, 0.5, 2.0], dtype=np.float32))
    assert len(data) == 15
    samples = [int.from_bytes(data[i : i + 3], "little", signed=True) for i in range(0, 15, 3)]
    assert samples == [0, 8_388_607, -8_388_607, 4_194_304, 8_388_607]  # 2.0 clips


def test_clock_fit_uses_the_earliest_arrival():
    fit = ClockFit(sample_rate=1000)
    # Sample 0 truly happened at t=10.0; every chunk of 100 samples arrives
    # 5 ms after its last sample, plus up to 20 ms of scheduling jitter.
    jitter = [0.020, 0.0, 0.013, 0.007, 0.019]
    for i, extra in enumerate(jitter, start=1):
        fit.add(arrival=10.0 + i * 0.1 + 0.005 + extra, samples_end=i * 100)
    assert abs(fit.time_of(0) - 10.005) < 1e-9
    assert abs(fit.time_of(250) - 10.255) < 1e-9


def test_clock_fit_without_data():
    assert ClockFit().time_of(0) is None
