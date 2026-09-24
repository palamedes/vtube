# vtube

Be a cartoon on camera while keeping your own voice. An iPhone (or a plain webcam) reads your face, a small hub on your PC turns that into animation data, and a character performs it: live in OBS, or later from a recorded take. Built for recording news reads and book readings as a character, and posting them as a 16:9 video plus vertical Shorts, Reels, and TikToks.

Your voice is always your own. AI is never used to speak, and nothing here invents your performance: the phone measures your face, and the character follows it.

**Status:** works end to end: the hub, the Studio (a web UI for tuning, testing, recording, laying out the scene, and exporting finished videos), and a simple placeholder character, plus support for private characters made from your own art. Layered 2D puppets, 3D characters, and multi-character scenes come next. See [research.md](research.md) for how we got here and where it's going.

## What you need

- Linux with PipeWire (developed on CachyOS with KDE Plasma on Wayland)
- A face tracker: an iPhone with Face ID running [Live Link Face](https://apps.apple.com/us/app/live-link-face/id1495370836) (free, best mouth detail), and/or any webcam (tracked on your PC with Google's MediaPipe)
- A USB microphone
- [uv](https://docs.astral.sh/uv/) and Node.js
- ffmpeg, and Chrome (or another browser with WebCodecs), for exporting videos
- OBS Studio with the browser source plugin, plus [Aitum Vertical](https://github.com/Aitum/obs-vertical-canvas) for the 9:16 canvas. On Arch-based systems: `obs-studio`, `obs-studio-plugin-browser`, and `obs-vertical-canvas` from the AUR.

No GPU needed; the character pages are ordinary web pages.

## Quick start

```sh
git clone git@github.com:palamedes/vtube.git && cd vtube
./vt                # builds the web UI the first time, then starts the hub
```

The Studio opens in your browser at **http://127.0.0.1:8750** (leave the terminal running; Ctrl+C stops the hub). No face tracker yet? Switch the source to **Simulator** to see everything move.

```sh
./vt --simulator    # start with the simulated face
./vt --no-open      # start without opening a browser tab
./vt dev            # hot-reloading Studio at http://127.0.0.1:5173
./vt test           # both test suites
```

## Use a webcam

Pick **Camera** as the source. The first time, the hub downloads Google's face model (about 4 MB). Then open **Framing** above the preview: it shows what the camera sees, where it finds your face, and what to adjust. Aim for:

- **Face size:** your face 30 to 50% of the frame height. Use the Zoom slider (digital zoom on a 4K sensor costs no tracking detail) rather than sitting close to the lens.
- **Position:** camera at eye level, centered, right next to your script, so reading keeps your face pointed at it.
- **Light:** soft light in front of you, nothing bright behind you. Turn off "Slow down in low light" so the camera holds 60 fps.
- **Mouth in view:** keep the microphone from blocking your mouth and chin.

The webcam tracks head, blinks, brows, and the jaw well; the iPhone's depth sensor is better at mouth shapes (pucker, "oo", lip stretch). To see the difference, keep the camera tracking while the iPhone is active and switch the preview to **Compare**: the same performance, both trackers, side by side, live or from a take.

## Connect the iPhone

1. In Live Link Face: settings (gear) → **Live Link** → **Add Target**, and enter this PC's LAN address with port **11111**. The Studio's **Setup** panel lists your addresses with copy buttons.
2. Use the **Live Link (ARKit)** mode, and turn on **Stream Head Rotation** if your version has it.
3. If a firewall is running, allow the phone once. The Setup panel shows the exact command for yours, for example `sudo ufw allow proto udp from 192.168.1.0/24 to any port 11111`.
4. Keep the phone on its charger, with Auto-Lock set to Never. Mount it 30 to 50 cm from your face, at or a little below eye level, right next to your script, with a clear view of your mouth and chin.
5. In the Studio, run **Check directions** once (it asks you to turn, tilt, and look around, and fixes anything the phone reports backwards), then **Capture neutral face**.

The Setup panel also shows what the hub is receiving (packets per second, dropped frames, unreadable packets), which answers most "why isn't it moving" questions. The Framing view reads the phone's head angle while you look at your script and tells you if it sits too high, too low, or off to one side.

## The Studio

- **Preview:** the character in a 16:9 frame and a 9:16 frame side by side, laid out exactly as the exports and OBS show them. **Compare** puts two trackers side by side; **Framing** helps place the camera or phone.
- **Scene** (the first tab below the preview): the character, the background (a mock news set, green, a solid color, or none), and the headline with its small kicker line. Each format has its own sliders for where the character stands, how big it is, and where the headline sits, plus a switch to hide the headline. A dot next to a changed slider resets it.
- **Tracking** (the second tab): all 52 face channels live. A thin line shows what the tracker sent; a bar shows what the character receives after tuning.
- **Export** (the third tab): turns a take into finished videos. See below.
- **Tuning:** check directions and capture your neutral face; set strength and smoothing for head, eyes, brows, and mouth; tame your gaze so reading doesn't look shifty; mirror; idle breathing and blinks. Changes apply instantly, everywhere, including OBS.
- **Takes:** record your voice and face data together, play them back, scrub, and re-tune while they play. **Face sync** nudges the face against the voice, and **Auto-sync** measures the delay for you from your speech.

## Export

Open a take from the Takes list, then the **Export** tab. Pick the formats (16:9, 9:16, or both), 30 or 60 fps, and the quality, and press **Export**. The browser renders every frame through the same tuning and layout as the preview, and the hub adds your original voice recording (compressed to AAC, never re-timed). Rendering both formats takes roughly as long as the take itself.

The videos land in `~/.local/share/vtube/exports/<take>/`, named after the take (`<name>-16x9.mp4` and `<name>-9x16.mp4`), and the Export tab links to them. They're H.264 with AAC audio, which YouTube, Shorts, Reels, and TikTok all accept. A transparent scene exports on green, since MP4 has no transparency.

## OBS

For going live, add a **Browser** source to each canvas. The Studio's Setup panel lists these with copy buttons:

| Canvas | URL | Size |
|---|---|---|
| 16:9 | `http://127.0.0.1:8750/render?view=wide&full=1` | 1920 × 1080 |
| 9:16 (Aitum Vertical) | `http://127.0.0.1:8750/render?view=tall&full=1` | 1080 × 1920 |

`full=1` draws the whole scene from the Studio: background, character, and headline. Without it you get the character alone on a transparent background, still placed where the Scene tab puts it, so you can build the rest of the scene in OBS (no chroma key needed). Add your mic as the audio source.

## Characters

Pick one in the Scene tab. The repo includes a **placeholder**: a simple face that shows plainly how the face channels map to parts.

Characters made from art you don't want in the public repo (your own mascot, or a picture you don't have the rights to share) go in `characters/private/<name>/`, which git ignores. The Studio, OBS page, and exports pick them up from there automatically. [docs/architecture.md](docs/architecture.md) covers writing one.

To look over a character without a tracker, open `http://127.0.0.1:8750/sheet?character=<id>` (for example `placeholder`): the character in a grid of fixed poses (blink, talking, smile, frown, turning, and more).

## Where things live

| Path | What |
|---|---|
| `hub/` | Python hub: phone receiver, mic capture, takes, API ([hub/README.md](hub/README.md)) |
| `web/` | The Studio and the character pages (TypeScript, React, Vite) |
| `docs/architecture.md` | Data formats, ports, timing, the tuning pipeline, how to add a character |
| `research.md` | The tool survey and the reasoning behind this design |
| `~/.local/share/vtube/` | Your takes, exports, and settings. Outside the repo on purpose: this repo is public, and recordings of you never go in it. |
