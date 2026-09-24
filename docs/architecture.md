# Architecture

How the pieces fit, and the formats they share. For why it's built this way, see [research.md](../research.md), section 13.

## The idea in one paragraph

The camera only drives. A tracker (the iPhone, or a webcam) measures the performer's face as 52 numbers (Apple's ARKit blendshapes) plus head rotation, about 60 times a second. The hub records those numbers and the performer's voice as a take, and streams them to any number of character pages. Each character maps the numbers onto its own parts. Characters are web pages, so OBS shows them directly as browser sources with a transparent background, and the Studio shows the very same pages for tuning. Because a take is data, it can be replayed through any character later.

```
iPhone (Live Link Face) --UDP 11111--> +-----------------------+
webcam (MediaPipe, on the hub) ------> |  hub (Python, aiohttp) | --> takes on disk
simulator (built in, for testing) ---> |  127.0.0.1:8750        |     (~/.local/share/vtube)
USB mic (PipeWire, pw-record) -------> +-----------+-----------+
                                                   | WebSocket /ws: frames, levels, status, settings
                              +--------------------+--------------------+
                              v                                         v
                   Studio  (/)                               character page (/render)
                   preview, monitor, tuning, framing,        transparent, one character,
                   compare, recording, playback, auto-sync   captured by OBS as a browser source
```

Both pages run the same processing code (`web/src/shared`), so what you tune in the Studio is exactly what OBS shows.

## Sources

| Source | What it is | Runs when |
|---|---|---|
| `livelink` | The iPhone's TrueDepth camera via Live Link Face. The best mouth detail. | Always listening on UDP 11111 |
| `webcam` | A webcam, tracked on this PC by Google's MediaPipe Face Landmarker (CPU, about 8 ms a frame). No tongue channel. | It's the active source, or `webcam.keepRunning` is on |
| `simulator` | A synthetic performer for testing without a face. | It's the active source |

One source is **active**: it drives OBS and the Studio's main views. Every running source is published and recorded, each frame tagged with its `src`, so the Studio's **Compare** view can show the same performance through two trackers side by side, live or from a take (which remembers its `primarySource`, the one that was active).

The hub owns the webcam, so tracking continues whether or not the Studio is on screen. The face model (about 3.7 MB) downloads from Google into `<data dir>/models/` the first time the camera starts. The Studio's **Framing** view shows the camera's picture (a ~15 fps MJPEG preview), where the face sits (`camera` messages, about 15 a second), and a safe subset of the camera's own controls (zoom, pan, tilt, brightness, and whether it slows down in low light) through `v4l2-ctl`.

## Direction conventions

Every source is brought to the same conventions before anything else sees a frame (`hub/src/vtube_hub/frames.py`):

- Blendshape "Left" means the performer's own left, as in ARKit.
- Head yaw > 0: the performer turns toward their own left. Pitch > 0: looks up. Roll > 0: tilts toward their left shoulder.

Sources that disagree get an **orientation fix** per source in the hub config (`orientation.<source>`: `swapLR`, and a sign for yaw, pitch, roll), which the hub applies to incoming frames. The Studio's **Check directions** routine sets it: it asks the performer to look ahead, turn left, tilt left, look up, and look left with just the eyes, then flips whatever reads backwards (`web/src/studio/directions.ts`). The webcam path was checked against a test portrait (closing the subject's left eye raises `eyeBlinkLeft`), so it needs no fix; the phone's head directions get checked on first use.

## Parts

| Path | What it is |
|---|---|
| `hub/` | Python 3.12, managed by uv. Receives Live Link Face packets (`livelink.py`), tracks the webcam (`webcam.py`), runs the simulator (`simulator.py`), captures the mic through `pw-record` (`audio.py`), records takes (`takes.py`), and serves the API and the built web UI (`server.py`, `hub.py`). |
| `web/` | Vite, TypeScript, React. Two pages: the Studio (`index.html`, `src/studio`) and the character page (`render.html`, `src/render`). Shared code in `src/shared`, characters in `src/characters`. |
| `vt` | Launcher: builds the web UI when it's stale, then starts the hub. |

## Ports

| Port | Protocol | Bound to | Use |
|---|---|---|---|
| 8750 | HTTP and WebSocket | 127.0.0.1 | Studio, character pages, API. Local only by default. |
| 11111 | UDP | 0.0.0.0 | Live Link Face from the phone. Needs a firewall rule if ufw or firewalld is running. |

The HTTP side refuses requests from other websites (by `Origin`) and requests that name the hub by a domain rather than an address (DNS rebinding), since browsers otherwise let any page reach `127.0.0.1`.

## Frame format

