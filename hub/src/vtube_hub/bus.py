"""Fan-out of hub events to every connected WebSocket client.

Each client gets its own queue and sender task, so one slow page (a busy OBS
browser source, say) can't hold up the others. Frames are droppable: if a
client falls behind it skips frames rather than lagging further.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging

from aiohttp import web

log = logging.getLogger(__name__)

QUEUE_SIZE = 240


class Client:
    def __init__(self, ws: web.WebSocketResponse, kind: str = "other") -> None:
        self.ws = ws
        self.kind = kind  # "studio", "render", or "other"
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.dropped = 0
        self.task = asyncio.create_task(self._send_loop(), name="ws-sender")

    def offer(self, data: str, droppable: bool) -> None:
        if self.queue.full():
            if droppable:
                self.dropped += 1
                return
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()  # make room for a message that matters
        self.queue.put_nowait(data)

    async def _send_loop(self) -> None:
        try:
            while True:
                data = await self.queue.get()
                await self.ws.send_str(data)
        except (ConnectionResetError, RuntimeError):
            pass  # the socket closed; the handler cleans up


class Bus:
    def __init__(self) -> None:
        self._clients: set[Client] = set()

    def __len__(self) -> int:
        return len(self._clients)

    def count(self, kind: str) -> int:
        return sum(1 for client in self._clients if client.kind == kind)

    def add(self, ws: web.WebSocketResponse, kind: str = "other") -> Client:
        client = Client(ws, kind)
        self._clients.add(client)
        return client

    async def remove(self, client: Client) -> None:
        self._clients.discard(client)
        client.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await client.task

    def publish(self, message: dict, *, droppable: bool = False) -> None:
        if not self._clients:
            return
        data = json.dumps(message, separators=(",", ":"))
        for client in self._clients:
            client.offer(data, droppable)

    async def close(self) -> None:
        for client in list(self._clients):
            await client.ws.close()
            await self.remove(client)
