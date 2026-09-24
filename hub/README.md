# vtube hub

The Python half of vtube. It receives face tracking from the iPhone (Live Link Face) or tracks a webcam with MediaPipe, records the microphone, saves takes, adds the voice to exported videos (with ffmpeg), and serves the Studio and the character pages over HTTP and WebSocket.

```sh
uv run vtube-hub              # from this folder; see the repo README for the full setup
uv run vtube-hub --simulator  # start with the simulated face instead of the phone
uv run pytest                 # tests
```

See [../docs/architecture.md](../docs/architecture.md) for the data formats and ports.
