"""HTTP and WebSocket API, plus the built Studio and character pages.

    GET  /                          the Studio
    GET  /render                    a character page for OBS (see web/src/render)
    GET  /ws?client=studio|render   WebSocket: hello, frame, level, camera, status,
                                    settings, config, recording, takes messages
    GET  /api/state                 everything the Studio needs on load
    PUT  /api/settings              replace the face tuning settings
    PUT  /api/config                change activeSource and/or audioDevice
    GET  /api/audio/devices         microphones and other PipeWire sources
    POST /api/record/start          {"name"?: str}
    POST /api/record/stop
    GET  /api/takes                 list
    GET  /api/takes/{id}            metadata
    PATCH /api/takes/{id}           {"name"?: str, "syncOffset"?: seconds}
    DELETE /api/takes/{id}
    GET  /api/takes/{id}/frames.jsonl
    GET  /api/takes/{id}/audio.wav
    GET  /api/camera/devices        video capture devices
    GET  /api/camera/controls       zoom, pan, tilt, low-light frame rate, brightness
    PUT  /api/camera/controls       {"zoom_absolute": 150, ...}
    GET  /api/camera/preview.mjpg   what the camera sees, ~15 fps, for framing
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import WSMsgType, web

from .audio import list_sources
from .hub import Conflict, Hub
from .webcam import list_cameras, read_controls, write_control

log = logging.getLogger(__name__)

HUB = web.AppKey("hub", Hub)
DEV_PORT = 5173  # `npm run dev` in web/
_LOOPBACK_NAMES = ("127.0.0.1", "localhost", "::1")

MISSING_BUILD = """<!doctype html><meta charset="utf-8"><title>vtube</title>
<body style="font:16px system-ui;background:#16171d;color:#e8e8ee;padding:40px">
<h1>The web UI isn't built yet</h1>
<p>Run <code>npm install &amp;&amp; npm run build</code> in <code>web/</code>, then reload.
Or use <code>./vt</code> from the repo root, which does it for you.</p>"""


def _host_is_address(host: str) -> bool:
    """True for localhost or an IP literal. Rejects the domain names DNS rebinding relies on."""
    name = urlsplit(f"//{host}").hostname or ""
    if name == "localhost":
        return True
    try:
        ipaddress.ip_address(name)
    except ValueError:
        return False
    return True


def _origin_allowed(origin: str, host: str) -> bool:
    parts = urlsplit(origin)
    if parts.netloc == host:
        return True  # the hub's own pages
    return parts.hostname in _LOOPBACK_NAMES and parts.port == DEV_PORT  # the Vite dev server


@web.middleware
async def local_only(request: web.Request, handler):
    """Keep other websites out.

    Browsers let any page open a WebSocket to 127.0.0.1 and fire simple POSTs
    at it, so a random site could otherwise read the live face stream or start
    a recording. Requests must name the hub by address (not a domain, which
    blocks DNS rebinding), and browser requests must come from the hub's own
    pages or the dev server. Tools without an Origin header (curl, OBS
    plugins, tests) are unaffected.
    """
    if not _host_is_address(request.host):
        return web.json_response({"error": "open the hub by address, e.g. http://127.0.0.1:8750"}, status=403)
    origin = request.headers.get("Origin")
    if origin and not _origin_allowed(origin, request.host):
        log.warning("refused a request to %s from %s", request.path, origin)
        return web.json_response({"error": "cross-site request refused"}, status=403)
    return await handler(request)


@web.middleware
async def json_errors(request: web.Request, handler):
    try:
        return await handler(request)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    except Conflict as exc:
        return web.json_response({"error": str(exc)}, status=409)
    except KeyError:
        return web.json_response({"error": "not found"}, status=404)


async def _json_body(request: web.Request) -> object:
    if not request.can_read_body:
        return {}
    try:
        return await request.json()
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON: {exc.msg}") from exc


def _page(hub: Hub, filename: str) -> web.StreamResponse:
    path = hub.web_dist / filename
    if not path.is_file():
        return web.Response(text=MISSING_BUILD, content_type="text/html", status=503)
    return web.FileResponse(path, headers={"Cache-Control": "no-cache"})


def _inside(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise KeyError(relative)
    return path


def create_app(hub: Hub) -> web.Application:
    app = web.Application(middlewares=[local_only, json_errors])
    app[HUB] = hub
    routes = web.RouteTableDef()

    @routes.get("/")
    async def studio(request: web.Request) -> web.StreamResponse:
        return _page(hub, "index.html")

    @routes.get("/render")
    async def render(request: web.Request) -> web.StreamResponse:
        return _page(hub, "render.html")

    @routes.get("/assets/{path:.+}")
    async def assets(request: web.Request) -> web.StreamResponse:
        path = _inside(hub.web_dist / "assets", request.match_info["path"])
        return web.FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    @routes.get("/favicon.svg")
    async def favicon(request: web.Request) -> web.StreamResponse:
        return web.FileResponse(_inside(hub.web_dist, "favicon.svg"))

    @routes.get("/ws")
    async def websocket(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=20)
        await ws.prepare(request)
        kind = request.query.get("client", "other")
        client = hub.bus.add(ws, kind if kind in ("studio", "render") else "other")
        client.offer(json.dumps({"type": "hello", "state": hub.state()}, separators=(",", ":")), droppable=False)
        try:
            async for msg in ws:
                if msg.type == WSMsgType.ERROR:
                    break
        finally:
            await hub.bus.remove(client)
        return ws

    @routes.get("/api/state")
    async def state(request: web.Request) -> web.Response:
        return web.json_response(hub.state())

    @routes.put("/api/settings")
    async def put_settings(request: web.Request) -> web.Response:
        return web.json_response(hub.set_settings(await _json_body(request)))

    @routes.put("/api/config")
    async def put_config(request: web.Request) -> web.Response:
        return web.json_response(await hub.update_config(await _json_body(request)))

    @routes.get("/api/audio/devices")
    async def audio_devices(request: web.Request) -> web.Response:
        return web.json_response(await list_sources())

    @routes.post("/api/record/start")
    async def record_start(request: web.Request) -> web.Response:
        body = await _json_body(request)
        name = body.get("name") if isinstance(body, dict) else None
        return web.json_response(await hub.start_recording(name))

    @routes.post("/api/record/stop")
    async def record_stop(request: web.Request) -> web.Response:
        return web.json_response(await hub.stop_recording())

    @routes.get("/api/takes")
    async def list_takes(request: web.Request) -> web.Response:
        return web.json_response(hub.takes.list())

    @routes.get("/api/takes/{id}")
    async def get_take(request: web.Request) -> web.Response:
        return web.json_response(hub.takes.read(request.match_info["id"]))

    @routes.patch("/api/takes/{id}")
    async def patch_take(request: web.Request) -> web.Response:
        body = await _json_body(request)
        if not isinstance(body, dict):
            raise ValueError("expected a JSON object")
        meta = hub.takes.update(request.match_info["id"], body)
        hub.publish_takes()
        return web.json_response(meta)

    @routes.delete("/api/takes/{id}")
    async def delete_take(request: web.Request) -> web.Response:
        take_id = request.match_info["id"]
        if hub.recorder is not None and hub.recorder.id == take_id:
            raise Conflict("that take is still recording")
        hub.takes.delete(take_id)
        hub.publish_takes()
        return web.json_response({"deleted": take_id})

    @routes.get("/api/camera/devices")
    async def camera_devices(request: web.Request) -> web.Response:
        return web.json_response(await asyncio.to_thread(list_cameras))

    @routes.get("/api/camera/controls")
    async def camera_controls(request: web.Request) -> web.Response:
        return web.json_response(await asyncio.to_thread(read_controls, hub.camera_device()))

    @routes.put("/api/camera/controls")
    async def set_camera_controls(request: web.Request) -> web.Response:
        body = await _json_body(request)
        if not isinstance(body, dict):
            raise ValueError("expected an object of control values")
        device = hub.camera_device()
        for name, value in body.items():
            await asyncio.to_thread(write_control, device, name, value)
        return web.json_response(await asyncio.to_thread(read_controls, device))

    @routes.get("/api/camera/preview.mjpg")
    async def camera_preview(request: web.Request) -> web.StreamResponse:
        boundary = "vtubeframe"
        response = web.StreamResponse(
            headers={"Content-Type": f"multipart/x-mixed-replace; boundary={boundary}", "Cache-Control": "no-cache"}
        )
        await response.prepare(request)
        last = -1
        try:
            while True:
                hub.webcam.want_preview()
                seq, jpeg = hub.webcam.preview()
                if jpeg is not None and seq != last:
                    last = seq
                    head = f"--{boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpeg)}\r\n\r\n"
                    await response.write(head.encode() + jpeg + b"\r\n")
                await asyncio.sleep(1 / 30)
        except ConnectionResetError:
            pass  # the Studio closed the preview
        return response

    @routes.get("/api/takes/{id}/{file}")
    async def take_file(request: web.Request) -> web.StreamResponse:
        name = request.match_info["file"]
        if name not in ("frames.jsonl", "audio.wav"):
            raise KeyError(name)
        path = hub.takes.path(request.match_info["id"]) / name
        if not path.is_file():
            raise KeyError(name)
        content_type = "audio/wav" if name.endswith(".wav") else "application/x-ndjson"
        return web.FileResponse(path, headers={"Content-Type": content_type, "Cache-Control": "no-cache"})

    app.add_routes(routes)

    async def lifecycle(app: web.Application):
        await hub.start()
        yield
        await hub.stop()

    app.cleanup_ctx.append(lifecycle)
    return app
