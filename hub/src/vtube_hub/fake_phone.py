"""vtube-fake-phone: send Live Link Face packets from this PC.

Drives the hub's phone path end to end without an iPhone, using the
simulated performer's face. Handy for checking the receiver and the Studio's
phone diagnostics. (It can't test the firewall, since it sends from this PC.)
"""

from __future__ import annotations

import argparse
import socket
import time

from .livelink import DEFAULT_PORT, encode_packet
from .simulator import Simulator


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="vtube-fake-phone", description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--fps", type=float, default=60.0)
    parser.add_argument("--seconds", type=float, default=0.0, help="stop after this long (default: run until Ctrl+C)")
    args = parser.parse_args(argv)

    sim = Simulator(lambda frame: None)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    period = 1.0 / args.fps
    start = next_send = time.monotonic()
    frame_number = int((time.time() % 86400) * args.fps)  # timecode frames since midnight, like the phone
    print(f"sending Live Link Face packets to {args.host}:{args.port} at {args.fps:g} fps (Ctrl+C to stop)")
    try:
        while args.seconds <= 0 or time.monotonic() - start < args.seconds:
            frame = sim.sample(time.monotonic() - start)
            values = [*frame.bs, *frame.head, *frame.eye_left, *frame.eye_right]
            packet = encode_packet(
                values,
                device_id="FAKE0000-0000-0000-0000-000000000000",
                subject="vtube-fake-phone",
                frame_number=frame_number,
                rate=(round(args.fps), 1),
            )
            sock.sendto(packet, (args.host, args.port))
            frame_number += 1
            next_send += period
            time.sleep(max(0.0, next_send - time.monotonic()))
    except KeyboardInterrupt:
        pass
    finally:
        sock.close()


if __name__ == "__main__":
    main()
