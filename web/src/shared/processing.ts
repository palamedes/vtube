import { BLENDSHAPES, BS, MIRROR_PAIRS } from './arkit';
import { OneEuroFilter } from './oneEuro';
import type { RawFrame } from './protocol';
import { DEFAULT_SETTINGS, type StudioSettings } from './settings';

/**
 * The face a character draws: tuned, smoothed values in character space.
 * Head angles are radians; yaw > 0 turns toward screen right, pitch > 0 looks
 * up, roll > 0 tilts clockwise. Gaze runs -1..1 in screen terms (x right, y up).
 * Blendshape "Left" means the character's own left, which is screen right.
 */
export interface FaceState {
  t: number;
  present: boolean;
  bs: Float32Array;
  head: { yaw: number; pitch: number; roll: number };
  gaze: { x: number; y: number };
  /** How far the body has turned and leaned (radians): it follows lasting head turns, slowly (see FaceDriver). */
  body: { yaw: number; roll: number };
}

const N = BLENDSHAPES.length;

export function createFaceState(): FaceState {
  return {
    t: 0,
    present: false,
    bs: new Float32Array(N),
    head: { yaw: 0, pitch: 0, roll: 0 },
    gaze: { x: 0, y: 0 },
    body: { yaw: 0, roll: 0 },
  };
}

export function copyFaceState(from: FaceState, to: FaceState): void {
  to.t = from.t;
  to.present = from.present;
  to.bs.set(from.bs);
  Object.assign(to.head, from.head);
  Object.assign(to.gaze, from.gaze);
  Object.assign(to.body, from.body);
}

/** out = a + (b - a) * k */
export function lerpFaceState(a: FaceState, b: FaceState, k: number, out: FaceState): void {
  for (let i = 0; i < N; i++) out.bs[i] = a.bs[i] + (b.bs[i] - a.bs[i]) * k;
  out.head.yaw = a.head.yaw + (b.head.yaw - a.head.yaw) * k;
  out.head.pitch = a.head.pitch + (b.head.pitch - a.head.pitch) * k;
  out.head.roll = a.head.roll + (b.head.roll - a.head.roll) * k;
  out.gaze.x = a.gaze.x + (b.gaze.x - a.gaze.x) * k;
  out.gaze.y = a.gaze.y + (b.gaze.y - a.gaze.y) * k;
  out.body.yaw = a.body.yaw + (b.body.yaw - a.body.yaw) * k;
  out.body.roll = a.body.roll + (b.body.roll - a.body.roll) * k;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const clamp01 = (x: number) => clamp(x, 0, 1);

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const k = clamp01((x - edge0) / (edge1 - edge0));
  return k * k * (3 - 2 * k);
}

/** Smoothing slider (0..1) to a One Euro resting cutoff: 12 Hz (barely filtered) down to 0.4 Hz. */
export function cutoffFor(smoothing: number): number {
  return 12 * Math.pow(0.4 / 12, clamp01(smoothing));
}

type Group = 'blink' | 'eyes' | 'brows' | 'mouth';
type Kind = 'blink' | 'look' | 'eye' | 'brow' | 'jaw' | 'smile' | 'mouth' | 'other';

const GROUP_OF: Group[] = BLENDSHAPES.map((name) =>
  name.startsWith('eyeBlink') ? 'blink' : name.startsWith('eye') ? 'eyes' : name.startsWith('brow') ? 'brows' : 'mouth',
);

const KIND_OF: Kind[] = BLENDSHAPES.map((name) => {
  if (name.startsWith('eyeBlink')) return 'blink';
  if (name.startsWith('eyeLook')) return 'look';
  if (name.startsWith('eye')) return 'eye';
  if (name.startsWith('brow')) return 'brow';
  if (name === 'jawOpen') return 'jaw';
  if (name.startsWith('mouthSmile')) return 'smile';
  if (name.startsWith('mouth')) return 'mouth';
  return 'other';
});

const BLENDSHAPE_BETA = 1.0;
const HEAD_BETA = 1.5;

/** Raw frames in, FaceState out. One instance per stream: the filters remember history. */
export class FacePipeline {
  readonly state = createFaceState();
  private settings: StudioSettings = DEFAULT_SETTINGS;
  private readonly filters = BLENDSHAPES.map(() => new OneEuroFilter());
  private readonly headFilters = [new OneEuroFilter(), new OneEuroFilter(), new OneEuroFilter()];
  private readonly values = new Float32Array(N);
  private lastT: number | null = null;

  constructor(settings: StudioSettings = DEFAULT_SETTINGS) {
    this.setSettings(settings);
  }

