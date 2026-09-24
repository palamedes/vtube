"""Exports: finished MP4s, one per format, kept next to the takes (outside the repo).

The Studio renders a take's video frame by frame in the browser and uploads
it; ffmpeg then adds the take's original voice recording as AAC (Instagram
and TikTok want AAC) and moves the index to the front so players can start
right away. If the browser encoded something other than H.264, the video is
re-encoded to H.264, which every platform accepts.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path

VIEW_SUFFIX = {"wide": "16x9", "tall": "9x16"}
_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$")


class ExportError(Exception):
    """ffmpeg is missing or failed."""


def slug(name: str) -> str:
    text = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()
    return text[:60].rstrip("-") or "take"


async def _run(*cmd: str) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


async def video_codec(path: Path) -> str:
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        raise ExportError("ffprobe not found; install ffmpeg to export")
    code, out, err = await _run(
        ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(path)
    )
    if code != 0 or not out.strip():
        raise ExportError(f"the uploaded video isn't readable: {err.strip()[-200:]}")
    return out.strip()


class ExportStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _entry(self, path: Path) -> dict:
        stat = path.stat()
        take = path.parent.name
        return {
            "take": take,
            "file": path.name,
            "url": f"/api/exports/{take}/{path.name}",
            "size": stat.st_size,
            "path": str(path),
            "modified": int(stat.st_mtime),
        }

    def list(self, take_id: str | None = None) -> list[dict]:
        if not self.root.is_dir():
            return []
        folders = [self.root / take_id] if take_id else [p for p in self.root.iterdir() if p.is_dir()]
        files = [self._entry(f) for folder in folders if folder.is_dir() for f in folder.glob("*.mp4")]
        return sorted(files, key=lambda f: f["modified"], reverse=True)

    def file(self, take_id: str, name: str) -> Path:
        if not _FILE.match(name):
            raise KeyError(name)
        path = self.root / take_id / name
        if not path.is_file():
            raise KeyError(name)
        return path

    async def finish(self, take_id: str, take_dir: Path, meta: dict, view: str, video: Path) -> dict:
        """Mux the uploaded video with the take's voice into <exports>/<take>/<name>-<format>.mp4."""
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None:
            raise ExportError("ffmpeg not found; install it to export")
        codec = await video_codec(video)
        folder = self.root / take_id
        folder.mkdir(parents=True, exist_ok=True)
        out = folder / f"{slug(meta.get('name') or take_id)}-{VIEW_SUFFIX[view]}.mp4"
        partial = out.with_name(out.stem + ".part.mp4")
        audio = take_dir / "audio.wav" if meta.get("audio") else None
        cmd = [ffmpeg, "-y", "-v", "error", "-i", str(video)]
        if audio is not None and audio.is_file():
            cmd += ["-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "192k"]
        else:
            cmd += ["-map", "0:v:0"]
        if codec == "h264":
            cmd += ["-c:v", "copy"]
        else:
            cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"]
        cmd += ["-movflags", "+faststart", str(partial)]
        code, _, err = await _run(*cmd)
        if code != 0:
            partial.unlink(missing_ok=True)
            raise ExportError(f"ffmpeg failed: {err.strip()[-300:]}")
        os.replace(partial, out)
        return self._entry(out)
