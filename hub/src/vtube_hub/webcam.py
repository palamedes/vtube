"""Webcam face tracking with Google's MediaPipe Face Landmarker.

The hub owns the camera, so tracking keeps running whether or not the Studio
is on screen. Each camera frame goes through the Face Landmarker, which
returns the same 52 ARKit-named blendshapes the iPhone sends (it has no
tongueOut; that channel stays 0) plus a 4x4 face transform, from which the
head rotation comes.

Checked on Google's sample portrait: fed the camera's un-mirrored image,
MediaPipe's "Left" is the performer's own left, as in ARKit, so frames need
no fixing to meet the shared conventions in frames.py. Inference runs on the
CPU (about 8 ms a frame on a Ryzen 9 3950X); MediaPipe's GPU path isn't
available from Python on Linux.
"""

from __future__ import annotations

import asyncio
import glob
import logging
import math
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .arkit import INDEX
from .frames import Frame, Vec3, rest_blendshapes

log = logging.getLogger(__name__)

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
)
MODEL_NAME = "face_landmarker.task"
PREVIEW_WIDTH = 640
PREVIEW_INTERVAL = 1 / 15
METRICS_EVERY = 4  # frames
# Camera controls the Studio may read and change (a safe subset of UVC's).
CONTROLS = ("zoom_absolute", "pan_absolute", "tilt_absolute", "exposure_dynamic_framerate", "brightness")
# Outer eye corners in MediaPipe's 478-point face mesh.
RIGHT_EYE_OUTER, LEFT_EYE_OUTER = 33, 263


@dataclass(frozen=True, slots=True)
class CameraSettings:
    device: str | None = None  # /dev/videoN, or a video file (for testing and re-tracking)
    width: int = 1280
    height: int = 720
    fps: int = 60


def head_angles(matrix: Sequence[Sequence[float]]) -> Vec3:
    """Yaw, pitch, roll (radians) from MediaPipe's face transform.

    The transform's columns are the face's right, up, and forward axes in
    camera space (x right, y up, z toward the viewer). Yaw and pitch come
    from where the forward axis points: toward the image's right (the
    performer's left) is positive yaw, upward is positive pitch. Roll is what
    remains after those two (an intrinsic yaw-pitch-roll decomposition), so
    turning and tilting at once don't bleed into each other.
    """
    m = np.asarray(matrix, dtype=float)
    forward = m[:3, 2]
    yaw = math.atan2(forward[0], forward[2])
    pitch = math.atan2(forward[1], math.hypot(forward[0], forward[2]))
    roll = math.atan2(-m[1, 0], m[1, 1])
    return (yaw, pitch, roll)


def blendshapes_from(categories) -> list[float]:
    """MediaPipe's categories (named, in its own order) to our 52-value list."""
    bs = rest_blendshapes()
    for category in categories:
        index = INDEX.get(category.category_name)
        if index is not None:
            bs[index] = min(1.0, max(0.0, float(category.score)))
    return bs


def framing(landmarks, gray: np.ndarray | None = None) -> dict:
    """Where the face sits in the image, for the Studio's framing guides. Coordinates are 0..1."""
    xs = np.fromiter((p.x for p in landmarks), dtype=float)
    ys = np.fromiter((p.y for p in landmarks), dtype=float)
    x0, x1 = float(np.clip(xs.min(), 0, 1)), float(np.clip(xs.max(), 0, 1))
    y0, y1 = float(np.clip(ys.min(), 0, 1)), float(np.clip(ys.max(), 0, 1))
    right_eye, left_eye = landmarks[RIGHT_EYE_OUTER], landmarks[LEFT_EYE_OUTER]
    result = {
        "box": [round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)],
        "faceHeight": round(y1 - y0, 4),
        "centerX": round((x0 + x1) / 2, 4),
        "centerY": round((y0 + y1) / 2, 4),
        "eyeY": round((right_eye.y + left_eye.y) / 2, 4),
        "brightness": None,
    }
    if gray is not None:
        h, w = gray.shape
        patch = gray[int(y0 * h) : max(int(y0 * h) + 1, int(y1 * h)), int(x0 * w) : max(int(x0 * w) + 1, int(x1 * w))]
        result["brightness"] = round(float(patch.mean()), 1) if patch.size else None
    return result


def ensure_model(models_dir: Path) -> Path:
    """The Face Landmarker model (about 3.7 MB), downloaded from Google on first use."""
    path = models_dir / MODEL_NAME
    if path.is_file() and path.stat().st_size > 1_000_000:
        return path
    models_dir.mkdir(parents=True, exist_ok=True)
    log.info("downloading the face model from %s", MODEL_URL)
    tmp = path.with_suffix(".part")
    with urllib.request.urlopen(MODEL_URL, timeout=30) as response, open(tmp, "wb") as out:
        shutil.copyfileobj(response, out)
    if tmp.stat().st_size < 1_000_000:
        tmp.unlink()
        raise OSError("the downloaded model is too small; try again")
    os.replace(tmp, path)
    return path