  setSettings(settings: StudioSettings): void {
    this.settings = settings;
    const cutoff: Record<Group, number> = {
      blink: cutoffFor(settings.eyes.blinkSmoothing),
      eyes: cutoffFor(settings.eyes.smoothing),
      brows: cutoffFor(settings.brows.smoothing),
      mouth: cutoffFor(settings.mouth.smoothing),
    };
    this.filters.forEach((filter, i) => filter.configure(cutoff[GROUP_OF[i]], BLENDSHAPE_BETA));
    const headCutoff = cutoffFor(settings.head.smoothing);
    this.headFilters.forEach((filter) => filter.configure(headCutoff, HEAD_BETA));
  }

  reset(): void {
    this.filters.forEach((filter) => filter.reset());
    this.headFilters.forEach((filter) => filter.reset());
    this.lastT = null;
  }

  process(frame: RawFrame): FaceState {
    const s = this.settings;
    if (this.lastT !== null && (frame.t < this.lastT || frame.t - this.lastT > 0.5)) this.reset();
    this.lastT = frame.t;

    // 1. Subtract the neutral pose so a relaxed face reads as zero.
    const v = this.values;
    const neutral = frame.face ? s.neutral : null;
    for (let i = 0; i < N; i++) {
      let x = frame.face ? (frame.bs[i] ?? 0) : 0;
      if (neutral) {
        const rest = neutral.bs[i];
        x = rest >= 0.98 ? 0 : (x - rest) / (1 - rest);
      }
      v[i] = x;
    }

    // 2. Mirror: the performer's left drives the character's right.
    if (s.mirror) {
      for (const [l, r] of MIRROR_PAIRS) {
        const tmp = v[l];
        v[l] = v[r];
        v[r] = tmp;
      }
    }

    // 3. Gains, blink shaping, gaze damping.
    for (let i = 0; i < N; i++) {
      let x = v[i];
      switch (KIND_OF[i]) {
        case 'blink':
          x = smoothstep(s.eyes.blinkLow, s.eyes.blinkHigh, x);
          break;
        case 'look':
          x *= s.eyes.gazeStrength;
          break;
        case 'brow':
          x *= s.brows.gain;
          break;
        case 'jaw':
          x *= s.mouth.jawGain;
          break;
        case 'smile':
          x *= s.mouth.smileGain;
          break;
        case 'mouth':
          x *= s.mouth.shapeGain;
          break;
      }
      v[i] = clamp01(x);
    }
    if (s.eyes.linkBlinks) {
      const both = Math.max(v[BS.eyeBlinkLeft], v[BS.eyeBlinkRight]);
      v[BS.eyeBlinkLeft] = both;
      v[BS.eyeBlinkRight] = both;
    }

    // 4. Smooth.
    const out = this.state;
    out.t = frame.t;
    out.present = frame.face;
    for (let i = 0; i < N; i++) out.bs[i] = clamp01(this.filters[i].filter(v[i], frame.t));

    // Head: neutral, gain, mirror, limit, smooth. (Each source's direction
    // quirks were already fixed by the hub; see Orientation in protocol.ts.)
    const limit = (s.head.maxDegrees * Math.PI) / 180;
    const rest = neutral?.head ?? [0, 0, 0];
    let yaw = frame.face ? (frame.head[0] - rest[0]) * s.head.yawGain : 0;
    const pitch = frame.face ? (frame.head[1] - rest[1]) * s.head.pitchGain : 0;
    let roll = frame.face ? (frame.head[2] - rest[2]) * s.head.rollGain : 0;
    if (s.mirror) {
      yaw = -yaw;
      roll = -roll;
    }
    out.head.yaw = this.headFilters[0].filter(clamp(yaw, -limit, limit), frame.t);
    out.head.pitch = this.headFilters[1].filter(clamp(pitch, -limit, limit), frame.t);
    out.head.roll = this.headFilters[2].filter(clamp(roll, -limit, limit), frame.t);

    // Gaze, from the (already damped and smoothed) eye look shapes. Looking
    // toward the character's left means looking toward screen right.
    const b = out.bs;
    out.gaze.x = clamp(
      (b[BS.eyeLookOutLeft] - b[BS.eyeLookInLeft] + (b[BS.eyeLookInRight] - b[BS.eyeLookOutRight])) / 2,
      -1,
      1,
    );
    out.gaze.y = clamp(
      (b[BS.eyeLookUpLeft] - b[BS.eyeLookDownLeft] + (b[BS.eyeLookUpRight] - b[BS.eyeLookDownRight])) / 2,
      -1,
      1,
    );
    return out;
  }
}
