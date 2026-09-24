# Architecture

How the pieces fit, and the formats they share. For why it's built this way, see [research.md](../research.md), section 13.

## The idea in one paragraph

The camera only drives. A tracker (the iPhone, or a webcam) measures the performer's face as 52 numbers (Apple's ARKit blendshapes) plus head rotation, about 60 times a second. The hub records those numbers and the performer's voice as a take, and streams them to any number of character pages. Each character maps the numbers onto its own parts. Characters are web pages, so OBS shows them directly as browser sources, and the Studio shows the very same pages for tuning. Because a take is data, it can be replayed through any character later, and exported to video from the Studio.

```
iPhone (Live Link Face) --UDP 11111--> +-----------------------+
webcam (MediaPipe, on the hub) ------> |  hub (Python, aiohttp) | --> takes and exports on disk
simulator (built in, for testing) ---> |  127.0.0.1:8750        |     (~/.local/share/vtube)
USB mic (PipeWire, pw-record) -------> +-----------+-----------+
                                                   | WebSocket /ws: frames, levels, status, settings
                              +--------------------+--------------------+
                              v                                         v
                   Studio  (/)                               character page (/render)
                   preview, scene, monitor, tuning,          the character, or the whole scene,
                   framing, compare, recording, playback,    captured by OBS as a browser source
                   auto-sync, export (renders MP4s and
                   uploads them; the hub adds the voice)
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
| `web/` | Vite, TypeScript, React. Three pages: the Studio (`index.html`, `src/studio`), the character page for OBS (`render.html`, `src/render`), and the character sheet (`sheet.html`, `src/sheet`). Shared code in `src/shared`, characters in `src/characters`. |
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

## Scene

The scene is part of the settings (`settings.scene`, `web/src/shared/scene.ts`): the character, the background (`set`, `green`, `color`, or `transparent`), the kicker and headline text, and one layout per output format, `wide` (1920 × 1080) and `tall` (1080 × 1920):

```json
"wide": {"character": {"x": 0.69, "y": 1, "size": 0.94},
         "headline": {"show": true, "x": 0.04, "y": 0.74, "width": 0.48, "size": 0.021}}
```

- `character`: `x` is its center and `y` its bottom edge, as shares of the frame's width and height; `size` is the side of its square box, as a share of the frame's height. A character may draw a little past its box (a raised head); anything below the box's bottom edge is cut off, like a bust.
- `headline`: `x`, `y` is the top-left corner; `width` is a share of the frame's width; `size` is the text height as a share of the frame's width. The box grows downward to fit the text.

The Studio preview, the OBS page, and the exporter all place things with the functions in `scene.ts`, so all three agree. The HTML frames use percentages for positions and container query units (`cqw`) for text, so a small preview scales exactly like the full-size video; the exporter draws the same geometry onto a canvas (`sceneDraw.ts`).

## Export

Exports render in the Studio page from a take's recorded data (`web/src/studio/exporter.ts`):

1. Output time `t` starts at the first audio sample. Each frame shows the face at take time `t + audio.startOffset + syncOffset`, run through the same tuning pipeline and character as playback.
2. The character's SVG is rasterized and drawn onto a canvas per format with the background and headline, then encoded with WebCodecs through [Mediabunny](https://github.com/Vanilagy/mediabunny): H.264 when the browser can, else VP9 or AV1; 8 Mbit/s (standard) or 16 Mbit/s (high) at 30 fps, and half again at 60 fps.
3. Each video is uploaded to `POST /api/takes/{id}/export?view=wide|tall`. The hub adds the take's `audio.wav` with ffmpeg (`hub/src/vtube_hub/exports.py`): H.264 is copied as is and anything else is re-encoded to H.264; the voice becomes AAC at 192 kbit/s; `+faststart` puts the index up front for streaming. The result is `<data dir>/exports/<take id>/<name>-16x9.mp4` or `-9x16.mp4`, replacing an earlier export of the same take and format.

The voice is never resampled or re-timed, and the video runs as long as the voice recording.

## Characters

A character is a `CharacterDefinition` (`web/src/characters/types.ts`): `create(container)` returns an instance with `update(face, now)`, called every animation frame with the tuned face. Register it in `web/src/characters/index.ts` and it appears in the Studio's Scene tab, at `/render?character=<id>`, and at `/sheet?character=<id>`, a grid of fixed poses for designing it without a tracker. Exports rasterize the character's `<svg>` element, so for now a character draws into one, in a square `viewBox`.

- `placeholder.ts`: plain SVG that shows how the channels map to parts.
- `mascot.ts`: a layered cartoon in an esports-mascot style. Its layers slide by different amounts as the head turns (the face most, the ear cups least) to suggest depth, and the parts that join layers (the glasses' arms, the mic boom) are redrawn each frame between them.

Planned tiers: layered 2D puppets, 3D through three.js, and offline rendering in Blender from recorded takes.
