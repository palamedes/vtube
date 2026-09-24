import asyncio

from vtube_hub import __main__ as cli
from vtube_hub.server import create_app


async def test_opens_the_studio_when_no_tab_reconnects(aiohttp_client, hub, monkeypatch):
    opened = []
    monkeypatch.setattr(cli, "BROWSER_GRACE", 0.05)
    monkeypatch.setattr(cli.webbrowser, "open", opened.append)
    app = create_app(hub)
    app.cleanup_ctx.append(cli.open_studio_unless_open(hub, "http://127.0.0.1:8750/"))
    await aiohttp_client(app)
    await asyncio.sleep(0.2)
    assert opened == ["http://127.0.0.1:8750/"]


async def test_leaves_the_browser_alone_when_a_studio_tab_is_back(aiohttp_client, hub, monkeypatch):
    opened = []
    monkeypatch.setattr(cli, "BROWSER_GRACE", 0.3)
    monkeypatch.setattr(cli.webbrowser, "open", opened.append)
    app = create_app(hub)
    app.cleanup_ctx.append(cli.open_studio_unless_open(hub, "http://127.0.0.1:8750/"))
    client = await aiohttp_client(app)
    ws = await client.ws_connect("/ws?client=studio")  # an old tab reconnecting
    await asyncio.sleep(0.05)
    assert hub.bus.count("studio") == 1
    await asyncio.sleep(0.4)
    assert opened == []
    await ws.close()
