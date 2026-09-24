import math
from types import SimpleNamespace

import numpy as np
import pytest

from vtube_hub.arkit import INDEX
from vtube_hub.frames import Frame, Orientation, orient, rest_blendshapes
from vtube_hub.webcam import blendshapes_from, framing, head_angles, parse_controls


def rotation(yaw: float = 0.0, pitch: float = 0.0, roll: float = 0.0) -> np.ndarray:
    """A face transform in MediaPipe's camera space (x right, y up, z toward the viewer).

    yaw > 0 turns the face toward the image's right (the performer's left),
    pitch > 0 tips it up, roll > 0 tilts the top of the head toward the image's right.
    """
    turn = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    tip = np.array([[1, 0, 0], [0, math.cos(pitch), math.sin(pitch)], [0, -math.sin(pitch), math.cos(pitch)]])
    tilt = np.array([[math.cos(roll), math.sin(roll), 0], [-math.sin(roll), math.cos(roll), 0], [0, 0, 1]])
    m = np.eye(4)
    m[:3, :3] = turn @ tip @ tilt
    return m


@pytest.mark.parametrize(
    ("yaw", "pitch", "roll"),
    [(0.3, 0, 0), (-0.25, 0, 0), (0, 0.2, 0), (0, -0.15, 0), (0, 0, 0.1), (0, 0, -0.2), (0.2, 0.1, 0.05)],
)
def test_head_angles_follow_the_shared_conventions(yaw, pitch, roll):
    got = head_angles(rotation(yaw, pitch, roll))
    assert got == pytest.approx((yaw, pitch, roll), abs=0.02)


def test_head_angles_for_a_face_turned_to_the_image_right():
    # The face's forward axis points toward +x: the performer turned to their own left.
    yaw, pitch, roll = head_angles(rotation(yaw=0.5))
    assert yaw > 0.4 and abs(pitch) < 1e-9 and abs(roll) < 1e-9


def test_blendshapes_map_by_name_and_skip_extras():
    categories = [
        SimpleNamespace(category_name="_neutral", score=0.9),
        SimpleNamespace(category_name="jawOpen", score=0.42),
        SimpleNamespace(category_name="eyeBlinkLeft", score=1.2),
    ]
    bs = blendshapes_from(categories)
    assert len(bs) == 52
    assert bs[INDEX["jawOpen"]] == 0.42
    assert bs[INDEX["eyeBlinkLeft"]] == 1.0
    assert bs[INDEX["tongueOut"]] == 0.0


def test_framing_reports_the_face_box_and_brightness():
    points = [SimpleNamespace(x=x, y=y) for x, y in [(0.4, 0.2), (0.6, 0.2), (0.4, 0.6), (0.6, 0.6)]]
    points += [SimpleNamespace(x=0.5, y=0.4)] * 300  # pad to the mesh size
    points[33] = SimpleNamespace(x=0.45, y=0.35)
    points[263] = SimpleNamespace(x=0.55, y=0.37)
    gray = np.full((90, 160), 128, np.uint8)
    result = framing(points, gray)
    assert result["box"] == [0.4, 0.2, 0.6, 0.6]
    assert result["faceHeight"] == pytest.approx(0.4)
    assert result["centerX"] == pytest.approx(0.5)
    assert result["eyeY"] == pytest.approx(0.36)
    assert result["brightness"] == 128.0


def test_parse_controls_keeps_the_safe_subset():
    text = """
                     brightness 0x00980900 (int)    : min=0 max=255 step=1 default=128 value=140 flags=has-min-max
           power_line_frequency 0x00980918 (menu)   : min=0 max=2 default=2 value=2 (60 Hz)
     exposure_dynamic_framerate 0x009a0903 (bool)   : default=0 value=1
                  zoom_absolute 0x009a090d (int)    : min=100 max=500 step=1 default=100 value=150 flags=has-min-max
                   pan_absolute 0x009a0908 (int)    : min=-36000 max=36000 step=3600 default=0 value=3600 flags=inactive
    """
    controls = parse_controls(text)
    assert set(controls) == {"brightness", "exposure_dynamic_framerate", "zoom_absolute", "pan_absolute"}
    assert controls["zoom_absolute"] == {
        "type": "int", "min": 100, "max": 500, "step": 1, "default": 100, "value": 150, "inactive": False,
    }
    assert controls["exposure_dynamic_framerate"]["value"] == 1
    assert controls["pan_absolute"]["inactive"] is True


def test_orientation_swaps_sides_and_flips_angles():
    bs = rest_blendshapes()
    bs[INDEX["eyeBlinkLeft"]] = 0.8
    bs[INDEX["mouthSmileRight"]] = 0.5
    frame = Frame(t=0.0, source="x", seq=1, face=True, bs=bs, head=(0.1, 0.2, 0.3), eye_left=(1.0, 0, 0))
    fixed = orient(frame, Orientation.from_json({"swapLR": True, "yaw": -1, "roll": -1}))
    assert fixed.bs[INDEX["eyeBlinkRight"]] == 0.8 and fixed.bs[INDEX["eyeBlinkLeft"]] == 0.0
    assert fixed.bs[INDEX["mouthSmileLeft"]] == 0.5
    assert fixed.head == (-0.1, 0.2, -0.3)
    assert fixed.eye_right == (-1.0, 0, 0)
    assert orient(frame, Orientation()) is frame


@pytest.mark.parametrize("bad", [[], {"swapLR": "yes"}, {"yaw": 0}, {"pitch": True}])
def test_orientation_rejects_nonsense(bad):
    with pytest.raises(ValueError):
        Orientation.from_json(bad)
