"""vtube-hub: start the hub and serve the Studio."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import os
import webbrowser
from pathlib import Path

from aiohttp import web

from . import __version__
from .audio import AudioCapture
from .hub import Hub
from .livelink import DEFAULT_PORT
from .netinfo import lan_addresses
from .server import create_app

REPO_ROOT = Path(__file__).resolve().parents[3]
# A Studio tab that was already open reconnects within ~5 s (its retry backoff tops out at 5 s).
BROWSER_GRACE = 6.0

log = logging.getLogger("vtube_hub")


def open_studio_unless_open(hub: Hub, url: str):
    """Cleanup context: open the Studio in the browser, unless a Studio tab reconnects first."""

    async def context(app: web.Application):
        async def maybe_open() -> None:
            await asyncio.sleep(BROWSER_GRACE)
            if hub.bus.count("studio") == 0:
                log.info("opening the Studio in your browser")
                await asyncio.to_thread(webbrowser.open, url)

        task = asyncio.create_task(maybe_open())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    return context


def default_data_dir() -> Path:
    if env := os.environ.get("VTUBE_DATA_DIR"):
        return Path(env).expanduser()
    base = os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    return Path(base) / "vtube"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="vtube-hub", description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind address (default: 127.0.0.1, this PC only)")
    parser.add_argument("--port", type=int, default=8750, help="HTTP/WebSocket port (default: 8750)")
    parser.add_argument("--livelink-port", type=int, default=DEFAULT_PORT, help="UDP port for Live Link Face")
    parser.add_argument("--data-dir", type=Path, default=default_data_dir(), help="where takes and settings live")
    parser.add_argument("--web-dist", type=Path, default=REPO_ROOT / "web" / "dist", help="built web UI")
    parser.add_argument("--no-audio", action="store_true", help="don't capture the microphone")
    parser.add_argument("--simulator", action="store_true", help="start with the simulated face as the source")
    parser.add_argument("--no-open", "--no-browser", dest="no_open", action="store_true", help="don't open the Studio in a browser")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)

    data_dir = args.data_dir.expanduser()
    data_dir.mkdir(parents=True, exist_ok=True)
    hub: Hub
    audio = (
        None
        if args.no_audio
        else AudioCapture(on_level=lambda rms, peak: hub.on_level(rms, peak), on_chunk=lambda chunk, t: hub.on_audio(chunk, t))
    )
    hub = Hub(
        data_dir=data_dir,
        web_dist=args.web_dist,
        audio=audio,
        http_port=args.port,
        livelink_port=args.livelink_port,
    )
    if args.simulator:
        hub.config["activeSource"] = "simulator"

    base = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '') else args.host}:{args.port}"
    phone = ", ".join(a["address"] for a in lan_addresses()) or "this PC's LAN address"
    print(
        f"\nvtube hub {__version__}\n"
        f"  Studio     {base}/\n"
        f"  OBS page   {base}/render\n"
        f"  Phone      Live Link Face target {phone}, port {args.livelink_port}\n"
        f"  Data       {data_dir}\n"
        f"\nRunning. Leave this terminal open; Ctrl+C stops the hub.\n",
        flush=True,
    )
    app = create_app(hub)
    if not args.no_open:
        app.cleanup_ctx.append(open_studio_unless_open(hub, f"{base}/"))
    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
