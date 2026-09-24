"""The one frame format every face source is normalized into.

Shared conventions, whatever the source (docs/architecture.md):
- Blendshape "Left" means the performer's own left, as in ARKit.
- Head yaw > 0: the performer turns toward their own left.
- Head pitch > 0: the performer looks up.
- Head roll > 0: the performer tilts toward their left shoulder.

A source that disagrees gets an Orientation fix, set by the Studio's
"Check directions" step and applied by the hub before anything else sees
the frame.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from .arkit import BLENDSHAPES, INDEX

Vec3 = tuple[float, float, float]
ZERO3: Vec3 = (0.0, 0.0, 0.0)

MIRROR_PAIRS: tuple[tuple[int, int], ...] = tuple(
    (i, INDEX[name[:-4] + "Right"]) for i, name in enumerate(BLENDSHAPES) if name.endswith("Left")
)


@dataclass(slots=True)
class Frame:
    """One face sample from any source, before calibration or smoothing."""

    t: float  # hub clock (time.monotonic) when the sample arrived
    source: str  # "livelink", "simulator", ...
    seq: int  # the source's frame counter, for spotting drops
    face: bool  # False when the source reports it lost the face
    bs: list[float]  # 52 values in arkit.BLENDSHAPES order, 0..1
    head: Vec3 = ZERO3  # yaw, pitch, roll in radians, as the source reports them
    eye_left: Vec3 = ZERO3
    eye_right: Vec3 = ZERO3

    def to_json(self, t_origin: float = 0.0) -> dict:
        """The wire and take-file form. `t` becomes seconds since `t_origin`."""
        return {
            "t": round(self.t - t_origin, 4),
            "src": self.source,
            "seq": self.seq,
            "face": self.face,
            "bs": [round(v, 4) for v in self.bs],
            "head": [round(v, 4) for v in self.head],
            "eyeL": [round(v, 4) for v in self.eye_left],
            "eyeR": [round(v, 4) for v in self.eye_right],
        }


def rest_blendshapes() -> list[float]:
    return [0.0] * len(BLENDSHAPES)


@dataclass(frozen=True, slots=True)
class Orientation:
    """How to bring one source to the shared conventions."""

    swap_lr: bool = False
    yaw: int = 1
    pitch: int = 1
    roll: int = 1

    @classmethod
    def from_json(cls, data: object) -> Orientation:
        if not isinstance(data, dict):
            raise ValueError("orientation must be an object")
        swap = data.get("swapLR", False)
        if not isinstance(swap, bool):
            raise ValueError("swapLR must be true or false")
        signs = []
        for key in ("yaw", "pitch", "roll"):
            value = data.get(key, 1)
            if isinstance(value, bool) or value not in (1, -1):
                raise ValueError(f"{key} must be 1 or -1")
            signs.append(value)
        return cls(swap, *signs)

    def to_json(self) -> dict:
        return {"swapLR": self.swap_lr, "yaw": self.yaw, "pitch": self.pitch, "roll": self.roll}


IDENTITY = Orientation()


def _signed(v: Vec3, fix: Orientation) -> Vec3:
    return (v[0] * fix.yaw, v[1] * fix.pitch, v[2] * fix.roll)


def orient(frame: Frame, fix: Orientation) -> Frame:
    if fix == IDENTITY:
        return frame
    bs = list(frame.bs)
    eye_left, eye_right = frame.eye_left, frame.eye_right
    if fix.swap_lr:
        for left, right in MIRROR_PAIRS:
            bs[left], bs[right] = bs[right], bs[left]
        eye_left, eye_right = eye_right, eye_left
    return replace(
        frame,
        bs=bs,
        head=_signed(frame.head, fix),
        eye_left=_signed(eye_left, fix),
        eye_right=_signed(eye_right, fix),
    )