def _v4l2(*args: str) -> subprocess.CompletedProcess:
    exe = shutil.which("v4l2-ctl")
    if exe is None:
        raise OSError("v4l2-ctl not found (install v4l-utils)")
    return subprocess.run([exe, *args], capture_output=True, text=True, timeout=5)


def list_cameras() -> list[dict]:
    """Video capture devices, skipping metadata nodes and infrared-only cameras."""
    cameras = []
    nodes = glob.glob("/sys/class/video4linux/video*")
    for node in sorted(nodes, key=lambda p: int(re.sub(r"\D", "", os.path.basename(p)) or 0)):
        device = "/dev/" + os.path.basename(node)
        try:
            name = Path(node, "name").read_text().strip()
            formats = set(re.findall(r"'(\w+)'", _v4l2("-d", device, "--list-formats").stdout))
        except (OSError, subprocess.SubprocessError):
            continue
        if formats & {"MJPG", "YUYV", "NV12"}:
            cameras.append({"device": device, "name": name, "formats": sorted(formats)})
    return cameras


_CONTROL_LINE = re.compile(r"^\s*(\w+)\s+0x[0-9a-f]+\s+\((\w+)\)\s*:\s*(.*)$")


def parse_controls(text: str) -> dict:
    controls = {}
    for line in text.splitlines():
        match = _CONTROL_LINE.match(line)
        if not match or match.group(1) not in CONTROLS:
            continue
        name, kind, rest = match.groups()
        fields = {key: int(value) for key, value in re.findall(r"(\w+)=(-?\d+)", rest)}
        controls[name] = {
            "type": kind,
            "min": fields.get("min", 0),
            "max": fields.get("max", 1),
            "step": fields.get("step", 1),
            "default": fields.get("default", 0),
            "value": fields.get("value", 0),
            "inactive": "inactive" in rest,
        }
    return controls


def read_controls(device: str) -> dict:
    return parse_controls(_v4l2("-d", device, "--list-ctrls").stdout)


def write_control(device: str, name: str, value: int) -> None:
    if name not in CONTROLS:
        raise ValueError(f"{name} isn't a control the Studio can change")
    if isinstance(value, bool):
        value = int(value)
    if not isinstance(value, int):
        raise ValueError(f"{name} needs a whole number")
    result = _v4l2("-d", device, "-c", f"{name}={value}")
    if result.returncode != 0:
        raise ValueError(result.stderr.strip() or f"couldn't set {name}")