Every source is normalized to one frame shape. On the WebSocket it's a message with `"type": "frame"`; in a take it's one line of `frames.jsonl`.

```json
{"t": 12.3456, "src": "livelink", "seq": 2927, "face": true,
 "bs": [0.0, 0.0013, "... 52 values ..."],
 "head": [0.1152, -0.0219, -0.0493], "eyeL": [0, 0, 0], "eyeR": [0, 0, 0]}
```

- `t`: seconds. Hub uptime on the WebSocket; seconds since the take started in a take.
- `bs`: the 52 ARKit blendshapes, 0 to 1, in the order of `hub/src/vtube_hub/arkit.py` (which `web/src/shared/arkit.ts` must match).
- `head`, `eyeL`, `eyeR`: yaw, pitch, roll in radians, in the shared direction conventions (after the source's orientation fix).
- `face`: false when the source reports that it lost the face.
- `src`: `livelink`, `webcam`, or `simulator`.

Frames are otherwise raw: no calibration, no smoothing. That happens in the pages, so a take can be re-tuned after it's recorded.

## Live Link Face packets

Big-endian throughout: `u8` version (6), `i32` length plus UTF-8 device id, `i32` length plus UTF-8 subject name, then `i32` frame number, `f32` subframe, `i32` rate numerator, `i32` rate denominator, `u8` value count (61), and that many `f32` values: the 52 blendshapes, head yaw/pitch/roll, left eye yaw/pitch/roll, right eye yaw/pitch/roll. A packet that ends after the name carries no face. `vtube-fake-phone` sends the same packets from this PC.

## Takes

Takes live outside the repo, in `~/.local/share/vtube/takes/<id>/` (override with `--data-dir` or `VTUBE_DATA_DIR`). The repo is public; recordings of the performer never go in it.

```
20260924-153012/
  take.json      metadata
  frames.jsonl   raw frames, t = seconds since the take started
  audio.wav      the voice, 48 kHz mono 24-bit PCM, straight from the mic
```

`take.json`:

```json
{
  "format": 1,
  "id": "20260924-153012",
  "name": "Take Sep 24 15:30:12",
  "createdAt": "2026-09-24T15:30:12-04:00",
  "duration": 63.2,
  "frames": {"file": "frames.jsonl", "count": 3790, "sources": ["livelink", "webcam"]},
  "primarySource": "livelink",
  "audio": {"file": "audio.wav", "sampleRate": 48000, "channels": 1, "sampleFormat": "s24",
            "samples": 3033600, "device": "alsa_input...", "startOffset": -0.0086, "interrupted": false},
  "syncOffset": 0.0,
  "settings": {}
}
```

Timing, which is what keeps lips in sync:

- Frames and audio are stamped on the same clock (the hub's monotonic clock). The audio's first sample time is estimated from chunk arrival times (`ClockFit` in `audio.py`); `audio.startOffset` is where sample 0 falls on the take's timeline.
- The face data itself arrives a little late (Wi-Fi plus the phone's processing). `syncOffset` corrects for that. Playback shows the frame at `audio time + startOffset + syncOffset`.
- The Studio's Auto-sync estimates `syncOffset` by lining up the jaw-open curve with the loudness of the voice (`web/src/studio/autosync.ts`).
- `settings` is a snapshot of the tuning at record time, for reference.

## Tuning pipeline

`web/src/shared/processing.ts`, run per frame in every page:

1. Subtract the neutral pose (captured in the Studio) so a relaxed face reads as zero.
2. Mirror left and right, if enabled.
3. Per-group gains; blinks reshaped between two thresholds so squints stay open and blinks close fully; eye-look channels scaled by gaze strength (keeps eyes calm while reading a script).
4. One Euro filtering per channel: steady when still, responsive when moving. Separate smoothing for head, eyes, blinks, brows, mouth.
5. Head angles: neutral, gain, mirror, limit, smooth. Gaze is derived from the tuned eye-look channels.

`driver.ts` wraps the pipeline: when frames stop or the face is lost, the character relaxes to rest over 0.6 s and keeps blinking on its own.

Settings are stored by the hub as an opaque JSON object (`settings.json` in the data dir). The pages merge it over `DEFAULT_SETTINGS`, so partial or older settings keep working.

## Characters

A character is a `CharacterDefinition` (`web/src/characters/types.ts`): `create(container)` returns an instance with `update(face, now)`, called every animation frame with the tuned face. Register it in `web/src/characters/index.ts` and it's available at `/render?character=<id>`. The placeholder (`placeholder.ts`) is plain SVG and shows how the channels map to parts. Planned tiers: layered 2D puppets, 3D through three.js, and offline rendering in Blender from recorded takes.
