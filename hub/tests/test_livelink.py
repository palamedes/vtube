import struct

import pytest

from vtube_hub.arkit import BLENDSHAPES, INDEX
from vtube_hub.livelink import (
    VALUE_COUNT,
    LiveLinkReceiver,
    PacketError,
    encode_packet,
    packet_to_frame,
    parse_packet,
)


def handmade_packet(values: list[float], device: bytes = b"ABCD", subject: bytes = b"iPhone") -> bytes:
    """Built byte by byte from the documented layout, independent of encode_packet."""
    return (
        b"\x06"
        + struct.pack(">i", len(device))
        + device
        + struct.pack(">i", len(subject))
        + subject
        + struct.pack(">i", 123456)  # frame number
        + struct.pack(">f", 0.5)  # subframe
        + struct.pack(">ii", 60, 1)  # rate
        + bytes([len(values)])
        + b"".join(struct.pack(">f", v) for v in values)
    )


def test_parses_the_documented_layout():
    values = [0.0] * VALUE_COUNT
    values[INDEX["jawOpen"]] = 0.75
    values[52] = 0.25  # head yaw
    values[60] = -0.125  # right eye roll
    packet = parse_packet(handmade_packet(values))
    assert packet.version == 6
    assert packet.device_id == "ABCD"
    assert packet.subject == "iPhone"
    assert packet.frame_number == 123456
    assert packet.subframe == 0.5
    assert packet.rate == (60, 1)
    assert packet.has_face
    assert packet.values[INDEX["jawOpen"]] == 0.75
    frame = packet_to_frame(packet, t=10.0, seq=1)
    assert frame.bs[INDEX["jawOpen"]] == 0.75
    assert frame.head == (0.25, 0.0, 0.0)
    assert frame.eye_right == (0.0, 0.0, -0.125)


def test_encode_matches_the_handmade_layout():
    values = [i / 100 for i in range(VALUE_COUNT)]
    ours = encode_packet(values, device_id="ABCD", subject="iPhone", frame_number=123456, subframe=0.5)
    assert ours == handmade_packet(values)


def test_header_only_packet_means_no_face():
    packet = parse_packet(encode_packet(None, subject="iPhone"))
    assert not packet.has_face
    frame = packet_to_frame(packet, t=1.0, seq=1)
    assert frame.face is False
    assert frame.bs == [0.0] * len(BLENDSHAPES)


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"\x06\x00\x00",
        b"\x06" + struct.pack(">i", 5000) + b"x" * 10,
        encode_packet([0.0] * VALUE_COUNT)[:-5],
        encode_packet(None) + b"\x00\x00\x00",
    ],
)
def test_rejects_garbage(data: bytes):
    with pytest.raises(PacketError):
        parse_packet(data)


def test_blendshapes_are_clamped():
    values = [0.0] * VALUE_COUNT
    values[0] = 1.3
    values[1] = -0.2
    frame = packet_to_frame(parse_packet(encode_packet(values)), t=0.0, seq=0)
    assert frame.bs[0] == 1.0
    assert frame.bs[1] == 0.0


def test_receiver_counts_drops_and_errors():
    frames = []
    clock = iter(x / 60 for x in range(100))
    receiver = LiveLinkReceiver(frames.append, clock=lambda: next(clock))
    values = [0.0] * VALUE_COUNT
    values[52] = 0.1
    for n in (100, 101, 104):  # 102 and 103 lost on Wi-Fi
        receiver.datagram_received(encode_packet(values, frame_number=n), ("192.168.1.50", 5000))
    receiver.datagram_received(b"nonsense", ("192.168.1.50", 5000))
    assert len(frames) == 3
    assert receiver.dropped_frames == 2
    assert receiver.parse_errors == 1
    assert receiver.last_bad_packet is not None
    assert receiver.head_rotation_seen
    assert receiver.sender == "192.168.1.50"