class WebcamTracker:
    """Runs capture and face tracking on a thread; hands frames to the hub's event loop."""

    def __init__(
        self,
        on_frame: Callable[[Frame], None],
        on_metrics: Callable[[dict], None],
        models_dir: Path,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._on_frame = on_frame
        self._on_metrics = on_metrics
        self._models_dir = models_dir
        self._clock = clock
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._preview: tuple[int, bytes | None] = (0, None)
        self._preview_until = 0.0
        self.settings: CameraSettings | None = None
        self.device: str | None = None
        self.state = "off"  # off, starting, running, error
        self.error: str | None = None
        self.actual: dict | None = None  # width, height, fps the camera agreed to
        self.fps = 0.0
        self.inference_ms = 0.0
        self.face = False

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def status(self) -> dict:
        return {
            "state": self.state,
            "running": self.running,
            "device": self.device,
            "error": self.error,
            "actual": self.actual,
            "fps": round(self.fps, 1),
            "inferenceMs": round(self.inference_ms, 1),
            "faceDetected": self.face and self.running,
        }

    async def start(self, settings: CameraSettings) -> None:
        if self.running and settings == self.settings:
            return
        await self.stop()
        self._loop = asyncio.get_running_loop()
        self.settings = settings
        self.state, self.error = "starting", None
        try:
            model = await asyncio.to_thread(ensure_model, self._models_dir)
            device = settings.device or await asyncio.to_thread(_first_camera)
        except Exception as exc:
            self.state, self.error = "error", f"camera setup failed: {exc}"
            log.warning(self.error)
            return
        if device is None:
            self.state, self.error = "error", "no camera found"
            return
        self.device = device
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, args=(settings, device, model), name="webcam", daemon=True)
        self._thread.start()

    async def stop(self) -> None:
        thread, self._thread = self._thread, None
        if thread is not None:
            self._stop.set()
            await asyncio.to_thread(thread.join, 3.0)
        self.state = "off" if self.state != "error" else self.state
        self.face = False

    def want_preview(self) -> None:
        self._preview_until = self._clock() + 2.0

    def preview(self) -> tuple[int, bytes | None]:
        with self._lock:
            return self._preview

    def _emit(self, callback: Callable, value: object) -> None:
        loop = self._loop
        if loop is not None and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(callback, value)
            except RuntimeError:
                pass  # the loop is shutting down

    def _run(self, settings: CameraSettings, device: str, model: Path) -> None:
        try:
            self._track(settings, device, model)
        except Exception as exc:  # the Studio shows it; the hub keeps running
            self.state, self.error = "error", f"camera stopped: {exc}"
            log.exception("webcam tracking failed")
        finally:
            self.face = False
            if self.state != "error":
                self.state = "off"

    def _track(self, settings: CameraSettings, device: str, model: Path) -> None:
        import cv2  # imported here: MediaPipe and OpenCV take a second to load

        is_file = not device.startswith("/dev/")
        capture = cv2.VideoCapture(device, cv2.CAP_ANY if is_file else cv2.CAP_V4L2)
        try:
            if not capture.isOpened():
                self.state, self.error = "error", f"can't open {device}; is another app using the camera?"
                return
            self._track_capture(capture, settings, device, model, is_file)
        finally:
            capture.release()

    def _track_capture(self, capture, settings: CameraSettings, device: str, model: Path, is_file: bool) -> None:
        import cv2
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        if not is_file:
            capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter.fourcc(*"MJPG"))
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, settings.width)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, settings.height)
            capture.set(cv2.CAP_PROP_FPS, settings.fps)
            capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # always track the newest frame
        self.actual = {
            "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps": round(capture.get(cv2.CAP_PROP_FPS), 1),
        }
        file_period = 1.0 / (capture.get(cv2.CAP_PROP_FPS) or 30.0) if is_file else 0.0
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model)),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
        )
        arrivals: deque[float] = deque(maxlen=90)
        timings: deque[float] = deque(maxlen=60)
        last_ms = -1
        seq = 0
        last_preview = 0.0
        next_file_frame = self._clock()
        with vision.FaceLandmarker.create_from_options(options) as landmarker:
            self.state = "running"
            log.info("webcam tracking on %s at %s", device, self.actual)
            while not self._stop.is_set():
                ok, bgr = capture.read()
                now = self._clock()
                if not ok:
                    if is_file:
                        capture.set(cv2.CAP_PROP_POS_FRAMES, 0)  # loop test videos
                        continue
                    self.state, self.error = "error", "the camera stopped sending frames (unplugged?)"
                    return
                arrivals.append(now)
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                stamp = max(last_ms + 1, int(now * 1000))  # MediaPipe needs increasing timestamps
                last_ms = stamp
                started = time.perf_counter()
                result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), stamp)
                timings.append((time.perf_counter() - started) * 1000)
                seq += 1
                self.face = bool(result.face_landmarks)
                if self.face:
                    frame = Frame(
                        t=now,
                        source="webcam",
                        seq=seq,
                        face=True,
                        bs=blendshapes_from(result.face_blendshapes[0]),
                        head=head_angles(result.facial_transformation_matrixes[0]),
                    )
                else:
                    frame = Frame(t=now, source="webcam", seq=seq, face=False, bs=rest_blendshapes())
                self._emit(self._on_frame, frame)

                if seq % METRICS_EVERY == 0:
                    if len(arrivals) > 1:
                        self.fps = (len(arrivals) - 1) / max(1e-6, arrivals[-1] - arrivals[0])
                    self.inference_ms = sum(timings) / len(timings)
                    metrics = {"face": self.face, "fps": round(self.fps, 1), "inferenceMs": round(self.inference_ms, 1)}
                    if self.face:
                        small = cv2.resize(bgr, (160, max(1, 160 * bgr.shape[0] // bgr.shape[1])))
                        metrics.update(framing(result.face_landmarks[0], cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)))
                    self._emit(self._on_metrics, metrics)

                if now < self._preview_until and now - last_preview >= PREVIEW_INTERVAL:
                    last_preview = now
                    height = PREVIEW_WIDTH * bgr.shape[0] // bgr.shape[1]
                    ok, jpeg = cv2.imencode(".jpg", cv2.resize(bgr, (PREVIEW_WIDTH, height)), [cv2.IMWRITE_JPEG_QUALITY, 72])
                    if ok:
                        with self._lock:
                            self._preview = (self._preview[0] + 1, jpeg.tobytes())

                if is_file:
                    next_file_frame += file_period
                    time.sleep(max(0.0, next_file_frame - self._clock()))


def _first_camera() -> str | None:
    cameras = list_cameras()
    return cameras[0]["device"] if cameras else None
