"""Live Link Face receiver: the iPhone's face tracking, over UDP.

Packet layout. Everything is big-endian; the layout was checked against
PyLiveLinkFace and livelinkface_arkit_receiver, which parse the same bytes:

    u8   packet version (6)
    i32  device id length, then that many UTF-8 bytes
    i32  subject name length, then that many UTF-8 bytes
    i32  frame number, f32 subframe            (timecode)
    i32  rate numerator, i32 rate denominator
    u8   value count (61)
    f32  x count: the 52 ARKit blendshapes, head yaw/pitch/roll,
         left eye yaw/pitch/roll, right eye yaw/pitch/roll

A packet that ends right after the subject name carries no face: the phone
is connected but not tracking anyone.
"""

from __future__ import annotations

import asyncio
import logging
import struct
import time
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from .arkit import BLENDSHAPES
from .frames import ZERO3, Frame, Vec3, rest_blendshapes

log = logging.getLogger(__name__)

DEFAULT_PORT = 11111
VALUE_COUNT = len(BLENDSHAPES) + 9
_HEADER = struct.Struct(">ifiiB")  # frame, subframe, rate num, rate den, value count
_MAX_NAME = 1024


class PacketError(ValueError):
    """The datagram isn't a Live Link Face packet this parser understands."""


@dataclass(slots=True)
class LiveLinkPacket:
    version: int
    device_id: str
    subject: str
    frame_number: int | None = None
    subframe: float | None = None
    rate: tuple[int, int] | None = None
    values: tuple[float, ...] = ()

    @property
    def has_face(self) -> bool:
        return len(self.values) >= len(BLENDSHAPES)


def _read_string(data: bytes, offset: int, what: str) -> tuple[str, int]:
    if offset + 4 > len(data):
        raise PacketError(f"packet ends before the {what} length")
    (length,) = struct.unpack_from(">i", data, offset)
    offset += 4
    if not 0 <= length <= _MAX_NAME or offset + length > len(data):
        raise PacketError(f"bad {what} length {length}")
    return data[offset : offset + length].decode("utf-8", errors="replace"), offset + length


def parse_packet(data: bytes) -> LiveLinkPacket:
    if not data:
        raise PacketError("empty packet")
    device_id, offset = _read_string(data, 1, "device id")
    subject, offset = _read_string(data, offset, "subject name")
    packet = LiveLinkPacket(version=data[0], device_id=device_id, subject=subject)
    if offset == len(data):
        return packet
    if offset + _HEADER.size > len(data):
        raise PacketError(f"truncated frame header ({len(data) - offset} bytes after the name)")
    frame_number, subframe, rate_num, rate_den, count = _HEADER.unpack_from(data, offset)
    offset += _HEADER.size
    if offset + count * 4 > len(data):
        raise PacketError(f"packet claims {count} values but carries {(len(data) - offset) // 4}")
    packet.frame_number = frame_number
    packet.subframe = subframe
    packet.rate = (rate_num, rate_den)
    packet.values = struct.unpack_from(f">{count}f", data, offset)
    return packet


def encode_packet(
    values: Sequence[float] | None,
    *,
    device_id: str = "00000000-0000-0000-0000-000000000000",
    subject: str = "iPhone",
    frame_number: int = 0,
    subframe: float = 0.0,
    rate: tuple[int, int] = (60, 1),
    version: int = 6,
) -> bytes:
    """Build a packet the way the phone does. Used by tests and the fake phone."""
    device = device_id.encode()
    name = subject.encode()
    out = bytes([version]) + struct.pack(">i", len(device)) + device + struct.pack(">i", len(name)) + name
    if values is None:
        return out
    vals = list(values)
    return out + _HEADER.pack(frame_number, subframe, rate[0], rate[1], len(vals)) + struct.pack(f">{len(vals)}f", *vals)


def _vec3(values: Sequence[float], start: int) -> Vec3:
    if len(values) < start + 3:
        return ZERO3
    return (float(values[start]), float(values[start + 1]), float(values[start + 2]))


