/**
 * The 52 ARKit blendshape names, in the order frames and takes store them.
 * Must match hub/src/vtube_hub/arkit.py.
 */
export const BLENDSHAPES = [
  'eyeBlinkLeft',
  'eyeLookDownLeft',
  'eyeLookInLeft',
  'eyeLookOutLeft',
  'eyeLookUpLeft',
  'eyeSquintLeft',
  'eyeWideLeft',
  'eyeBlinkRight',
  'eyeLookDownRight',
  'eyeLookInRight',
  'eyeLookOutRight',
  'eyeLookUpRight',
  'eyeSquintRight',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawRight',
  'jawOpen',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
] as const;

export type Blendshape = (typeof BLENDSHAPES)[number];

export const BS = Object.fromEntries(BLENDSHAPES.map((name, i) => [name, i])) as Record<Blendshape, number>;

/** Index pairs of left/right blendshapes, for mirroring. */
export const MIRROR_PAIRS: [number, number][] = BLENDSHAPES.flatMap((name, i): [number, number][] =>
  name.endsWith('Left') ? [[i, BS[`${name.slice(0, -4)}Right` as Blendshape]]] : [],
);

export interface BlendshapeGroup {
  id: string;
  label: string;
  names: Blendshape[];
}

/** How the Studio groups the channels for display. */
export const GROUPS: BlendshapeGroup[] = [
  { id: 'eyes', label: 'Eyes', names: BLENDSHAPES.filter((n) => n.startsWith('eye')) },
  { id: 'brows', label: 'Brows', names: BLENDSHAPES.filter((n) => n.startsWith('brow')) },
  { id: 'jaw', label: 'Jaw', names: ['jawOpen', 'jawForward', 'jawLeft', 'jawRight'] },
  { id: 'mouth', label: 'Mouth', names: BLENDSHAPES.filter((n) => n.startsWith('mouth')) },
  {
    id: 'other',
    label: 'Cheeks, nose, tongue',
    names: BLENDSHAPES.filter((n) => n.startsWith('cheek') || n.startsWith('nose') || n === 'tongueOut'),
  },
];
