import { describe, expect, it } from 'vitest';
import { BLENDSHAPES, BS } from '../shared/arkit';
import { IDENTITY_ORIENTATION, type RawFrame } from '../shared/protocol';
import { eyesTowardLeft, sampleOf, solveDirections, type Sample, type StepId } from './directions';
import { cameraAdvice, restAngleAdvice } from './framing';

const deg = (d: number) => (d * Math.PI) / 180;

function frame(head: [number, number, number], looks: Partial<Record<string, number>> = {}, face = true): RawFrame {
  const bs = BLENDSHAPES.map((name) => looks[name] ?? 0);
  return { t: 0, src: 'webcam', seq: 0, face, bs, head, eyeL: [0, 0, 0], eyeR: [0, 0, 0] };
}

function samples(overrides: Partial<Record<StepId, Partial<Sample>>>): Record<StepId, Sample> {
  const base: Sample = { yaw: 0.01, pitch: -0.02, roll: 0.0, eyes: 0.0 };
  const make = (step: StepId, fallback: Partial<Sample>) => ({ ...base, ...fallback, ...overrides[step] });
  return {
    center: make('center', {}),
    turn: make('turn', { yaw: 0.45 }),
    tilt: make('tilt', { roll: 0.3 }),
    up: make('up', { pitch: 0.3 }),
    eyes: make('eyes', { eyes: 0.9 }),
  };
}

describe('check directions', () => {
  it('leaves a source alone when it already reports correctly', () => {
    const { fix, findings } = solveDirections(IDENTITY_ORIENTATION, samples({}));
    expect(fix).toEqual(IDENTITY_ORIENTATION);
    expect(Object.values(findings)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('flips whatever reads backwards, relative to the fix already applied', () => {
    const result = solveDirections(IDENTITY_ORIENTATION, samples({ turn: { yaw: -0.4 }, eyes: { eyes: -0.8 } }));
    expect(result.fix).toEqual({ swapLR: true, yaw: -1, pitch: 1, roll: 1 });
    // Measured through that fix, a second run reads correctly and changes nothing.
    expect(solveDirections(result.fix, samples({})).fix).toEqual(result.fix);
  });

  it('calls a movement that was too small unclear and keeps the current setting', () => {
    const { fix, findings } = solveDirections({ ...IDENTITY_ORIENTATION, roll: -1 }, samples({ tilt: { roll: 0.02 } }));
    expect(findings.tilt).toBe('unclear');
    expect(fix.roll).toBe(-1);
  });

  it('averages only frames with a face, and needs enough of them', () => {
    const frames = [frame([0.2, 0, 0]), frame([0.4, 0, 0]), frame([9, 9, 9], {}, false), frame([0.3, 0, 0]), frame([0.3, 0, 0]), frame([0.3, 0, 0])];
    expect(sampleOf(frames)?.yaw).toBeCloseTo(0.3);
    expect(sampleOf(frames.slice(0, 3))).toBeNull();
  });

  it('scores both eyes looking toward the performer\'s left as positive', () => {
    const bs = BLENDSHAPES.map(() => 0);
    bs[BS.eyeLookOutLeft] = 0.6;
    bs[BS.eyeLookInRight] = 0.5;
    expect(eyesTowardLeft(bs)).toBeCloseTo(1.1);
  });
});

describe('framing advice', () => {
  const good = { face: true, fps: 60, inferenceMs: 8, faceHeight: 0.4, centerX: 0.5, eyeY: 0.4, brightness: 140 };

  it('approves a good shot', () => {
    expect(cameraAdvice(good, true).every((a) => a.ok)).toBe(true);
  });

  it('asks to move closer, center, light, and fix the frame rate', () => {
    const text = cameraAdvice({ ...good, faceHeight: 0.18, centerX: 0.7, brightness: 50, fps: 30 }, false, 60)
      .filter((a) => !a.ok)
      .map((a) => a.text)
      .join(' | ');
    expect(text).toMatch(/Move closer/);
    expect(text).toMatch(/right of center/);
    expect(text).toMatch(/dark/);
    expect(text).toMatch(/30 of 60 fps/);
  });

  it("doesn't blame the light for a 30 fps mode, but suggests 60", () => {
    const advice = cameraAdvice({ ...good, fps: 30 }, false, 30);
    expect(advice.some((a) => /Slow down in low light/.test(a.text))).toBe(false);
    expect(advice.some((a) => /60 fps tracks mouths more smoothly/.test(a.text))).toBe(true);
  });

  it('reports the preview side as shown when mirrored', () => {
    const [, center] = cameraAdvice({ ...good, centerX: 0.7 }, true);
    expect(center.text).toMatch(/left of center/);
  });

  it('says where the tracker sits from the head angle at rest', () => {
    expect(restAngleAdvice(0, deg(20), 'iPhone')[0].text).toMatch(/Raise it/);
    expect(restAngleAdvice(deg(-18), 0, 'camera')[0].text).toMatch(/off to your left/);
    expect(restAngleAdvice(deg(3), deg(-4), 'camera')[0].ok).toBe(true);
  });
});