def packet_to_frame(packet: LiveLinkPacket, t: float, seq: int) -> Frame:
    if not packet.has_face:
        return Frame(t=t, source="livelink", seq=seq, face=False, bs=rest_blendshapes())
    v = packet.values
    bs = [min(1.0, max(0.0, float(x))) for x in v[: len(BLENDSHAPES)]]
    n = len(BLENDSHAPES)
    return Frame(
        t=t,
        source="livelink",
        seq=seq,
        face=True,
        bs=bs,
        head=_vec3(v, n),
        eye_left=_vec3(v, n + 3),
        eye_right=_vec3(v, n + 6),
    )


class LiveLinkReceiver(asyncio.DatagramProtocol):
    """Receives phone packets, turns them into frames, and keeps diagnostics for the Studio."""

    def __init__(self, on_frame: Callable[[Frame], None], clock: Callable[[], float] = time.monotonic) -> None:
        self._on_frame = on_frame
        self._clock = clock
        self._arrivals: deque[float] = deque(maxlen=300)
        self._last_frame_number: int | None = None
        self.transport: asyncio.DatagramTransport | None = None
        self.port: int | None = None
        self.bind_error: str | None = None
        self.packets = 0
        self.parse_errors = 0
        self.last_error: str | None = None
        self.last_bad_packet: str | None = None
        self.last_packet_at: float | None = None
        self.sender: str | None = None
        self.device: str | None = None
        self.subject: str | None = None
        self.version: int | None = None
        self.rate: tuple[int, int] | None = None
        self.face = False
        self.head_rotation_seen = False
        self.dropped_frames = 0

    async def listen(self, host: str, port: int) -> None:
        loop = asyncio.get_running_loop()
        try:
            transport, _ = await loop.create_datagram_endpoint(lambda: self, local_addr=(host, port))
        except OSError as exc:
            self.bind_error = f"can't listen on UDP {port}: {exc.strerror or exc}"
            log.error(self.bind_error)
            return
        self.transport = transport
        self.port = transport.get_extra_info("sockname")[1]

    def close(self) -> None:
        if self.transport:
            self.transport.close()
            self.transport = None

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        now = self._clock()
        try:
            packet = parse_packet(data)
        except PacketError as exc:
            self.parse_errors += 1
            self.last_error = str(exc)
            self.last_bad_packet = data[:96].hex(" ")
            if self.parse_errors in (1, 10, 100) or self.parse_errors % 1000 == 0:
                log.warning("unreadable Live Link packet from %s (%d so far): %s", addr[0], self.parse_errors, exc)
            return
        self.packets += 1
        self._arrivals.append(now)
        self.last_packet_at = now
        self.sender = addr[0]
        self.device = packet.device_id
        self.subject = packet.subject
        self.version = packet.version
        self.face = packet.has_face
        if packet.rate:
            self.rate = packet.rate
        if packet.frame_number is not None:
            last = self._last_frame_number
            if last is not None and 1 < packet.frame_number - last < 600:
                self.dropped_frames += packet.frame_number - last - 1
            self._last_frame_number = packet.frame_number
        frame = packet_to_frame(packet, now, packet.frame_number if packet.frame_number is not None else self.packets)
        if frame.face and any(abs(x) > 1e-5 for x in frame.head):
            self.head_rotation_seen = True
        self._on_frame(frame)

    def status(self) -> dict:
        now = self._clock()
        recent = sum(1 for t in self._arrivals if now - t <= 1.0)
        ago = None if self.last_packet_at is None else round(now - self.last_packet_at, 2)
        return {
            "listening": self.transport is not None,
            "port": self.port,
            "bindError": self.bind_error,
            "receiving": ago is not None and ago < 1.0,
            "packetsPerSec": recent,
            "lastPacketAgo": ago,
            "sender": self.sender,
            "device": self.device,
            "subject": self.subject,
            "version": self.version,
            "rate": list(self.rate) if self.rate else None,
            "faceDetected": self.face and ago is not None and ago < 1.0,
            "headRotation": self.head_rotation_seen,
            "droppedFrames": self.dropped_frames,
            "parseErrors": self.parse_errors,
            "lastError": self.last_error,
            "lastBadPacket": self.last_bad_packet,
        }
