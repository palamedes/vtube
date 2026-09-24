import { BS } from '../shared/arkit';
import type { Orientation, RawFrame } from '../shared/protocol';

/**
 * "Check directions": a short guided routine that finds out whether a source
 * reports turns, tilts, nods, and left/right the way the shared conventions
 * expect (see hub/src/vtube_hub/frames.py), and flips whatever doesn't.
 * The phone and the camera then drive the character identically.
 */

export type StepId = 'center' | 'turn' | 'tilt' | 'up' | 'eyes';

export const STEPS: { id: StepId; prompt: string }[] = [
  { id: 'center', prompt: 'Look straight ahead, relaxed.' },
  { id: 'turn', prompt: 'Turn your head to YOUR left, and hold it.' },
  { id: 'tilt', prompt: 'Tilt your head toward your LEFT shoulder, and hold it.' },
  { id: 'up', prompt: 'Tip your chin up, and hold it.' },
  { id: 'eyes', prompt: 'Face forward again, and look to YOUR left with just your eyes.' },
];

export interface Sample {
  yaw: number;
  pitch: number;
  roll: number;
  /** Positive when both eyes look toward the performer's left. */
  eyes: number;
}

export function eyesTowardLeft(bs: ArrayLike<number>): number {
  return bs[BS.eyeLookOutLeft] + bs[BS.eyeLookInRight] - (bs[BS.eyeLookInLeft] + bs[BS.eyeLookOutRight]);
}

/** Average of the frames that saw a face, or null if none did. */
export function sampleOf(frames: RawFrame[]): Sample | null {
  const seen = frames.filter((frame) => frame.face);
  if (seen.length < 5) return null;
  const mean = (pick: (frame: RawFrame) => number) => seen.reduce((sum, frame) => sum + pick(frame), 0) / seen.length;
  return {
    yaw: mean((f) => f.head[0]),
    pitch: mean((f) => f.head[1]),
    roll: mean((f) => f.head[2]),
    eyes: mean((f) => eyesTowardLeft(f.bs)),
  };
}

export type Finding = 'ok' | 'flipped' | 'unclear';

export interface DirectionResult {
  fix: Orientation;
  findings: Record<'turn' | 'tilt' | 'nod' | 'eyes', Finding>;
}

const ANGLE_THRESHOLD = 0.08; // radians, about 4.5 degrees
const EYE_THRESHOLD = 0.12;

function judge(delta: number, threshold: number): Finding {
  return delta > threshold ? 'ok' : delta < -threshold ? 'flipped' : 'unclear';
}

/**
 * `current` is the fix the hub already applies; the samples were measured
 * through it, so anything that still reads backwards gets flipped again.
 */
export function solveDirections(current: Orientation, samples: Record<StepId, Sample>): DirectionResult {
  const base = samples.center;
  const findings = {
    turn: judge(samples.turn.yaw - base.yaw, ANGLE_THRESHOLD),
    tilt: judge(samples.tilt.roll - base.roll, ANGLE_THRESHOLD),
    nod: judge(samples.up.pitch - base.pitch, ANGLE_THRESHOLD),
    eyes: judge(samples.eyes.eyes - base.eyes, EYE_THRESHOLD),
  };
  const fix: Orientation = {
    swapLR: findings.eyes === 'flipped' ? !current.swapLR : current.swapLR,
    yaw: findings.turn === 'flipped' ? (-current.yaw as 1 | -1) : current.yaw,
    roll: findings.tilt === 'flipped' ? (-current.roll as 1 | -1) : current.roll,
    pitch: findings.nod === 'flipped' ? (-current.pitch as 1 | -1) : current.pitch,
  };
  return { fix, findings };
}
