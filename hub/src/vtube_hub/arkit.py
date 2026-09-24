"""The ARKit face vocabulary every part of vtube shares.

The 52 blendshape names are Apple's ARKit names, in the order Live Link Face
sends them. Frames and takes store values positionally in this order, so
web/src/shared/arkit.ts must list the same names in the same order.
"""

BLENDSHAPES: tuple[str, ...] = (
    "eyeBlinkLeft",
    "eyeLookDownLeft",
    "eyeLookInLeft",
    "eyeLookOutLeft",
    "eyeLookUpLeft",
    "eyeSquintLeft",
    "eyeWideLeft",
    "eyeBlinkRight",
    "eyeLookDownRight",
    "eyeLookInRight",
    "eyeLookOutRight",
    "eyeLookUpRight",
    "eyeSquintRight",
    "eyeWideRight",
    "jawForward",
    "jawLeft",
    "jawRight",
    "jawOpen",
    "mouthClose",
    "mouthFunnel",
    "mouthPucker",
    "mouthLeft",
    "mouthRight",
    "mouthSmileLeft",
    "mouthSmileRight",
    "mouthFrownLeft",
    "mouthFrownRight",
    "mouthDimpleLeft",
    "mouthDimpleRight",
    "mouthStretchLeft",
    "mouthStretchRight",
    "mouthRollLower",
    "mouthRollUpper",
    "mouthShrugLower",
    "mouthShrugUpper",
    "mouthPressLeft",
    "mouthPressRight",
    "mouthLowerDownLeft",
    "mouthLowerDownRight",
    "mouthUpperUpLeft",
    "mouthUpperUpRight",
    "browDownLeft",
    "browDownRight",
    "browInnerUp",
    "browOuterUpLeft",
    "browOuterUpRight",
    "cheekPuff",
    "cheekSquintLeft",
    "cheekSquintRight",
    "noseSneerLeft",
    "noseSneerRight",
    "tongueOut",
)

INDEX: dict[str, int] = {name: i for i, name in enumerate(BLENDSHAPES)}

# Live Link Face appends these nine rotations (radians) after the blendshapes.
ROTATIONS: tuple[str, ...] = (
    "headYaw",
    "headPitch",
    "headRoll",
    "leftEyeYaw",
    "leftEyePitch",
    "leftEyeRoll",
    "rightEyeYaw",
    "rightEyePitch",
    "rightEyeRoll",
)

assert len(BLENDSHAPES) == 52
