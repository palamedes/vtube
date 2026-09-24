import asyncio

import pytest
from aiohttp import WSMsgType, WSServerHandshakeError

from vtube_hub.arkit import INDEX
from vtube_hub.frames import Frame, rest_blendshapes
from vtube_hub.livelink import VALUE_COUNT, encode_packet
from vtube_hub.server import create_app


async def next_message(ws, kind: str, timeout: float = 3.0) -> dict:
    async def wait():
        while True:
            msg = await ws.receive()
            assert msg.type == WSMsgType.TEXT, msg
            data = msg.json()
            if data["type"] == kind:
                return data

    return await asyncio.wait_for(wait(), timeout)


async def test_pages_and_assets(aiohttp_client, hub):
    client = await aiohttp_client(create_app(hub))
    assert "studio" in await (await client.get("/")).text()
    assert "render" in await (await client.get("/render")).text()
    assert (await client.get("/assets/app.js")).status == 200
    assert (await client.get("/assets/../index.html")).status == 404


async def test_missing_build_explains_itself(aiohttp_client, hub):
    (hub.web_dist / "index.html").unlink()
    response = await (await aiohttp_client(create_app(hub))).get("/")
    assert response.status == 503
    assert "npm run build" in await response.text()


async def test_settings_round_trip_and_broadcast(aiohttp_client, hub):
    client = await aiohttp_client(create_app(hub))
    ws = await client.ws_connect("/ws")
    hello = await next_message(ws, "hello")
    assert hello["state"]["config"]["activeSource"] == "livelink"
    response = await client.put("/api/settings", json={"mirror": True})
    assert response.status == 200
    assert (await next_message(ws, "settings"))["settings"] == {"mirror": True}
    assert (hub.data_dir / "settings.json").is_file()
    assert (await client.put("/api/settings", json=[1, 2])).status == 400
    await ws.close()


async def test_simulator_frames_flow_and_record(aiohttp_client, hub):
    client = await aiohttp_client(create_app(hub))
    ws = await client.ws_connect("/ws")
    await next_message(ws, "hello")
    assert (await client.put("/api/config", json={"activeSource": "simulator"})).status == 200
    frame = await next_message(ws, "frame")
    assert frame["src"] == "simulator"
    assert len(frame["bs"]) == 52

    assert (await client.post("/api/record/start", json={"name": "Test read"})).status == 200
    assert (await client.post("/api/record/start")).status == 409
    await asyncio.sleep(0.3)
    meta = await (await client.post("/api/record/stop")).json()
    assert meta["name"] == "Test read"
    assert meta["frames"]["count"] > 5
    assert meta["audio"]["samples"] == 24000

    takes = await (await client.get("/api/takes")).json()
    assert [t["id"] for t in takes] == [meta["id"]]
    frames = await (await client.get(f"/api/takes/{meta['id']}/frames.jsonl")).text()
    assert len(frames.splitlines()) == meta["frames"]["count"]
    audio = await client.get(f"/api/takes/{meta['id']}/audio.wav")
    assert audio.status == 200 and audio.headers["Content-Type"] == "audio/wav"

    renamed = await client.patch(f"/api/takes/{meta['id']}", json={"name": "Renamed"})
    assert (await renamed.json())["name"] == "Renamed"
    assert (await client.delete(f"/api/takes/{meta['id']}")).status == 200
    assert (await client.get(f"/api/takes/{meta['id']}")).status == 404
    await ws.close()


async def test_live_link_packets_reach_the_studio(aiohttp_client, hub):
    client = await aiohttp_client(create_app(hub))
    ws = await client.ws_connect("/ws")
    await next_message(ws, "hello")
    values = [0.0] * VALUE_COUNT
    values[17] = 0.6  # jawOpen
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(asyncio.DatagramProtocol, remote_addr=("127.0.0.1", hub.livelink.port))
    transport.sendto(encode_packet(values, frame_number=1))
    frame = await next_message(ws, "frame")
    transport.close()
    assert frame["src"] == "livelink"
    assert frame["bs"][17] == 0.6
    assert hub.livelink.status()["receiving"]
    await ws.close()


async def test_other_websites_are_refused(aiohttp_client, hub):
    client = await aiohttp_client(create_app(hub))
    host = f"127.0.0.1:{client.port}"
    # The hub's own pages and the Vite dev server are fine.
    assert (await client.get("/api/state", headers={"Origin": f"http://{host}"})).status == 200
    assert (await client.get("/api/state", headers={"Origin": "http://localhost:5173"})).status == 200
    # Another site can't start a recording or read the live stream.
    assert (await client.post("/api/record/start", headers={"Origin": "https://evil.example"})).status == 403
    assert hub.recorder is None
    with pytest.raises(WSServerHandshakeError):
        await client.ws_connect("/ws", headers={"Origin": "https://evil.example"})
    # DNS rebinding: a domain name pointing at 127.0.0.1 is refused even without an Origin.
    assert (await client.get("/api/state", headers={"Host": f"evil.example:{client.port}"})).status == 403
    assert (await client.get("/api/state", headers={"Host": f"localhost:{client.port}"})).status == 200


async def test_webcam_source_and_orientation(aiohttp_client, hub):
    client = await aiohttp_client(create_app(hub))
    ws = await client.ws_connect("/ws")
    await next_message(ws, "hello")
    response = await client.put("/api/config", json={"activeSource": "webcam", "webcam": {"fps": 30}})
    assert response.status == 200
    await asyncio.sleep(0.05)  # the camera starts in the background
    assert hub.webcam.running and hub.webcam.settings.fps == 30

    # Tell the hub this source reports yaw backwards and left/right swapped.
    fix = {"webcam": {"swapLR": True, "yaw": -1, "pitch": 1, "roll": 1}}
    assert (await client.put("/api/config", json={"orientation": fix})).status == 200
    bs = rest_blendshapes()
    bs[INDEX["eyeBlinkLeft"]] = 0.9
    hub.webcam.emit(Frame(t=hub.clock(), source="webcam", seq=1, face=True, bs=bs, head=(0.2, 0.1, 0.05)))
    frame = await next_message(ws, "frame")
    assert frame["src"] == "webcam"
    assert frame["bs"][INDEX["eyeBlinkRight"]] == 0.9
    assert frame["bs"][INDEX["eyeBlinkLeft"]] == 0.0
    assert frame["head"] == [-0.2, 0.1, 0.05]

    # Back to the phone: the camera stops unless asked to keep running for comparisons.
    await client.put("/api/config", json={"activeSource": "livelink"})
    await asyncio.sleep(0.05)
    assert not hub.webcam.running
    await client.put("/api/config", json={"webcam": {"keepRunning": True}})
    await asyncio.sleep(0.05)
    assert hub.webcam.running
    assert (await client.put("/api/config", json={"orientation": {"webcam": {"yaw": 2}}})).status == 400
    assert (await client.put("/api/config", json={"webcam": {"fps": 1000}})).status == 400
    await ws.close()


async def test_camera_controls_need_a_running_camera(aiohttp_client, hub):
    client = await aiohttp_client(create_app(hub))
    assert (await client.get("/api/camera/controls")).status == 409


async def test_bad_config_is_rejected(aiohttp_client, hub):
    client = await aiohttp_client(create_app(hub))
    assert (await client.put("/api/config", json={"activeSource": "kinect"})).status == 400
    assert (await client.put("/api/config", json={"volume": 11})).status == 400
    response = await client.put("/api/config", json={"audioDevice": "alsa_input.test"})
    assert (await response.json())["audioDevice"] == "alsa_input.test"
    assert hub.audio.device == "alsa_input.test"
