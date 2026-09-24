# vtube research

Research notes for vtube: turning a performer's own face and voice into cartoon or avatar characters for recorded videos.

Compiled September 2026. This space moves fast, so findings carry the date they were checked. Anything marked *(unverified)* could not be confirmed from a primary source at the time. The research session hit its web search limit near the end, so late items were checked by fetching primary sources directly, and a few rely on a single source.

**Status:** all five research tracks are in (2026-09-24). The recommendation is in [section 13](#13-recommendation).

## Contents

1. [Goal and constraints](#1-goal-and-constraints)
2. [Target setup](#2-target-setup)
3. [Lessons from talker](#3-lessons-from-talker)
4. [Core concepts](#4-core-concepts)
5. [Classic VTuber software on Linux](#5-classic-vtuber-software-on-linux)
6. [Real-time AI video](#6-real-time-ai-video)
7. [Record first, transform after](#7-record-first-transform-after)
8. [Cartoon puppet apps and building our own](#8-cartoon-puppet-apps-and-building-our-own)
9. [One performer, many characters](#9-one-performer-many-characters)
10. [Publishing formats](#10-publishing-formats)
11. [Costs and monetization](#11-costs-and-monetization)
12. [Open decisions](#12-open-decisions)
13. [Recommendation](#13-recommendation)

## 1. Goal and constraints

- **What:** recorded videos of the performer reading the news (later, books) while appearing as a cartoon or avatar character. A fun project.
- **Voice:** always the performer's own. No TTS, no voice cloning. AI is fine for visuals only.
- **The camera is only a driver.** Tracking data (expression values plus head pose) drives whatever character is loaded. Characters should swap freely across fidelity tiers: flat sprite or GIF, 2D puppet, 3D creature (think Wookiee), up to a fully rendered puppet look.
- **Stretch goal:** read a book with several characters on screen, and whichever character is speaking comes alive.
- **Recorded, not live.** A live preview while recording is nice to have, not required.
- **Compositor:** OBS.
- **Outputs:** a 16:9 master for YouTube, plus 9:16 cuts for Shorts, Reels, and TikTok (see [section 10](#10-publishing-formats)).
- **Cost:** free and local wherever possible. Paid per-minute AI services are out as the core path (see [section 11](#11-costs-and-monetization)).
- **Open work:** the repo is public so others can benefit. Private material (raw recordings, personal media) stays out of it.

## 2. Target setup

What "runs locally" means throughout this document:

| Part | What |
|---|---|
| OS | Arch-based Linux (CachyOS), KDE Plasma on Wayland, PipeWire audio |
| GPU | NVIDIA RTX 5070 Ti, 16 GB VRAM (Blackwell, sm_120), driver 615 |
| CPU and RAM | Ryzen 9 3950X (16 cores), 32 GB RAM |
| Webcam | Logitech BRIO (4K USB) |
| Microphone | RODE Podcaster (USB dynamic) |
| Face tracker | iPhone 11 Pro (TrueDepth camera, ARKit face tracking) |

Roles: the iPhone tracks the face, the USB mic records the voice (far better than the phone mic), and the webcam is optional (backup tracker, body and hands later, or reference footage).

## 3. Lessons from talker

[talker](https://github.com/palamedes/talker) takes one photo plus a speech track and generates a talking-head video with LongCat-Video-Avatar 1.5 (a 13.6B video diffusion model), heavily patched to run on a 16 GB card. The results were not good enough, and the reasons are structural, not tuning problems. From talker's own measurements:

- **The model invents the face.** In image-anchored mode the photo sets framing and posture, the audio sets motion energy, and text prompts are ignored. The performer's expressions never reach the video; only the sound does.
- **Slow.** About 90 seconds of GPU time per second of video on a 16 GB card. A 15 s clip takes about 20 minutes; a 3 minute segment would take about 4.5 hours. No preview until the render finishes.
- **Low resolution.** 480p on 16 GB (720p needs 24 GB+). Too soft for YouTube and far too small to crop vertical.
- **Alternatives evaluated there and dropped:** Ditto produced flapping lips whose corners never pucker or spread. Ditto is built on LivePortrait's warping engine, per [its acknowledgements](https://github.com/antgroup/ditto-talkinghead), which matters for [section 6](#6-real-time-ai-video). EchoMimicV3-Flash output was soft, artifacted, and badly synced.

**Takeaway:** measure the performer's face instead of inferring it from audio. Reuse talker's frame-exact audio sync and ffmpeg finalize approach for any offline render path.

## 4. Core concepts

### Tracking data is the product, not the video

Face trackers output a small set of numbers per frame:

- **About 52 expression values**, each 0 to 1: `jawOpen`, `mouthSmileLeft`, `browInnerUp`, `eyeBlinkLeft`, `mouthPucker`, and so on. The names come from Apple's ARKit and are the de facto standard. MediaPipe outputs the same names from a regular webcam (minus `tongueOut`).
- **Head pose:** rotation and position.

Each character maps those numbers onto its own parts. A sprite swaps images when `jawOpen` crosses a threshold. A 2D puppet deforms meshes. A 3D model drives blendshapes and bones. One tracker can drive any character. The common way apps pass this data around is the VMC protocol (OSC over UDP).

Recording the numbers plus the audio, not just video, means:

- A take can be re-rendered later with a different character.
- The speaking character can be assigned after the fact.
- A high-end look can be rendered offline, where real time isn't required.
- The 16:9 and 9:16 versions become two renders of the same take.

### Tracker quality

- **iPhone TrueDepth (ARKit):** depth-based and the best consumer option for mouth shapes (pucker, funnel, stretch, cheek puff, tongue out).
- **Webcam (MediaPipe, OpenSeeFace):** fine for head pose, blinks, brows, jaw open, and smiles. Weaker on mouth shape. MediaPipe's `cheekPuff` reads about 0 and it has no `tongueOut`.
- **Mouth shape from audio:** blending audio-derived mouth shapes (visemes) with the tracked jaw opening improves lip sync with either tracker. The performer's real voice drives it; nothing is generated.

### Eyes while reading a script

Reading makes the eyes sweep side to side, and a tracker copies that faithfully, which looks shifty on a character. Keep blinks, but damp or cap gaze (for example 20 to 30 percent strength), or hold gaze toward camera with small procedural glances. Putting the script in a narrow column right next to the phone also helps.

**Glasses:** TrueDepth works in infrared, which passes through ordinary clear lenses. Apple says Face ID ["is designed to work with hats, scarves, glasses, contact lenses, and many sunglasses"](https://support.apple.com/en-us/102381), and its attention check detects open eyes. Expect eye and blink tracking to keep working with glasses on. Possible exceptions: IR-blocking tints or coatings, strong glare, and thick frames covering the eyebrows.

### One performer, several characters

Ways to decide which character is speaking (details in [section 9](#9-one-performer-many-characters)):

1. **Hotkey or foot pedal** while reading. Simplest, works live.
2. **Script-driven.** Tag the text with speaker names; a teleprompter follows the reading using local speech recognition (which only listens, never speaks) and switches the active character at each new speaker.
3. **Tag it afterward.** Read straight through, then mark who spoke when on a timeline. Easiest to get exactly right, since the take is data.

Non-speaking characters can keep blinking, breathing, and glancing at the speaker, like a puppet show.

## 5. Classic VTuber software on Linux

Checked 2026-09-24 against GitHub, Steam, ProtonDB, Flathub, the AUR, and the App Store.

### Summary

- The mainstream apps (VTube Studio, Warudo, VNyan, VSeeFace) are Windows apps that need Proton or Wine. Three recurring problems:
  1. Their built-in webcam capture is unreliable under Proton, so tracking should come from a native Linux tracker or the phone.
  2. Unity apps leak memory under Wine/Proton 9 and later ([Wine bug 59333](https://bugs.winehq.org/show_bug.cgi?id=59333), [Proton #9430](https://github.com/ValveSoftware/Proton/issues/9430)); the upstream fix was still unmerged as of April 2026.
  3. The usual transparent capture paths (Spout2, Game Capture) are Windows-only. On Linux: obs-vkcapture, Spout2PW, or a chroma key.
- Native Linux options that work in 2026: XR Animator and SnekStudio (3D), Inochi Session and nijiexpose (2D), veadotube mini and PNGTuber Remix (PNG), OpenSeeFace or the Facetracker Flatpak (tracking).
- The iPhone's 52 ARKit values are the biggest quality upgrade available, and mouth shape matters most for reading.

### Live2D route

**VTube Studio** 1.35.10 (2026-07-08), free. The $14.99 DLC only removes the watermark shown with webcam tracking; phone tracking shows no watermark on the PC.

- Linux: unofficial. ProtonDB Gold (16 reports).
- Built-in webcam under Proton: detected but no picture since 2022 ([Proton #6131](https://github.com/ValveSoftware/Proton/issues/6131)). The newer MediaPipe and NVIDIA trackers inside VTS are Windows-only.
- Working webcam path: run OpenSeeFace natively, set `ip=0.0.0.0` and `port=11573` in `VTube Studio_Data/StreamingAssets/ip.txt`, and set the camera to "Network Tracking" ([VTS wiki: Running VTS on Linux](https://github.com/DenchiSoft/VTubeStudio/wiki/Running-VTS-on-Linux)).
- iPhone tracking over Wi-Fi works under Proton. USB only via the [iproxy2vts](https://github.com/VTubing-on-Linux/iproxy2vts) proof of concept.
- Mic lip sync under Proton: problem reports from 2021; current status *(unverified)*.

**Getting a Live2D model:**

- Free: the models bundled with VTS; Live2D's official sample models (commercial use allowed for individuals and small businesses under ¥10M revenue, except the "collaboration" characters).
- Premade: nizima, Live2D's official store (about $300 locked, $600 unlocked); Booth (cheaper, non-exclusive).
- Commissions (2026 ranges): about $200 to $500 basic, $500 to $1,500 mid-range, $2,000 to $5,000+ professional. Rigging only is 30 to 40 percent cheaper. For reading, ask for ARKit or "VBridger" mouth rigging.

**Live2D Cubism Editor** 5.3.00 beta1: Windows 10/11 and macOS 13 to 26 only. No Linux version and no known Wine reports. Free tier: 30 parameters, 100 art meshes, one texture up to 2048 px, commercial use allowed for small users. PRO (indie): $13.10/month or $89.95 for the first year ($231.30 for 3 years), 42-day trial.

### Inochi2D route (open source)

- Inochi Creator 0.8.6 and Inochi Session 0.8.7 (September 2024), with no app release since. The core SDK is being rewritten as 0.9 (commits through September 2026). The apps are effectively paused. Session is free; official Creator builds show a 10 s purchase reminder.
- Tracking inputs: VMC, the VTube Studio phone protocol, OpenSeeFace, iFacialMocap, Facemotion3D, Live Link Face, Phiz, webhooks.
- Fork: [nijigenerate and nijiexpose](https://github.com/nijigenerate/nijiexpose) (editor and performer app), 1.0.0-beta2 (June 2026), Linux zips, `nijiexpose-bin` in the AUR. The README says not production-ready. [nijitrack](https://github.com/nijigenerate/nijitrack) sends MediaPipe values over OSC on port 39540. [Puppetstring](https://ar14.itch.io/puppetstring) (MediaPipe plus audio tracker, Linux build; release date *(unverified)*).
- Models are the bottleneck: only the Aka and Midori [examples](https://github.com/Inochi2D/example-models) (CC BY 4.0). Otherwise you rig your own from a layered PSD or Krita file. Live2D models can't be converted, and almost nobody takes Inochi2D commissions.

### 3D VRM route

**VRoid Studio** v2.14.0 (2026-06-29), Windows and macOS, ProtonDB Gold (14 reports). Exported models likely have only basic A/I/U/E/O mouth shapes plus blink, so full ARKit tracking needs extra shapes *(unverified)*. Reports of ads coming to the PC version *(unverified)*.

| App | Latest | Linux | Notes |
|---|---|---|---|
| [XR Animator](https://github.com/ButzYung/SystemAnimatorOnline) | v0.35.0 (2026-09-20), free | Native zip, also in browser | MediaPipe face, body, hands; full 52 ARKit values; VMC out; transparent window. Code is CC BY-NC-SA (non-commercial) |
| [SnekStudio](https://github.com/ExpiredPopsicle/SnekStudio) | v0.1.7 (2026-09-05), free, open source | Native ([Flathub](https://flathub.org/apps/com.snekstudio.Snekstudio) or tarball) | MediaPipe about 50 values plus hands; VMC in; audio lip sync since 0.1.6; transparent background; Vulkan |
| Warudo | 0.15.0 (2026-06-30), free | Proton, ProtonDB Gold (25) | Needs `PROTON_DISABLE_NVAPI=1 PROTON_USE_WOW64=1 %command%`; one June 2026 log still failed on Proton 9+. Webcam often won't load, so feed it from XR Animator or iFacialMocap. No native port planned |
| VNyan | 1.6.8 (2026-02-25), free | Proton or Lutris | Hit hardest by the Unity memory leak |
| [VSeeFace](https://www.vseeface.icu/) | 1.13.38c5, security patches only | Wine or Lutris, mixed reports | Pair with native OpenSeeFace; audio lip sync; accepts iPhone apps |
| VMagicMirror | v5.0.0 (2026-06-06) | Windows only | No Proton reports |
| 3tene | v4.0.30 (2026-07-10), free, PRO $18.99 | Windows and macOS | No Proton reports; webcam under Wine doubtful |
| Webcam Motion Capture | 1.12.1 (2026-08-29), subscription | Windows and macOS | |
| vpuppr | archived January 2024 | | Dead |
| Kalidoface 2D and 3D | sites still up | Browser | Demo quality; 3D code unchanged since 2022 |

### PNGTuber route (least effort)

- [veadotube mini](https://olmewe.itch.io/veadotube-mini) 2.2 (2026): native Linux, free or pay what you want. Mic-driven image swaps, blink, hotkeys, websocket control. The full veadotube (early access, Linux included) adds face tracking via OpenSeeFace.
- [PNGTuber Remix](https://github.com/MudkipWorld/PNGTuber-Remix/releases) v1.4.7 (2026-08-09): native Linux, open source, active, lip sync.
- [PNGTuber Plus](https://kaiakairos.itch.io/pngtuber-plus) 1.4.5 (April 2024): itch.io has a Linux build; the Steam build is Windows-only.
- [PuruPuruPNGTuber](https://github.com/rotejin/PuruPuruPNGTuber): local browser app; layered PNG puppet with MediaPipe tracking, mic-driven mouth, transparent output for OBS. Apache-2.0, active July 2026.
- Fit: usable for a stylized format, but only mouth open/closed plus image swaps, so the least expressive option.

### Face tracking inputs

**Webcam:**

- [OpenSeeFace](https://github.com/emilianavt/OpenSeeFace) v1.20.5 (2026-09-14, first release since 2021): native, runs via uv. Its README says it's steadier than MediaPipe in bad light with a wider range of mouth poses, but tracks eyes less accurately. Sends on UDP 11573. The [Facetracker Flatpak](https://flathub.org/apps/de.z_ray.Facetracker) (26.8.1) is a GUI for it.
- MediaPipe Face Landmarker: the best webcam option for mouth and brow detail (built into XR Animator, SnekStudio, nijitrack).
- NVIDIA Maxine AR SDK for Linux (0.8.8.1, June 2025) requires an NVIDIA AI Enterprise subscription, and no Linux VTuber app uses it.
- BRIO: shows up as several `/dev/video*` devices, including an infrared one, so pick the color stream. One report of v4l2loopback breaking webcam detection.

**iPhone:** iOS 27 (2026-09-14) still supports the A13 chip in the iPhone 11 Pro. Warudo's docs recommend iPhone 12 or newer and say older phones "may have lower tracking quality", but any Face ID phone works.

| App | Cost | Last update | Sends | Linux receivers |
|---|---|---|---|---|
| VTube Studio (iOS) | Free (the $22.99 PRO purchase isn't needed for PC) | v1.28.15 (2024-02-16); not verified on iOS 27 | To VTS on PC, port 25565 (Wi-Fi) or USB via iproxy2vts; other apps request data on UDP 21412 | VTS under Proton, Inochi Session, nijiexpose; VBridger under Proton |
| [iFacialMocap](https://apps.apple.com/us/app/ifacialmocap/id1489470545) | $7.99 (free trial app) | 1.5.2 (2026-04-17) | Plain-text UDP on 49983, after a PC handshake | Inochi Session, nijiexpose, Warudo, VSeeFace |
| [FACEMOTION3D](https://apps.apple.com/us/app/facemotion3d/id1507538005) | Free, in-app $0.99 to $16.99 | 1.4.5 (2026-08-06) | UDP (phone 49993, PC 49983) | Inochi Session, nijiexpose, Warudo, VSeeFace |
| [Live Link Face](https://apps.apple.com/us/app/live-link-face/id1495370836) | Free | 1.7.3 (2026-08-26), iOS 16+ | Live Link, UDP 11111 | Inochi Session, nijiexpose |
| [waidayo](https://apps.apple.com/us/app/waidayo/id1513166077) | Free | 2.1.0 (2024-08-30) | VMC over UDP | SnekStudio, Inochi Session, nijiexpose, Warudo, VNyan, VSeeFace |
| RhyLive | Free | 2022 | Own format | Warudo only; stale |

No ready-made custom hub exists. iFacialMocap's plain-text UDP stream could be relayed as VMC into SnekStudio (suggestion, untested).

**iPhone practical notes:**

- Network: aim for about 10 ms delay or less. 5 GHz Wi-Fi on the same subnet, not a guest network or one with client isolation. Mobile data off so the phone reports the right IP. Location Services off (periodic lag spikes). Open the UDP ports if a firewall is on. PC on Ethernet. USB alternative (VTS only): iproxy2vts with libimobiledevice and usbmuxd.
- Heat and battery: keep it on the charger with the case off. Use iFacialMocap's "Optimize for long-time streaming". Auto-Lock to Never. Check Battery Health, since iOS throttles worn batteries. 5 to 15 minute takes should be fine *(unverified)*.
- Placement: centered directly under or over the script, about arm's length, so reading doesn't turn the head. Don't put the sensor behind teleprompter glass (IR behavior untested). Lower eye-tracking sensitivity. Recalibrate a neutral face each session.
- Sync: tracking reaches the avatar slightly after the voice reaches OBS. Delay the mic with OBS's Sync Offset (measure with a clap), or fix it in the edit.

### Recording on Wayland

- **OBS** 32.2.2 is in Arch extra; run it as a native Wayland app. PipeWire window capture works for native and Proton windows. Transparency depends on the compositor and is unverified on KDE, so plan on a solid background plus chroma key.
- **[obs-vkcapture](https://github.com/nowrep/obs-vkcapture)** 1.5.6 (AUR, 2026-05-28): Game Capture on Linux. Launch the app with `OBS_VKCAPTURE=1 %command%`, use "Allow Transparency", needs `nvidia-drm.modeset=1`. Transparency from VTS or Warudo under Proton *(unverified)*.
- **Spout2PW** bridges Spout2 video out of Proton apps into OBS. The original was archived in March 2026; use the fork [tasokait/spout2pw](https://github.com/tasokait/spout2pw/releases) 0.3.0 (2026-08-12), tested with proton-cachyos 11.0-20260602 and GE-Proton11-1 (not Valve's Proton 11.0-1). Needs the obs-pwvideo plugin. In VTS use a black background with "Transparent in capture". Unverified on the NVIDIA proprietary driver.
- **v4l2loopback-dkms** 0.15.4: OBS's virtual camera. Only needed for video calls, not recording.
- **Unity memory leak workarounds:** restart the app between takes; Proton 8.0-5 (newer Warudo reportedly won't run on it); or a patched Proton (GE-Proton10-34-lina-fixes-v2).

### This track's picks

1. **Best 2D quality:** VTube Studio under Proton plus the VTS iPhone app over 5 GHz Wi-Fi. Capture with obs-vkcapture or Spout2PW, chroma key as the fallback. Start with a free sample model, then buy or commission one with ARKit mouth rigging. Software cost $0. Restart VTS between sessions.
2. **Native-first 3D:** SnekStudio (Flatpak) or XR Animator with a VRoid avatar. Webcam via MediaPipe, or iPhone via waidayo into SnekStudio. Nothing runs through Proton while recording.
3. **Pilot today:** veadotube mini or PNGTuber Remix, OBS window capture, chroma key. Tests the format in under an hour.

**Sources:** [VTS FAQ](https://github.com/DenchiSoft/VTubeStudio/wiki/FAQ), [VTS streaming to PC](https://github.com/DenchiSoft/VTubeStudio/wiki/Streaming-to-Mac-PC), [VTS connection troubleshooting](https://github.com/DenchiSoft/VTubeStudio/wiki/Connection-Issues-&-Troubleshooting), [VTS MediaPipe tracker](https://github.com/DenchiSoft/VTubeStudio/wiki/Mediapipe-Webcam-Tracker), [ProtonDB VTS](https://www.protondb.com/app/1325860), [VTS Linux gist](https://gist.github.com/BenKato151/b8b4a6897cc6cc7835ac9107288d3df2), [Linux Guide to Vtubing](https://codeberg.org/KyloNeko/Linux-Guide-to-Vtubing/wiki/Vtube-Studio), [Live2D comparison](https://www.live2d.com/en/cubism/comparison/), [Cubism specs](https://www.live2d.com/en/cubism/download/spec/), [nizima](https://store.live2d.com/en/), [Live2D sample terms](https://help.live2d.com/en/other/other_16/), [model pricing 2026](https://news.viverse.com/post/vtuber-model-pricing-2026), [where to buy models](https://streamlabs.com/content-hub/post/where-to-buy-vtuber-models), [Inochi Session releases](https://github.com/Inochi2D/inochi-session/releases), [facetrack-d](https://github.com/Inochi2D/facetrack-d), [XR Animator releases](https://github.com/ButzYung/SystemAnimatorOnline/releases), [SnekStudio releases](https://github.com/ExpiredPopsicle/SnekStudio/releases), [Warudo on Linux thread 1](https://steamcommunity.com/app/2079120/discussions/0/597408383633730475/), [thread 2](https://steamcommunity.com/app/2079120/discussions/0/680733951028039742/), [Warudo mocap overview](https://docs.warudo.app/docs/mocap/overview), [Warudo iFacialMocap](https://docs.warudo.app/docs/mocap/ifacialmocap), [Warudo Proton gist](https://gist.github.com/8ullyMaguire/8425b33dc74be9abcf52f9f3d1cbc46a), [Linux VTubing for 2026](https://letsbuildroboticswithshadow8472.com/index.php/2025/12/29/cold-start-vtubing-in-linux-for-2026/), [VNyan devlog](https://suvidriel.itch.io/vnyan/devlog), [VMagicMirror](https://github.com/malaybaku/VMagicMirror), [Webcam Motion Capture](https://webcammotioncapture.info/), [vpuppr](https://github.com/virtual-puppet-project/vpuppr), [veadotube install docs](https://veado.tube/docs/install/), [Maxine Linux AR SDK](https://catalog.ngc.nvidia.com/orgs/nvidia/maxine/resources/maxine_linux_ar_sdk_ga), [iOS 27](https://en.wikipedia.org/wiki/IOS_27), [MeowFace](https://suvidriel.itch.io/meowface), [Spout2PW](https://spout2pw.lina.yt/), [Spout2PW wiki](https://github.com/hoshinolina/spout2pw/wiki), [OBS transparency issue](https://github.com/obsproject/obs-studio/issues/5796)

## 6. Real-time AI video

Webcam in, character out, live. Checked 2026-09-24. Frame rates for this GPU are estimates.

### Animate one character image from the webcam (LivePortrait family)

**[LivePortrait](https://github.com/KwaiVGI/LivePortrait)** (KwaiVGI, MIT code)

- Last notable model update January 2025 (improved animals model). No official real-time webcam mode.
- About 12.8 ms per frame for the model on an RTX 4090 in PyTorch. Renders a 512x512 face crop and pastes it back into the character image ([paper](https://arxiv.org/abs/2407.03168)).
- Cartoons: trained with about 60k stylized images, but the usual failure is that the InsightFace detector doesn't find a cartoon face. One tester of about 15 characters needed a visible nose and a low enough mouth. Maintainers suggest the X-Pose detector for non-human faces ([discussion](https://huggingface.co/spaces/KlingTeam/LivePortrait/discussions/20)). Weak on large head turns; jitter when the shoulders move.
- Identity stays rock solid (every frame renders from the same image), and mouth motion comes from the performer's own lips. It is the same warping engine as Ditto, though, so expect a ceiling on mouth shapes (see [section 3](#3-lessons-from-talker)).
- InsightFace models are licensed non-commercial only; MediaPipe cropping avoids that.

**[FasterLivePortrait](https://github.com/warmshao/FasterLivePortrait)** (real-time fork)

- 30+ FPS on an RTX 3090 with TensorRT, including pre and post processing. Webcam mode: `run.py --dri_video 0 --realtime`.
- Blocked on Blackwell as shipped: requires TensorRT 8.x ("≥10.x not compatible") and cuDNN 8.x; the ONNX path needs a custom onnxruntime branch for its 5-D grid_sample. Last commit 2025-06-29. "RTX 5090 not working" (#190, 2025-10-30) open with no reply; the TensorRT 10 request (#91) open since 2024. The Docker image uses the old stack.
- Possible workarounds: `RemiEtien/liveportrait-trt10-hybrid-warp` (2026-07-09), a drop-in TensorRT 10 warp without the custom plugin, about 25 percent faster, tested on L40S and L4 only, 1 star (experimental). TensorRT 11.2.1 (July 2026) added native 3D GridSample, which may remove the plugin (unconfirmed with LivePortrait). Plain PyTorch LivePortrait on torch 2.7+ cu128 should work *(unverified)*.
- Estimate on the 5070 Ti: 25 to 45 FPS, 50 to 100 ms latency, a few GB of VRAM *(unverified)*.
- [WarpTuber](https://huggingface.co/AIWarper/WarpTuber): a one-click FasterLivePortrait VTubing package, Windows only. Warns that highly stylized anime or cartoon characters often fail detection (suggests `--animal`).

**[PersonaLive](https://github.com/GVCLab/PersonaLive)** (CVPR 2026, Apache-2.0): diffusion-based streaming with a browser UI. 15.8 FPS at 512² with 0.25 s latency on an H100; about 5 FPS reported on an RTX 4090 without TensorRT (issue #70). The paper admits it struggles with cartoon characters (blurred or distorted eyes and mouths). xformers must be disabled on Blackwell (issue #10). EditaLive (2026-08-28) adds full body. Not recommended here.

**Offline only, or too big:** X-Portrait 2 (no public code), HunyuanPortrait (CVPR 2025, 24 GB, academic license), SkyReels-A1 (February 2025), FollowYourEmoji, LiveAvatar (Alibaba; 5x H800 for real time, 48 to 80 GB on one GPU), NVIDIA Maxine Video Live Portrait (Linux, but needs an NVIDIA AI Enterprise subscription).

### Blackwell (sm_120) checklist

- **PyTorch:** 2.7 (April 2025) was the first stable release with sm_120 (cu128 wheels). Current projects use 2.11 (cu130), which driver 615 supports.
- **TensorRT:** 10.8 or newer (current is 11.3). Engines are tied to the GPU, so prebuilt engines must be rebuilt on this card.
- **cuDNN:** 9.x (8.x predates Blackwell).
- **xformers:** older wheels fail with "capability ≤ (9,0)". Use PyTorch SDPA instead.
- **onnxruntime-gpu:** mixed. 1.23 hit PTX JIT errors on a 5090 (onnxruntime #26177). Some wheels silently fall back to CPU. Community sm_120 wheels exist. The CUDA 13 build of 1.24.1 reportedly works with matching CUDA libraries. 1.28 to 1.30 (July to September 2026) list SM120 and CUDA 12.8/13. Always check `get_providers()`.

### Real-time diffusion restyling

These restyle the performer rather than locking to one character, so identity drifts and frames flicker. A poor fit for a recurring character.

- **[StreamDiffusion](https://github.com/daydreamlive/StreamDiffusion)** (Daydream fork): torch 2.8 cu128, TensorRT, SDXL, multi-ControlNet, IP-Adapter/FaceID, TemporalNet, StreamV2V cached attention. SD-Turbo img2img runs 94 FPS on a 4090; expect tens of FPS on 16 GB (estimate). IP-Adapter helps hold a character, but the face shifts frame to frame and the mouth follows loosely at 512 px.
- **StreamV2V and Live2Diff:** 2024 research releases. Live2Diff does 16 FPS at 512² on a 4090 with TensorRT; last update July 2024.
- **StreamDiffusionV2** (October 2025, MLSys 2026 best paper): Blackwell support 2026-05-17 (torch 2.11), 832x480. Daydream Scope documents a 24 GB VRAM minimum for every pipeline, so it doesn't fit 16 GB. Scope added a Livepeer cloud mode with credit billing (2026-04-21, price not found); last release v0.2.5 (2026-05-15). daydream.live now advertises a music product, so the hosted video tools' future is unclear *(unverified)*.
- **ComfyStream:** Docker and WebRTC, tested on a 4090. **TouchDesigner:** Windows and macOS only.
- **Krea Realtime 14B:** open weights, non-commercial license, needs 40 GB+ (11 FPS on a B200). Can't run locally.

### Cloud real-time services (browser-based, fine on Linux)

- **Decart Lucy 2.5** (2026-07-16; replaced MirageLSD): real-time character swap from a reference image over WebRTC via the `@decartai/sdk` JavaScript SDK. 1280x720 through the API. $0.02/s (about $72/hour), $0.04/s in fast mode; Lucy Restyle 2 (style only) $0.01/s; free credits for new accounts ([pricing](https://docs.platform.decart.ai/getting-started/pricing)). Video only; audio is handled separately. An August 2026 review notes identity drift and artifacts in character swaps; cartoon references unverified. The Decart Virtual Webcam Chrome extension (v1.1.5, 2026-03-02) has 60+ styles plus custom prompts and reference images and passes the mic through, but only works inside browser calls; pricing not stated.
- **[Viggle LIVE](https://viggle.ai/viggle-live):** one character image, and the webcam drives face and body. 1 to 2 s latency. No audio passthrough: Viggle's guide says capture the mic in OBS with a 1500 to 2500 ms Sync Offset. Free 5 min; Pro $7.99/mo (30 min); Live $15.99/mo ("6+ hours"); Max $63.99/mo unlimited (discounted from $9.99, $19.99, $79.99). Resolution not stated.
- **Krea Realtime Edit** (January 2026): live webcam restyle, 512 px fast or 1024 px quality. Free at 100 compute units/day, then $9, $35, or $105 per month. Restyles rather than fixing a character; no audio.
- **MorphMe Live:** cloud, full body, browser or Windows app. HD costs 2 credits/s, packs from $15, no free trial. Audio undocumented.
- **Smoke Screen:** Windows only.

### Voice-driven facial animation

- **[NVIDIA Audio2Face-3D](https://github.com/NVIDIA/Audio2Face-3D-SDK):** open-sourced September 2025. SDK is MIT; Linux (Ubuntu 20.04+) and Windows; CUDA 12.8 to 12.9 and TensorRT 10.13 up to (not including) 11. Models use the NVIDIA Open Model License and list Blackwell (tested on an RTX 5090). The SDK outputs mesh vertex motion; the NIM microservice outputs ARKit blendshapes; Maya and Unreal 5 plugins exist. Runs faster than real time. It drives a rigged 3D face, so hooking it to a 2D character on Linux is DIY.
- **Ditto:** Apache-2.0, has an online streaming mode, tested with TensorRT 8.6.1 (needs rebuilding on Blackwell). Already evaluated in talker (section 3).
- **Hallo-Live** generates its own speech from text, so it doesn't fit.

### Face swap

Deep-Live-Cam is not suitable. The inswapper_128 model only does realistic faces; cartoon sources break (discussion #677, a maintainer replied "Soon" in January 2025 and nothing shipped). Flickering masks on a 5090 with onnxruntime 1.22 (#1462). Non-commercial model.

### Getting AI output into OBS on Wayland

- Virtual camera: v4l2loopback-dkms. Chrome needs `exclusive_caps=1`, and pyvirtualcam can only open the device once in that mode (pyvirtualcam #61).
- OBS's PipeWire screen capture handles OpenCV, Gradio, or browser windows.
- Only one app can stream the webcam through V4L2. OBS 30.1+ has a PipeWire camera source, or the AI tool owns the webcam and publishes to v4l2loopback.
- Audio sync: delay the mic with OBS's Sync Offset, about 100 to 200 ms for local LivePortrait (estimate), 1.5 to 2.5 s for Viggle. Measure with a clap.
- For recorded videos, the simplest route: record raw webcam video and mic audio, run the model offline on the take, then mux the original audio back with ffmpeg. Exact sync, maximum quality.

### This track's picks

1. **Local LivePortrait:** live preview (TensorRT 10 warp or plain PyTorch on cu128), then re-render the take offline at full quality. Steadiest character, the performer's own lips, free, fully local. Catches: Blackwell setup, a detector-friendly character design, the InsightFace license, and the Ditto-style mouth ceiling.
2. **Decart Lucy 2.5** through a small page (or the Chrome extension for a quick look): low latency, 720p, about $1.20 per recorded minute. Cartoon quality unproven.
3. **Viggle LIVE:** fastest way to see the idea working ($15.99/mo, browser, full body), but 1 to 2 s lag and unknown resolution. Better as a trial than for final quality.

Skip: diffusion restyling (character drifts), Scope and Krea Realtime 14B (too much VRAM), Deep-Live-Cam (realistic faces only).

## 7. Record first, transform after

Film the performance normally, then have AI turn the footage, or just the audio, into the character. Checked 2026-09-24 against vendor pricing pages, official repos, Hugging Face, and ComfyUI source. All generation times for the RTX 5070 Ti are estimates scaled from 5090 and 4090 measurements; nothing was run on this card.

Every option keeps the performer's voice. The split that matters:

- **Video-driven** tools copy the performer's real face and head movement onto the character (Runway Act-Two, Wan Animate).
- **Audio-driven** tools invent head and body movement from the voice alone (Hedra, Kling Avatar, OmniHuman, InfiniteTalk). This is the talker approach ([section 3](#3-lessons-from-talker)).
- Cloud cost for a 3 minute segment: roughly $6 to $30. Locally: 480p, roughly 3 to 10 GPU hours per 3 minute segment (estimate).
- Outputs are flat frames (480p to 1080p), not a character layer, which matters for the vertical cut ([section 10](#10-publishing-formats)).

### Video-driven: performance video plus a character image

| Tool (status) | Limits | Cost | Cartoon quality and lip sync | Audio | Gotchas |
|---|---|---|---|---|---|
| **Runway Act-Two** (July 2025; still in Runway's September 2026 API pricing; no newer Act model) | Driving clip 3 to 30 s; about 720p (1280x720, 960x960); 24 fps | 5 credits/s, about $3/min at API rates ($0.01/credit); Pro plan $35/mo for 2,250 credits | Built to transfer face, mouth, and gestures; works on any character with a recognizable face; expression intensity 1 to 5; optional body control | Carries the driving clip's audio | Needs one clearly visible face. Blocks recognizable public figures, so the character must not resemble a real politician |
| **Runway Aleph 2.0** (2026-05-21) | Up to 30 s, 1080p | 28 credits/s, about $17/min | Restyles the actual footage, so the mouth really is the performer's; lip accuracy on stylized looks undocumented | Re-mux | Expensive |
| **Wan 2.2 Animate** (September 2025) and **Wan-Animate-2** (2026-08-07), open weights, Apache-2.0 | Local: any length with overlapping windows; also hosted on fal | fal: v1 $0.04 to $0.08/s; Animate-2 $0.05 (480p) to $0.115 (720p)/s, so $3 to $7/min. fal bills v1 as frames / 16, so upload at 16 fps | v1 reads the face from face crops. Animation mode (character in its own background) or replacement mode (keeps the room). Good expressions; users rate its lip sync below InfiniteTalk. Animate-2 reads the video directly; no public speech or lip test yet | Silent output, re-mux | Reference image must match the opening pose. Non-human faces can blur; "human" in the negative prompt helps |
| **Kling Motion Control 3.0** (2026-03-05) | Up to 30 s (character orientation follows the video) | fal: $0.126/s standard, $0.168/s pro (v2.6 standard $0.07/s), so $4 to $10/min | Strong body motion and identity; a reviewer says Act-Two is better for face and lips | Keeps audio by default | Framing must match (waist-up with waist-up) |
| **Luma Ray3 Modify** | 10 s input (Ray3 guide); 18 s claimed for Ray3.14 | Ray3 720p is 168 credits/s, about $30/min on Plus; Ray3.14 about $9/min but no Character Reference | Keeps timing and eyeline; lip accuracy undocumented | Re-mux | Free and Lite tiers are non-commercial |
| **Viggle** (V4; Viggle-Animate weights 2026-08-31) | V4 about 1 min *(unverified)* | About $0.01/s *(unverified)* | Viggle's own research page says lip sync is weak in close-ups | Unknown | Open weights are built on MiniMax H3 (33B, 96 GB VRAM), and the H3 license bars use in the US, EU, UK, and Korea |

Also: SCAIL-2 (June 2026, open, in ComfyUI) is 3 to 5x slower, and a community wiki calls its lip sync "not as good as InfiniteTalk".

**Wan versions:** 2.5, 2.6, 2.7, and 3.0 (API-only beta since 2026-08-06) are all closed. The newest downloadable weights ([Wan-AI on Hugging Face](https://huggingface.co/Wan-AI)) are still 2.2-based: Animate-2 and Wan-Dancer. Posts claiming "Wan 3.0 open weights" are wrong.

### Audio-driven: character image plus the recorded voice

Voice and timing are kept, but head motion and gestures are invented, and the performer's physical performance is lost (section 3).

| Tool | Where | Max per generation | Cost | Notes |
|---|---|---|---|---|
| **Hedra Character-3** (plus the Avatar model, up to 5 min, and Omnia, about 8 s max, both February 2026) | Cloud | 10 min | $0.025 / $0.05 / $0.0625 per s at 540p / 720p / 1080p. On plans 6 credits/s (Creator: $30 for 5,400 credits), so $2 to $3/min | Strongest track record with illustrated, 3D, and clay styles. Free tier watermarked and non-commercial |
| **Kling AI Avatar 2.0** | Cloud | 5 min | fal: $0.056/s standard, $0.115/s pro, so $3.4 to $6.9/min | Supports cartoons; a reviewer says check names, numbers, acronyms |
| **OmniHuman 1.5** (no v2 as of September 2026) | Cloud | 60 s at 720p, 30 s at 1080p | $0.12 to $0.16/s, so $7 to $10/min | BytePlus lists anime and cartoon support |
| **InfiniteTalk** (August 2025; in ComfyUI since 2026-01-22) | Local (Apache-2.0); fal $0.20/s | Claims unlimited; colors drift after about 1 min from one image | Free locally | Preferred open model for lip sync. Trained at 480p (720p gets noisy); 25 fps |
| **LongCat-Video-Avatar 1.5** (2026-05-21, MIT) | Local | Segment continuation | Free | What talker used. Official code needed about 40 GB VRAM and about 44 s of GPU time per output second |
| Wan 2.2 S2V, HuMo (97 frames max), EchoMimicV3 (1.3B, 12 GB), SkyReels-V3-A2V-19B, LTX-2.3 image+audio to video (about 20 s clips) | Local | | Free | Secondary. S2V lip sync weaker than InfiniteTalk. Sonic is non-commercial. The HunyuanVideo-Avatar license excludes the EU, UK, and Korea |

### Running locally on 16 GB VRAM and 32 GB RAM

Two front ends: ComfyUI (most flexible, high setup effort) or [WanGP](https://github.com/deepbeepmeep/Wan2GP) (simpler web UI that handles long videos; medium effort).

**Feasible:**

- **Wan-Animate-2:** built-in ComfyUI nodes since 2026-08-07. The official int8 (16.65 GB) and bf16 (32.8 GB) files are too heavy for 32 GB of RAM. Use GGUF Q4_K_M (11.3 GB) or Q5_K_M (12.7 GB), loaded with the "Rebels" loader node set to `model_type=animate2`; the standard GGUF loader runs but silently ignores the driving video ([GGUF notes](https://huggingface.co/realrebelai/Wan-Animate-2_GGUFs)). Turn off the Animate-2 pose cache (reported at about 12.5 GB of RAM at 480p).
- **Wan 2.2 Animate v1:** fp8 or GGUF with the lightx2v speed-up (4 steps) and block swapping, in [Kijai's WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) or built-in ComfyUI.
- **InfiniteTalk:** Kijai's example uses Wan2.1-I2V-480p Q8 plus InfiniteTalk Q8 GGUF, block swap 20, 832x480, 81-frame windows.
- **LongCat 1.5:** GGUF Q4_K_M is 12.1 GB; Kijai's wrapper has supported it since 2026-05-23. Not verified on 16 GB; likely slower than InfiniteTalk.

**Not feasible:** Viggle-Animate, MiniMax H3.

**Blackwell gotchas:**

- The official repos pin old PyTorch without RTX 50 support (InfiniteTalk torch 2.4.1+cu121, LongCat cu124, Animate-2 cu126). Use PyTorch for CUDA 12.8 or 13.0; driver 615 supports CUDA 13.4.
- Use SageAttention 2.2 compiled for RTX 50 on its CUDA backend; its Triton backend produces black frames with Wan.
- Skip the flash-attn versions those repos pin.
- Use a uv-managed Python 3.12 venv, or Docker with nvidia-container-toolkit.
- Close the browser while rendering; KDE and browsers hold VRAM.

**RAM trap:** ComfyUI holds every frame uncompressed, about 4.8 MB per 832x480 frame. A 3 minute clip at 16 fps is 2,880 frames, about 14 GB in and 14 GB out, which doesn't fit in 32 GB. Process 20 to 30 s chunks and keep a swapfile as a safety net.

**Speed (estimates):** an RTX 5090 took 150 s per 81-frame 832x480 Wan-Animate-2 window. A 4090 took about 450 s for 150 frames of Animate v1 at 720x1280 with 4 steps. InfiniteTalk without lightx2v was reported at up to 40 min per 10 s on a 4090. The 5070 Ti has about 0.42x a 5090's compute and 0.53x a 4090's, plus block swap overhead. At 480p that works out to about 5 to 15 min per 10 s (Animate v1, InfiniteTalk) and 15 to 25 min per 10 s (distilled Animate-2): 3 to 10 hours per 3 minute segment. 720p takes about 2.5 to 3x longer.

### Workflow for a 3 minute segment

1. **Record** in OBS: webcam at 1080p30 with a constant frame rate, mic as a separate 48 kHz WAV. Chest-up, same pose as the character image, plain background, no cuts. For Wan's animation mode, put the news desk in the character image, since the output uses its background.
2. **Split at pauses** with ffmpeg's `silencedetect=noise=-35dB:d=0.4`. Chunks up to 30 s (Act-Two, Kling), up to 60 s (OmniHuman, InfiniteTalk), about 20 s locally. Same character image, prompt, and seed for every chunk. Locally, carry the last frames forward (`continue_motion`) or use 81-frame windows with 30 frames of overlap. Hide the joins the way news shows do: cut to graphics or B-roll, or switch between wide and close crops.
3. **Frame rate:** Wan outputs 16 fps and InfiniteTalk 25 fps. Interpolate to 30 fps (RIFE or GIMM-VFI); duration is unchanged, so sync holds.
4. **Stitch and put the original WAV back on**, even if the tool passed audio through:

   ```sh
   ffmpeg -f concat -safe 0 -i list.txt -c copy video.mp4
   ffmpeg -i video.mp4 -i voice.wav -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 256k final.mp4
   ```

   Check both durations with ffprobe first. If the video is shorter, pad it with `tpad=stop_mode=clone`; `-shortest` would silently cut the last words.

| 3 minute segment (add 50 to 100 percent for retries) | Cost | Time |
|---|---|---|
| Hedra Character-3, 720p | About $6 (plan) to $9 (API) | Minutes, one generation |
| Runway Act-Two | 900 credits, about $9 to $14 | 7 chunks |
| Wan-Animate-2 on fal, 480p / 720p | $9 / $21 | Minutes |
| Kling Avatar 2.0 standard | About $10 | One generation |
| OmniHuman 1.5 | $22 to $29 | 3 chunks |
| Local Wan Animate or InfiniteTalk, 480p | About $0.50 of electricity | 3 to 10 hours (estimate) |

### This track's picks

1. **Runway Act-Two:** the tool most built to transfer the performer's own face and lips onto a cartoon. About $9 to $14 per segment, and 30 s chunks suit news editing.
2. **Hedra Character-3:** a whole segment in one generation, best cartoon track record, about $6 to $9, but gestures are invented (audio-driven). Kling Avatar 2.0 as the cheaper backup.
3. **Local Wan Animate** (v1 with lightx2v, or Animate-2 as Q4/Q5 GGUF) at 480p overnight, then interpolate and upscale. Test a 10 s take on fal's hosted Animate-2 (about $0.50) before spending an evening on setup.

**Not verified:** Animate-2 lip sync on speech; LongCat 1.5 on 16 GB; Viggle V4 length and price; how Kling and ByteDance moderate political audio; every 5070 Ti timing.

**Sources:** [Runway API pricing](https://docs.dev.runwayml.com/guides/pricing/), [Runway plans](https://runway.com/pricing), [Act-Two API parameters](https://docs.magnific.com/api-reference/video/runway-act-two), [Act-Two help](https://help.runwayml.com/hc/en-us/articles/42311337895827-Performance-Capture-with-Act-Two), [Runway moderation](https://docs.dev.runwayml.com/api-details/moderation/), [Aleph 2.0](https://runway.com/news/introducing-aleph-2-and-edit-studio), [Wan-Animate-2](https://github.com/Wan-Video/Wan-Animate-2), [Wan 3.0 status](https://www.atlascloud.ai/blog/tips/is-wan-3.0-open-source), [fal Animate-2](https://fal.ai/models/fal-ai/wan-animate-2), [fal Animate v1](https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/move), [Kling Motion Control guide](https://kling.ai/quickstart/motion-control-user-guide), [fal Kling Motion Control](https://fal.ai/kling-motion-control), [Kling review](https://www.aitoolssme.com/blogs/kling-3-0-motion-control), [Luma Ray3 Modify guide](https://lumalabs.ai/learning-hub/ray3-modify-user-guide), [Luma credits](https://lumalabs.ai/learning-hub/dream-machine-credit-system), [Viggle-Animate](https://viggle.ai/research/viggle-animate-character-replacement-from-a-repainted-frame), [H3 license](https://www.techtimes.com/articles/322904/20260804/minimax-h3-open-weights-exclude-us-eu-uk-korea-local-deployment.htm), [Animate lip sync vs InfiniteTalk](https://github.com/kijai/ComfyUI-WanVideoWrapper/issues/1679), [community Wan Animate notes](https://wanx-troopers.github.io/wan-animates.html), [Hedra Character-3](https://www.hedra.com/models/video/hedra/character-3), [Hedra costs](https://makefun.ai/hedra-character-omnia-avatar-video-cost-matrix/), [Hedra Avatar and Omnia](https://x.com/hedra_labs/status/2022396150956069051), [Kling Avatar on fal](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard), [Kling Avatar review](https://www.therundown.ai/tools/kling-avatar-2-0), [BytePlus OmniHuman](https://www.byteplus.com/en/product/OmniHuman), [OmniHuman limits](https://docs.magnific.com/api-reference/video/omni-human-1-5), [InfiniteTalk](https://github.com/MeiGen-AI/InfiniteTalk), [fal InfiniteTalk](https://fal.ai/models/fal-ai/infinitalk), [LongCat 1.5](https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.5), [LongCat review](https://www.visionstory.ai/open-source/longcat-video-avatar), [S2V vs InfiniteTalk](https://zanno.se/lets-talk-multitalk-infinitetalk-wan-s2v/), [EchoMimicV3](https://github.com/antgroup/echomimic_v3), [HunyuanVideo-Avatar license](https://github.com/Tencent-Hunyuan/HunyuanVideo-Avatar), [ComfyUI Wan node history](https://github.com/Comfy-Org/ComfyUI/commits/master/comfy_extras/nodes_wan.py), [Comfy-Org Animate-2 files](https://huggingface.co/Comfy-Org/Wan-Animate-2), [long-video node for Animate-2](https://github.com/FX-FeiHou/ComfyUI-FeiHou-WanAnimate2-Plus), [LongCat GGUF](https://huggingface.co/vantagewithai/LongCat-Video-Avatar-1.5-GGUF-ComfyUI), [RTX 5090 measurements](https://github.com/cyril-bgs-dev-tech/videogen-rtx5090), [4090 Animate timing](https://www.nextdiffusion.ai/tutorials/how-to-use-wan-2-2-animate-in-comfyui-for-character-animations), [slow InfiniteTalk report](https://github.com/MeiGen-AI/InfiniteTalk/issues/210), [SageAttention on Blackwell](https://github.com/mobcat40/sageattention-blackwell), [driver 615 and CUDA 13.4](https://docs.nvidia.com/datacenter/tesla/tesla-release-notes-615-71-09/index.html)

## 8. Cartoon puppet apps and building our own

Checked 2026-09-24.

### Purpose-built cartoon tools

None runs natively on Linux.

**Adobe Character Animator**, the reference tool for exactly this format:

- v26.0 (January 2026) is "improvements and stability updates, no new features". The last feature release was 23.6 (August 2023), so it's in maintenance in practice. Adobe moved its sister app Animate to maintenance mode in February 2026 after cancelling a shutdown ([TechCrunch](https://techcrunch.com/2026/02/04/after-backlash-adobe-cancels-adobe-animate-shutdown-and-puts-app-on-maintenance-mode)).
- Windows 10 and macOS 13+ only. Patched Wine now runs Photoshop and the Creative Cloud installers ([Tom's Hardware](https://www.tomshardware.com/software/linux/developer-patches-wine-to-make-photoshop-2021-and-2025-run-on-linux-adobe-creative-cloud-installers-finally-work-thanks-to-html-javascript-and-xml-fixes)), but there are no reports of Character Animator working that way *(unverified)*.
- Starter mode is free with an Adobe account: preset puppets, webcam face tracking, mic lip sync, recording, Quick Export. Pro needs Creative Cloud Pro ($69.99/mo) and adds custom puppets from Photoshop or Illustrator files, Puppet Maker, Body Tracker, a timeline, and triggers ([pricing](https://www.adobe.com/products/character-animator.html)).
- Tracks head, brows, gaze, and blinks; lip sync from the mic, recorded audio, or a transcript; Body Tracker; Motion Library ([version history](https://en.wikipedia.org/wiki/Adobe_Character_Animator)).

**Adobe Express "Animate from audio"** (browser, works on Linux): pick one of about 200 preset characters, upload or record audio, and get lip sync plus head, eye, and arm motion in your own voice. Free, 2 minutes max per animation, no custom characters, audio-driven only (no face tracking), no transparent export (use a green background). Output resolution and watermark *(unverified)*. ([feature page](https://www.adobe.com/express/feature/video/animate/audio), [review](https://www.animationandvideo.com/2024/07/animate-from-audio-fast-free-talking.html))

**Reallusion Cartoon Animator 5:** 5.34 (2026-01-06). The last feature update, 5.3 (August 2024), added Puppet Stage: live face capture, voice lip sync, and hotkey-triggered animations. No v6 announced; the April 2026 roadmap is all 3D. Windows and macOS only. $149 list (seen at $79 on sale). Webcam tracking needs the paid Motion LIVE 2D plugin plus the Webcam Profile (about $399 per a 2022 forum post; current price *(unverified)*). Staff say Face ID iPhones track better than webcams. 30-day trial. ([version history](https://www.reallusion.com/cartoon-animator/update.html), [5.3 announcement](https://magazine.reallusion.com/2024/08/29/cartoon-animator-5-3-update-powerful-puppet-performances/), [price thread](https://discussions.reallusion.com/t/cartoon-animator-5-price-drop/15496), [webcam setup](https://kb.reallusion.com/Product/52817/How-to-start-2D-Facial-Mocap-via-webcam-), [webcam vs iPhone](https://forum.reallusion.com/526713/Forum563.aspx), [2026 roadmap](https://magazine.reallusion.com/2026/04/08/reallusion-announces-2026-vision-redefining-3d-production-through-the-power-of-hybrid-ai/))

**Animaze:** Windows 10 and iOS; still developed (1.27.x in late 2025 added webcam hand tracking and a 45-minute free-tier session cap). Free tier is watermarked with no MP4 export; Plus $19.99/yr; Pro $99.99/yr; lifetime Pro 2024 add-on $149.99 ([pricing](https://www.animaze.us/pricing-individual), [news](https://www.animaze.us/news)). Under Proton, first-run setup hangs installing virtual device drivers ([Proton #4608](https://github.com/ValveSoftware/Proton/issues/4608)).

Browser and Linux-native alternatives are covered in [section 5](#5-classic-vtuber-software-on-linux). Also: [OpenLive3D](https://github.com/OpenLive3D/OpenLive3D.github.io) (3D VRM in the browser with MediaPipe, v2.7.0 2026-09-20, Apache-2.0). Kalidoface is effectively dead (the 2D version shut down in November 2022 over Live2D licensing).

### Building our own: building blocks

**Face tracking**

- **MediaPipe Face Landmarker:** 478 landmarks, 52 ARKit-named values, and a 4x4 head pose matrix. MediaPipe v1.0.0 (2026-07-28); `@mediapipe/tasks-vision` 1.0.1 (2026-07-31); Python 1.0.1 (2026-08-14, Linux x86_64). Browser and Python run the same model; the browser version uses the GPU via WebGL2. Known limits: `cheekPuff` reads about 0 and there's no `tongueOut` ([#4436](https://github.com/google/mediapipe/issues/4436)); jaw left/right/forward and dimples are unreliable; left/right asymmetry and eye jitter reported; the improved v3 model was never released ([#5329](https://github.com/google-ai-edge/mediapipe/issues/5329)). Good for head pose, blinks, brows, jaw open, and smiles. In Python, `mp.solutions` was removed in 0.10.30, so use the Tasks API ([#6200](https://github.com/google-ai-edge/mediapipe/issues/6200)).
- **Kalidokit** is stale (npm 1.1.5, February 2022). MediaPipe's own values and matrix now cover its face job.
- **iPhone ARKit** via an app's network stream (section 5) is the quality option.

**Character rendering.** For a cartoon look, roughly best to worst: Rive, then layered PNG/SVG or Spine, then Live2D, then 3D VRM.

- **[Rive](https://github.com/rive-app/rive-wasm)** runtime 2.43.1 (2026-09-23), 44 releases in the last year. Runtimes are MIT and the editor runs in the browser. Since October 2025 exporting .riv files needs the paid Cadet plan ([docs](https://rive.app/docs/account-admin/pricing) list $17 per seat per month). Vector art, bones, mesh deformation, state machines. Mapping: numeric inputs (or data binding) for each blink, brows, jaw, and smile as blend layers; a joystick for head turn and tilt; a numeric viseme input switching mouth states. Duolingo's Lily uses this pattern with 20+ mouth shapes ([Rive blog](https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life), [tutorial](https://rive.expert/blog/lip-sync-animation)). No public project drives Rive from face tracking yet, so this part would be new.
- **[Spine](https://esotericsoftware.com/blog/Spine-4.3-released)** 4.3 (runtime 4.3.0, May 2026): the new Sliders let code drive poses, much like Live2D parameters. The editor runs natively on Linux. Essential ($69) lacks meshes, IK, and physics, so Pro ($379) is needed; using the runtimes requires an editor license.
- **Live2D Cubism SDK for Web** R5 (April 2026): [free for individuals and small businesses](https://www.live2d.com/en/sdk/license/) under ¥10M in sales. The editor is Windows and macOS only (free tier limits in section 5). `pixi-live2d-display` is stale (2022); the active fork `untitled-pixi-live2d-engine` 1.4.0 (2026-09-20, MIT) is small. Best 2.5D head turns; the ecosystem leans anime.
- **[three-vrm](https://github.com/pixiv/three-vrm)** 3.5.5 (July 2026, MIT): 3D VRM models with built-in visemes (aa, ih, ou, ee, oh) and ARKit expression support. The toon shader gives an anime look; a Western-cartoon 3D character is a real modelling job.
- **Inochi2D runtimes:** the SDK is being refactored in 2026 and the web runtime Inox2D says "prototype, not for production". Skip for now.
- **Plain layered PNG or SVG** on Canvas or PixiJS: free, fastest start. A Character Animator-style cutout puppet (mouth swaps, blink frames, slight head shift).

**Lip sync from the performer's voice**

- **[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync)** 1.14.0 (2025-04-03): MIT, Linux binary, offline on recorded audio. Classic cartoon mouth shapes (6 basic, A to F, plus optional G, H, X). `--dialogFile` takes the script for better accuracy. Best for a render-after-recording pass.
- **[wLipSync](https://github.com/mrxz/wLipSync)** 1.3.1 (August 2026, MIT): browser port of uLipSync, real time, calibrated on the performer's own vowels.
- **[HeadAudio](https://github.com/met4citizen/HeadAudio)** 0.1.0 (December 2025, MIT): real time, 15 visemes, 50 to 100 ms latency; accuracy "far from optimal" with background noise.
- **uLipSync:** Unity only (last release July 2024).
- **NVIDIA Audio2Face-3D:** see section 6. Outputs ARKit-named values; heavy setup; would run well on this GPU.
- **Script alignment:** Montreal Forced Aligner or WhisperX give exact phoneme timings from a known script. The most accurate offline option when reading from a script.
- **Suggested split:** head, eyes, and brows from tracking; mouth openness from the larger of tracked jaw and voice loudness; mouth shape from audio (wLipSync live, Rhubarb or an aligner for the final render).

**Projects to borrow from** (maintained 2025 to 2026):

- [PuruPuruPNGTuber](https://github.com/rotejin/PuruPuruPNGTuber) (2D, Apache-2.0)
- [OpenLive3D](https://github.com/OpenLive3D/OpenLive3D.github.io) (3D, Apache-2.0)
- [vtubeleaf](https://github.com/moonrailgun/vtubeleaf) (MIT, September 2026; Live2D plus MediaPipe desktop app; useful mapping reference)
- TalkingHead 1.7.0 plus HeadAudio (MIT)
- MediaPipe's official [avatar CodePen](https://codepen.io/mediapipe-preview/pen/oNPKmEy)
- XR Animator, reference only (non-commercial license)
- Avoid: Kalidoface-3D, pixiv/ChatVRM (archived May 2025), vpuppr (archived)

### Minimal custom pipeline (sketch)

With the iPhone, its network stream replaces the MediaPipe step.

```
webcam 720p60 -> MediaPipe FaceLandmarker (GPU) -> expression values + head pose --+
USB mic 48 kHz (browser processing OFF) -> AudioWorklet (wLipSync) -> visemes ------+
                            smoothing + neutral calibration + mapping table <-------+
        -> Rive state machine (or PNG layer puppet) -> 1920x1080 canvas
        -> (a) OBS window capture, or (b) canvas.captureStream + mic -> MediaRecorder -> ffmpeg

Optional record-then-render: save webcam + WAV + per-frame tracking data, re-render at a fixed
frame rate with Rhubarb (fed the script), encode in-browser (WebCodecs + Mediabunny) -> MP4
```

| Piece | Effort (one developer, excluding character art) |
|---|---|
| Tracking, smoothing, calibration | 0.5 to 1 day |
| Live mouth shapes from audio | 0.5 to 1 day |
| Renderer, PNG puppet | 1 to 2 days |
| Renderer, Rive | About 1 day to integrate, plus days to learn Rive and rig the art |
| Recording and ffmpeg post-processing | 0.5 day |
| Record-then-render pass | 2 to 3 days |
| News-show extras (teleprompter, lower thirds, desk) | 1 to 3 days |

A working first version is about 3 to 5 developer days. Drawing and rigging the character is the long pole.

**Gotchas on this machine:**

- **Webcam:** ask for 720p or 1080p at 60 fps; 4K gains nothing for tracking. Usually only one app can stream the camera at a time, so don't open it in OBS and the page together. Chrome has a PipeWire camera flag that may allow sharing (untested).
- **Mic:** set `echoCancellation`, `noiseSuppression`, and `autoGainControl` to false, or Chrome will process the voice.
- **Graphics:** stick to WebGL2. WebGPU on Linux with NVIDIA is only on from Chrome 147 under Wayland ([status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)).
- **Recording:** Chrome 126+ can write MP4 from MediaRecorder ([chromestatus](https://chromestatus.com/feature/5163469011943424)); Firefox only writes WebM. WebM from MediaRecorder needs an ffmpeg remux to fix duration and seeking. OBS's Browser Source needs `--enable-media-stream` to use the camera, so Window Capture is simpler.

### This track's picks

1. **Build the browser app in this repo:** MediaPipe or iPhone tracking, a 2D cartoon rig (layered PNG/SVG first, Rive for polish), wLipSync live, in-page recording. Native on Linux, voice untouched, cartoon look, every dependency maintained in 2025 to 2026. Add the Rhubarb record-then-render pass later.
2. **Adobe Express "Animate from audio"** as a zero-code test in the browser. Keeps the voice, but 2 minute cap and preset characters only.
3. **Character Animator Starter** (free), only if a Windows or Mac machine is available. Best quality today, but it has had no new features since 2023.

**Could not verify:** Adobe release-note wording; Adobe Express output resolution and watermark; current Reallusion mocap add-on prices; Wine support for Adobe or Reallusion; real frame rates on this hardware; whether Chrome's PipeWire camera flag helps.

## 9. One performer, many characters

Checked 2026-09-24 by fetching primary sources directly (vendor docs, the App Store API, GitHub, Hugging Face, Steam, ProtonDB). Items marked *(unverified)* come from prior knowledge only.

### Several characters in one scene

| App | Multiple characters, and how you switch | Linux | Cost |
|---|---|---|---|
| Warudo | Yes. Tracking and automation nodes each target one character ([docs](https://docs.warudo.app/docs/blueprints/templates/arm-sway)); switch by toggling each character's face-tracking setup from a hotkey, MIDI, Stream Deck, or WebSocket. No built-in "active speaker" feature | Windows only; ProtonDB Gold (25) | Free for personal use |
| VTube Studio | One model per running copy; officially supports several copies sharing one webcam or one iPhone ([wiki](https://github.com/DenchiSoft/VTubeStudio/wiki/Controlling-multiple-models-with-one-Webcam-or-iPhone-Android-device)). The plugin API can override tracked values with a 0 to 1 blend weight, so a helper can fade inactive characters to idle | Windows and macOS; ProtonDB Gold (16) | Free; DLC removes watermark |
| Inochi Session | Yes: the scene holds a list of puppets, each with its own tracking mappings (confirmed in source). Accepts VMC, Live Link Face, iFacialMocap, Facemotion3D, the VTS phone app, OpenSeeFace, and plain HTTP ([facetrack-d](https://github.com/Inochi2D/facetrack-d)). Last release v0.8.7 (September 2024); fork nijiexpose 1.0.0-beta2 (June 2026) | Native | Free, open source |
| veadotube (full version) | Scenes with several 2D avatars, a node system, camera, mic, MIDI, and WebSocket inputs ([site](https://veado.tube/)) | Native; early access via Ko-fi | Ko-fi tiers (mini is free) |
| PNGTuber-Remix v1.4.7 (August 2026) | Rigged sprites, WebSocket control | Native | Free |
| VNyan 1.7.2d | Online collabs (VNyanNet), 4 VMC inputs; several local avatars in one scene undocumented | Windows only | Free |
| VSeeFace | One avatar only | Wine, reportedly | Free |
| Adobe Character Animator | The classic workflow: arm one puppet, record its take, layer the takes | Windows and macOS *(unverified for 2026)* | Subscription |
| Reactive Images (fugi.tech) | One image per Discord user, driven by voice activity; used as a browser source | Any OS | Free |

How performers do it today:

1. Record one character at a time and layer the takes (Character Animator).
2. Run one app copy per character and toggle them with hotkeys or visibility (VTube Studio multi-instance).
3. For groups, voice-activated sprite sets (Reactive Images, Discord StreamKit). Tabletop game streams usually give each player their own avatar.

No authoritative write-up of audiobook narration with avatars was found.

### Recording and replaying the performance

The iPhone 11 Pro (TrueDepth, A13) is supported by every app below. The one exception is Live Link Face's MetaHuman Animator mode, which needs an iPhone 12 or later and a Windows PC; its ARKit mode works.

| App | Records on the phone | Streams to Linux | Cost |
|---|---|---|---|
| **Live Link Face** v1.7.3 (2026-08-26), iOS 16+ | Each take is a CSV plus a MOV. The CSV has timecode, the 52 blendshapes, head yaw/pitch/roll, and each eye's yaw/pitch/roll; the MOV has frame-accurate video, phone-mic audio, and timecode (from the system clock, an NTP server, or a Tentacle Sync). Remote control over OSC: `/RecordStart`, `/RecordStop` (replies with file paths), `/Transport` (pulls files over TCP), battery and heat queries ([Epic doc](https://dev.epicgames.com/documentation/en-us/unreal-engine/recording-face-animation-on-ios-device-in-unreal-engine)) | UDP 11111. Received by Faceit, Inochi Session, a free [Blender receiver](https://github.com/shun126/livelinkface_arkit_receiver) (September 2026, no head rotation), and the Python library [PyLiveLinkFace](https://github.com/JimWest/PyLiveLinkFace) | Free |
| VTube Studio (iOS) | No | [UDP 21412, JSON](https://github.com/DenchiSoft/VTubeStudioBlendshapeUDPReceiverTest): every frame carries a Unix-millisecond timestamp, the 52 blendshapes, and head and eye rotation; can send to up to 32 ports at once | Free |
| iFacialMocap v1.5.2 (April 2026) | REC mode, then FBX by email | UDP 49983 / TCP 49986, text format ([spec](https://www.ifacialmocap.com/for-developer/)); no timestamp field | $7.99 |
| FACEMOTION3D v1.4.5 (August 2026) | FBX with optional audio; free tier has a recording time limit | Blender, Unreal, Unity add-ons | $16.99 removes the limit; $16.99 for Blender streaming (monthly options too) |
| Face Cap v2.0.3 (August 2024) | FBX/TXT export with mic audio recorded in sync | OSC | $8.99 subscription or $69.99 for everything |
| waidayo v2.1.0 (August 2024) | No | Sends VMC directly from the phone; full ARKit name set *(unverified)* | Free |
| ZIG SIM PRO / Data OSC | Data OSC can record to JSONL/CSV | Face data over OSC or JSON; all 52 values *(unverified)* | $3.99 / free |
| Rokoko Face Capture | Only works with Rokoko Studio (Windows and macOS *(unverified)*), so not usable on Linux | | |

**PC-side recorders and importers:**

- [Faceit](https://faceit-doc.readthedocs.io/en/latest/mocap_live/) for Blender ($78 or $99; Blender 3.0 to 5.2): receives Live Link Face (11111), iFacialMocap (49983), and Face Cap (9001) live and records them into Blender animation. Imports Live Link Face CSV, Face Cap TXT, and Audio2Face JSON, with an audio track.
- [HEVA_Portal](https://github.com/scaledteam/HEVA_Portal): receives VMC in Blender, records animation plus sound (2025).
- [LLV](https://github.com/think-biq/LLV): Python CLI that records and replays Live Link Face frames.
- [MotionReplay](https://github.com/emilianavt/MotionReplay) (Unity) and [VRMPlaybackClient](https://github.com/kevinjycui/VRMPlaybackClient) (Windows, with audio): dump and replay VMC streams.
- Warudo Motion Recorder saves WANIM, BVH, or experimental FBX; its Motion Player (beta) only plays WANIM. VTube Studio "Record Animations" saves a model-specific motion file with no audio. VMC4B (the Blender VMC add-on) is stale (v1.1.1, 2022).
- Backup route: [DeadFace](https://github.com/Qaanaaq/DeadFace) turns recorded webcam video into a Live Link Face-style CSV using MediaPipe.

**Unreal Engine:** UE 5.8 officially supports Linux (NVIDIA driver 570+, Vulkan; [requirements](https://dev.epicgames.com/documentation/en-us/unreal-engine/linux-development-requirements-for-unreal-engine)). Live Link Face streaming in the Linux editor *(unverified)*. Epic ties the MetaHuman Animator workflow to Windows.

**Keeping phone data in sync with the USB mic on the PC:**

- **A. Stream to the PC and record there (live path).** The hub stamps each incoming frame with the PC clock and records the mic itself, or starts OBS through obs-websocket and logs the start moment. Remove the fixed network delay (typically tens of milliseconds; measure it). Start each take with a sharp "PA!" so the jaw spike lines up with the sound, or estimate the delay automatically by matching the `jawOpen` curve against audio loudness. The VTS phone app's timestamps reveal jitter; iFacialMocap sends none.
- **B. Record on the phone (most robust).** The hub sends `/RecordStart` to Live Link Face when it starts recording, then pulls the CSV and MOV with `/Transport` after `/RecordStop`. Align the MOV's phone-mic audio with the USB-mic WAV using [audio-offset-finder](https://github.com/bbc/audio-offset-finder) or [syncstart](https://github.com/rpuntaie/syncstart), then shift the CSV by the same amount (CSV and MOV share timecode). Wi-Fi dropouts lose nothing.
- **Suggested:** B as the master copy for anything that will be re-rendered, A for live monitoring.

### The data bus

- **[VMC protocol](https://protocol.vmc.info/english.html) v3.1:** OSC over UDP, ports 39539 and 39540. Carries blendshape values under any name (`/VMC/Ext/Blend/Val`, then `/VMC/Ext/Blend/Apply`), so ARKit "perfect sync" names pass straight through, plus bones, root position, time, camera, trackers, MIDI, keys, and lighting. Receivers: Warudo, VNyan, VMagicMirror, Animaze, Inochi Session, plus Unity, Unreal, and Godot plugins. Senders: VSeeFace, XR Animator, Webcam Motion Capture, waidayo, TDPT, and others. Each receiver needs its own port, so the hub must fan the stream out (the existing splitter, VMCProtocolReflector, is Windows-only). Libraries: python-osc, [pykeio/vmc](https://github.com/pykeio/vmc) (Rust, 2026).
- **ARKit's 52 names are the common language:** every iPhone app and MediaPipe use them, and VRChat's Unified Expressions maps to them. Watch the capitalization: ARKit and VRM use `jawOpen`, the Live Link Face CSV uses `JawOpen`.
- **VTube Studio plugin API:** WebSocket on port 8001, up to 100 custom parameters per plugin; injected values override tracking with a blend weight and must be resent at least once a second; can also fire hotkeys and load models ([README](https://github.com/DenchiSoft/VTubeStudio)).
- **iFacialMocap, VTS phone, and Live Link** are each app's own output format: good inputs, poor hubs.
- **Verdict:** one internal frame format (phone timestamp, PC timestamp, the 52 ARKit values, head and eye pose). Send it as VMC/OSC to native apps and as WebSocket JSON to browser renderers and OBS browser sources; use the VTS API only if using VTube Studio. Save takes as JSONL plus a Live Link Face-compatible CSV, so Faceit and Blender importers work unchanged.

### Making characters at each fidelity tier

**(a) Flat sprites.** Current AI image editors are consistent enough if you edit only the mouth and eye regions of one base image, so every variant lines up pixel for pixel. [EasyPNGTuber](https://github.com/rotejin/EasyPNGTuber) (February 2026) documents the workflow: a cloud model (Google's Nano Banana) generates a 2x2 expression sheet, then feature matching aligns the variants. Local open models that can do the same: Qwen-Image-Edit-2511 (Apache-2.0, December 2025), FLUX.2 klein 4B (Apache-2.0, January 2026), and Qwen-Image-2.1 (2026-09-14; transparent output, masked edits, up to 10 reference images; research license, check terms). Blackwell needs CUDA 12.8+ builds. About an evening per character.

**(b) 2D cutout puppets.** [Qwen-Image-Layered](https://huggingface.co/Qwen/Qwen-Image-Layered) (Apache-2.0, December 2025) splits one image into separate transparent layers. Rig in nijigenerate or Inochi Creator (Linux, free), Spine (Linux; $69, but mesh deformation needs Pro at $379), veadotube, or PNGTuber-Remix, or drive the layers from our own renderer. Live2D Cubism is Windows and macOS only. Days per character.

**(c) 3D creature (Wookiee-like).**

- Buying is fastest: Booth sells furry and kemono VRChat avatars for ¥4,000 to ¥18,000 (one werewolf is ¥5,000) and face-tracking add-ons for ¥1,500 to ¥4,500 ([search](https://booth.pm/en/search/%E3%83%95%E3%82%A7%E3%82%A4%E3%82%B9%E3%83%88%E3%83%A9%E3%83%83%E3%82%AD%E3%83%B3%E3%82%B0%20%E3%82%B1%E3%83%A2%E3%83%8E)). Check each license.
- AI 3D generation: TRELLIS.2 (MIT, December 2025), Hunyuan3D-2.1 and Omni (Tencent license), Tripo and Meshy (paid; Meshy's auto-rigging is humanoid-only, no face). Body rigging: UniRig and its successor SkinTokens (open); Mixamo and AccuRIG for humanoids *(not re-verified)*.
- The face is the hard part. AI meshes have no mouth interior, eyelids, or eyeballs, so expect to rebuild topology. Then use Faceit (semi-automatic 52 ARKit shapes; its FAQ says it's "possible to rig wolfs or sheep or dragons"), hand-sculpt about 15 to 25 key shapes and map the other ARKit values onto them, or pay Polywink (€299 to €999, 24-hour turnaround, handles "cartoon monsters"; its site currently says "under maintenance").
- Fur: Blender's hair curves follow the surface as it deforms; real-time VRM apps need fur cards or shell shaders instead.
- Effort: a weekend starting from a Booth avatar; 1 to 3 weeks starting from AI generation.

**(d) "Fully rendered" puppet look.** The best Linux route is Blender 5.2.2 LTS: EEVEE for previews and Cycles rendering offline from recorded takes. The VRM add-on (v4.7.2) imports Booth avatars. Real time in UE 5.8 with Groom hair and fur is possible, but Live Link and Groom on Linux are *(unverified)*. Optional AI restyle pass: feed the rendered rig video as the driving video into Wan-Animate-2 or LivePortrait (Wan-Animate-2 is 14B, so quantize or offload on 16 GB).

### Knowing who is speaking

**(a) Script with speaker tags, followed by live speech recognition.**

- [Linefeed](https://github.com/NxTsh/linefeed) is the closest ready-made base: Linux, Apache-2.0, sherpa-onnx streaming recognition with a script aligner, and a CLI that writes replayable timelines. Very young project.
- Advanced Scene Switcher 1.36.1 (2026-08-07) added a whisper.cpp speech condition inside OBS, but only for keyword triggers.
- Engines: sherpa-onnx 1.13.8, whisper.cpp 1.9.4, WhisperLive 0.10.0, SimulStreaming (replaces whisper_streaming), Moonshine (MIT, streaming), Vosk.
- Trick: because the script is known, switch to the next speaker when recognition reaches the end of the previous line. That hides the 0.3 to 1 s recognition lag.
- Post-production: WhisperX 3.8.6 or the Montreal Forced Aligner 3.4.2 line the script up with the recording for an almost exact speaker timeline.

**(b) Classifying which character voice is in use.** Pitch tracking (torchcrepe, aubio) plus speaker embeddings (ECAPA, WeSpeaker, sherpa-onnx speaker ID) trained on samples of each character voice. Can work for very distinct voices, but there is no ready-made tool, it needs 0.5 to 1 s of audio, and speaker-ID models are built to recognize the same person across voices, so they may not tell the characters apart. Tie-breaker only.

**(c) Manual controls.** Stream Deck, including the Stream Deck Pedal, works on Linux via [StreamController](https://github.com/StreamController/StreamController). USB foot pedals can be read directly through evdev ([footswitch](https://github.com/rgerganov/footswitch) programs PCsensor pedals). MIDI pads work through obs-midi-mg or Advanced Scene Switcher. Wayland caveat: OBS 32.2.2 still has no global hotkeys on Wayland ([#13661](https://github.com/obsproject/obs-studio/pull/13661), [#13680](https://github.com/obsproject/obs-studio/pull/13680) open), so the hub should read input devices directly.

**Most reliable:** a foot pedal that steps through the speaker-tagged script (no ambiguity), optionally auto-advanced by speech alignment. In post, forced alignment plus manual fixes.

### Architecture suggested by this track

```
iPhone: Live Link Face (ARKit mode) --- UDP 11111 live stream -----------+
   also records CSV+MOV takes; the hub drives it over OSC                 |
Webcam -> MediaPipe (fallback, or re-track recorded video offline) -------+
USB mic -> PipeWire ------------------------------------------------------+
Pedal / Stream Deck / MIDI (read via evdev and mido) ---------------------+
Speaker-tagged script + speech follower (optional) -----------------------+
                                                                           v
HUB (Python, uv)
  - convert every input to one ARKit-52 frame, stamped with the PC clock
  - record each take: WAV + JSONL + Live Link Face-style CSV + speakers.json
  - speaker router: the active character gets live data; the others idle
    (blinks, breathing, glancing at the speaker)
  - replay mode sends a recorded take out exactly like live data
      |                |                     |              |              |
  WebSocket JSON   VMC/OSC, one port    VTS plugin API  obs-websocket    files
      |            per receiver              |              |              |
      v                v                     v              v              v
  browser          Inochi Session /      VTube Studio   scene and      Blender
  renderers        nijiexpose (native),  (Proton)       source         (EEVEE or Cycles
  (sprite, 2D,     Warudo (Proton)                      toggles        renders from
  three-vrm) as                                                        recorded takes)
  OBS browser sources
                          v
         OBS: 16:9 canvas + Aitum Vertical 9:16 canvas -> record
```

The key design choice: renderers can't tell live frames from replayed ones. Perform once, then re-perform the take through any character (live renderers plus OBS) or render it offline in Blender, with the speaker timeline from the pedal log or forced alignment.

## 10. Publishing formats

Checked 2026-09-24.

| Platform | Length limit |
|---|---|
| YouTube Shorts | 3 minutes |
| Instagram Reels | Up to 20 minutes, but Reels over 3 minutes aren't recommended to new audiences |
| TikTok | 10 minutes recorded in-app |

([Shorts guide](https://adcreate.com/blog/youtube-shorts-length-guide-2026), [Reels guide](https://buffer.com/resources/instagram-reels-length/))

**Plan:**

- 16:9 master for YouTube; vertical cuts of 3 minutes or less.
- One news story per segment: each works as a standalone Short, and together they make the long episode.
- **Compose twice, don't crop.** Keep the character as its own layer and lay it out separately for each canvas (wide: character to one side, headline beside it; vertical: character on top, headline below). The [Aitum Vertical](https://github.com/Aitum/obs-vertical-canvas) OBS plugin (Linux supported; 1.6.2 released 2026-02-05) records a 16:9 and a 9:16 canvas at the same time.
- **Packages on CachyOS (checked 2026-09-24):** `obs-studio` 32.2.2 and `obs-studio-plugin-browser` (the CEF browser source) are in the official repos; Aitum Vertical is `obs-vertical-canvas` 1.6.4 in the AUR (also `obs-vertical-canvas-bin`). Browser sources render with a transparent background, so web-based characters need no chroma key.
- Rendered avatars produce a clean layer at any resolution. Generative video produces flat frames: a 9:16 crop from 1080p is about 608x1080, and from Act-Two's 720p about 405x720.
- Filming: keep head and shoulders centered and avoid drifting sideways.

## 11. Costs and monetization

Checked 2026-09-24.

### Paid AI transforms: the Runway Act-Two math

Act-Two uses 5 credits per second of output, and API credits cost $0.01 each, so $0.05 per second ([API pricing](https://docs.dev.runwayml.com/guides/pricing/)). App plans ([pricing](https://runway.com/pricing)):

| Plan | Price | Credits per month | Act-Two output per month |
|---|---|---|---|
| Free | $0 | 125, one time | About 25 s, once |
| Standard | $12/mo billed annually, $15 monthly | 625 | About 2 min |
| Pro | $28/mo billed annually, $35 monthly | 2,250 | 7.5 min |
| Max | $76/mo billed annually, $95 monthly | 9,500 | About 31 min |

Standard and Pro credits reset each month (no rollover); Max rolls over up to one month. A 3 minute segment needs 900 credits before retries, about 1,350 to 1,800 with typical retries. Standard can't cover one segment; Pro covers one or two a month. Add Act-Two's 30 s chunks and roughly 720p output (poor vertical crops, section 10), and paid transforms are out as the core path. The free 125 credits are enough to see Act-Two once.

### YouTube monetization (if it comes to that)

- **Eligibility** ([YouTube Partner Program](https://support.google.com/youtube/answer/72851)): 1,000 subscribers plus 4,000 public long-form watch hours in the last 12 months, or 1,000 subscribers plus 10 million Shorts feed views in the last 90 days.
- **Reused content** ([monetization policies](https://support.google.com/youtube/answer/1311392)): channels can't monetize "Content that exclusively features readings of other materials you did not originally create, like text from websites or news feeds." Commentary, original perspective, or creative transformation is what makes reused material eligible.
- **Inauthentic content** (July 2025 update): monetized content must "Be your original creation" and "Not be mass-produced, generic, repetitive, or manipulative." Explicitly allowed: "Content that expresses your unique creative voice, like using AI to visualize a unique character and narrative you invented."
- **Implications:** news segments need the performer's own take (summary plus commentary), not verbatim article reads. For books, stick to public domain or original stories; whether a dramatized reading counts as transformation is a gray area *(unverified)*.
- **Licensing:** if monetization is ever on the table, avoid non-commercial components from the start: XR Animator (CC BY-NC-SA), the InsightFace models LivePortrait uses by default, Krea Realtime 14B, Sonic, Viggle-Animate and MiniMax H3 (region-restricted), and the free tiers of Hedra and Luma. Check research licenses (Qwen-Image-2.1) and each Booth avatar's terms. The stack recommended below is MIT and Apache-2.0 throughout.

## 12. Open decisions

- Confirm the recommended approach (section 13).
- First character and art route: a local AI image tool, the performer's own drawing, or a bought avatar.
- iPhone app: Live Link Face (recommended) or the VTube Studio iOS app as a fallback.
- Input hardware for switching characters: a USB foot pedal, a Stream Deck, or the keyboard to start.
- Where raw recordings live. This repo is public, so voice recordings, face video, and tracking takes stay out of git (a gitignored folder or a separate location).

## 13. Recommendation

**Build our own puppet hub: free, local, native Linux, in stages.**

### Why this path

- It matches the design goal exactly: the camera only drives, any character can be plugged in, a take is recorded once and rendered with anything, and several characters can share a scene.
- Free and local: every piece is free and open source (MIT or Apache-2.0) or a free app, with no per-minute costs.
- Native Linux: it sidesteps the Proton problems (webcam capture, the Unity memory leak, transparency capture), because OBS browser sources render web-based characters with real transparency.
- It avoids talker's failure mode: nothing invents the face. The iPhone measures it.
- It doesn't rule out existing apps. Over VMC, Inochi Session or nijiexpose (native) and VTube Studio (Proton) can become extra renderers later.

### Why not the alternatives as the core

| Option | Verdict |
|---|---|
| Off-the-shelf VTuber app (VTube Studio + iPhone, SnekStudio, XR Animator) | Fastest to a first result, and still useful as a baseline or an extra renderer. But it locks characters to one app's format, has no record-once-render-anything path, and the Windows apps bring Proton quirks |
| Record, then AI-transform (Runway Act-Two, Wan Animate) | Paid per minute, or 3 to 10 GPU hours per 3 minute segment locally; 480p to 720p flat frames; 30 s chunks; no live preview; the AI interprets the performance |
| Real-time AI puppet (LivePortrait, Viggle LIVE, Decart) | Any drawing works without rigging, but cartoon face detection often fails, it has the Ditto-style mouth ceiling, the Blackwell setup is painful, and the cloud options cost money and lag 1 to 2 s. A possible later experiment, not the base |
| Audio-driven (Hedra, InfiniteTalk, LongCat) | The talker approach: it invents the face |

### Stack

| Layer | Choice |
|---|---|
| Face tracking | iPhone 11 Pro with Live Link Face (free, ARKit mode, UDP 11111; can also record CSV+MOV takes on the phone, controlled over OSC). Fallback: the VTube Studio iOS app (JSON with timestamps). Webcam backup: MediaPipe |
| Voice | USB mic through PipeWire, recorded by the hub as WAV |
| Hub | Python with uv: receive, normalize to ARKit-52 frames with PC timestamps, smoothing and neutral calibration, gaze damping, take recording (WAV + JSONL + Live Link Face-style CSV), replay, speaker router, fan-out over WebSocket and VMC |
| Renderers | Web pages loaded as OBS browser sources. Tier 1: sprite set. Tier 2: layered PNG or SVG cutout puppet (Canvas or PixiJS). Tier 3: three.js with three-vrm for 3D. Tier 4: Blender (EEVEE or Cycles) rendering recorded takes offline |
| Lip sync | Tracked jaw plus audio visemes live (wLipSync); Rhubarb or WhisperX alignment for final renders |
| Compositing | OBS 32 with the browser plugin and Aitum Vertical: 16:9 and 9:16 canvases recorded at once |
| Characters | Local AI image editing (Qwen-Image-Edit-2511, FLUX.2 klein; Apache-2.0) for sprite sets; Qwen-Image-Layered to split art into puppet layers; a Booth avatar for the 3D creature |

Rive is left out on purpose: exporting .riv files needs a paid plan ($17 per seat per month). It stays an option if a character ever justifies it.

### Milestones

1. **Hello, puppet** (roughly 1 to 2 days): iPhone to hub to a browser sprite (mouth open and closed, blink, head tilt) in OBS, then a 60 s test recording. Validates tracking through glasses, Wi-Fi latency, and eye behavior while reading.
2. **Takes** (roughly 2 to 3 days): record and replay (WAV plus data), sync calibration, re-render a take with a different character, both canvases.
3. **A real cartoon puppet** (days, plus art time): a layered 2D character with audio visemes, gaze damping, and idle life (breathing, small motions).
4. **The cast** (days): a multi-character scene, the speaker router, a foot pedal, a speaker-tagged script; the speech follower later.
5. **Higher tiers** (weeks, optional): the 3D creature in the browser; Blender "fully rendered" offline renders from takes.

Side experiments, only if curious: LivePortrait as an "AI renderer" fed the same takes, and Runway's free 125 credits to see Act-Two once.

Time estimates are rough, for one developer, and exclude character art, which is the long pole.
