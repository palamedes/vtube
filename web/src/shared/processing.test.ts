import { describe, expect, it } from 'vitest';
import { BLENDSHAPES, BS, MIRROR_PAIRS } from './arkit';
import { FaceDriver } from './driver';
import { OneEuroFilter } from './oneEuro';
import { cutoffFor, FacePipeline } from './processing';
import type { RawFrame } from './protocol';
import { DEFAULT_SETTINGS, mergeSettings, type StudioSettings } from './settings';

function frame(t: number, values: Partial<Record<(typeof BLENDSHAPES)[number], number>> = {}, head: [number, number, number] = [0, 0, 0]): RawFrame {
  const bs = BLENDSHAPES.map((name) => values[name] ?? 0);
  return { t, src: 'test', seq: Math.round(t * 60), face: true, bs, head, eyeL: [0, 0, 0], eyeR: [0, 0, 0] };
}

/** Settings with smoothing off, so values pass straight through. */
function raw(overrides: (s: StudioSettings) => void = () => {}): StudioSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.head.smoothing = 0;
  s.eyes.smoothing = 0;
  s.eyes.blinkSmoothing = 0;
  s.brows.smoothing = 0;
  s.mouth.smoothing = 0;
  s.mouth.jawGain = 1;
  s.brows.gain = 1;
  overrides(s);
  return s;
}

/** Feed the same frame long enough for any filter to settle. */
function settle(pipeline: FacePipeline, make: (t: number) => RawFrame) {
  for (let i = 0; i < 240; i++) pipeline.process(make(i / 60));
  return pipeline.state;
}

describe('arkit tables', () => {
  it('has 52 names and pairs every Left with a Right', () => {
    expect(BLENDSHAPES).toHaveLength(52);
    expect(MIRROR_PAIRS).toHaveLength(BLENDSHAPES.filter((n) => n.endsWith('Left')).length);
    for (const [l, r] of MIRROR_PAIRS) expect(BLENDSHAPES[r]).toBe(BLENDSHAPES[l].replace(/Left$/, 'Right'));
  });
});

describe('OneEuroFilter', () => {
  it('passes the first value and converges on a constant', () => {
    const f = new OneEuroFilter(1, 0);
    expect(f.filter(0.8, 0)).toBe(0.8);
    let y = 0;
    const g = new OneEuroFilter(1, 0);
    g.filter(0, 0);
    for (let i = 1; i <= 300; i++) y = g.filter(1, i / 60);
    expect(y).toBeGreaterThan(0.999);
  });

  it('smooths jitter more at a lower cutoff', () => {
    const jitter = (i: number) => 0.5 + (i % 2 ? 0.05 : -0.05);
    const spread = (cutoff: number) => {
      const f = new OneEuroFilter(cutoff, 0);
      const out: number[] = [];
      for (let i = 0; i < 240; i++) out.push(f.filter(jitter(i), i / 60));
      const tail = out.slice(-60);
      return Math.max(...tail) - Math.min(...tail);
    };
    expect(spread(cutoffFor(0.9))).toBeLessThan(spread(cutoffFor(0.1)) / 3);
  });
});

describe('settings', () => {
  it('fills gaps and ignores junk', () => {
    const s = mergeSettings({ mirror: true, head: { yawGain: 2, maxDegrees: 'lots' }, mouth: null, extra: 1 });
    expect(s.mirror).toBe(true);
    expect(s.head.yawGain).toBe(2);
    expect(s.head.maxDegrees).toBe(DEFAULT_SETTINGS.head.maxDegrees);
    expect(s.mouth).toEqual(DEFAULT_SETTINGS.mouth);
    expect(s.neutral).toBeNull();
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a valid neutral pose and drops a malformed one', () => {
    const neutral = { bs: new Array(52).fill(0.1), head: [0.1, 0, 0], capturedAt: 'now' };
    expect(mergeSettings({ neutral }).neutral?.bs[0]).toBe(0.1);
    expect(mergeSettings({ neutral: { bs: [1, 2], head: [0, 0, 0] } }).neutral).toBeNull();
  });
});

describe('FacePipeline', () => {
  it('subtracts the neutral pose', () => {
    const s = raw((d) => {
      d.neutral = { bs: BLENDSHAPES.map((n) => (n === 'jawOpen' ? 0.2 : 0)), head: [0.1, 0, 0], capturedAt: '' };
    });
    const p = new FacePipeline(s);
    const atRest = settle(p, (t) => frame(t, { jawOpen: 0.2 }, [0.1, 0, 0]));
    expect(atRest.bs[BS.jawOpen]).toBeCloseTo(0, 5);
    expect(atRest.head.yaw).toBeCloseTo(0, 5);
    const open = settle(p, (t) => frame(t + 10, { jawOpen: 0.6 }));
    expect(open.bs[BS.jawOpen]).toBeCloseTo(0.5, 3); // (0.6 - 0.2) / 0.8
  });

  it('mirrors left and right, and flips yaw and roll', () => {
    const p = new FacePipeline(raw((d) => void (d.mirror = true)));
    const out = settle(p, (t) => frame(t, { eyeBlinkLeft: 1, mouthSmileRight: 0.5 }, [0.2, 0.1, 0.05]));
    expect(out.bs[BS.eyeBlinkRight]).toBeCloseTo(1, 3);
    expect(out.bs[BS.eyeBlinkLeft]).toBeCloseTo(0, 3);
    expect(out.bs[BS.mouthSmileLeft]).toBeCloseTo(0.5, 3);
    expect(out.head.yaw).toBeCloseTo(-0.2, 3);
    expect(out.head.pitch).toBeCloseTo(0.1, 3);
    expect(out.head.roll).toBeCloseTo(-0.05, 3);
  });

  it('shapes blinks so squints stay open and blinks close fully', () => {
    const p = new FacePipeline(raw());
    expect(settle(p, (t) => frame(t, { eyeBlinkLeft: 0.2 })).bs[BS.eyeBlinkLeft]).toBeCloseTo(0, 3);
    expect(settle(p, (t) => frame(t + 10, { eyeBlinkLeft: 0.7 })).bs[BS.eyeBlinkLeft]).toBeCloseTo(1, 3);
  });

  it('damps gaze by gazeStrength, in screen terms', () => {
    const p = new FacePipeline(raw((d) => void (d.eyes.gazeStrength = 0.5)));
    // Both eyes look toward the performer's left: the character looks toward screen right.
    const out = settle(p, (t) => frame(t, { eyeLookOutLeft: 0.8, eyeLookInRight: 0.8 }));
    expect(out.bs[BS.eyeLookOutLeft]).toBeCloseTo(0.4, 3);
    expect(out.gaze.x).toBeCloseTo(0.4, 3);
  });

  it('limits head angles', () => {
    const p = new FacePipeline(raw((d) => void (d.head.maxDegrees = 20)));
    expect(settle(p, (t) => frame(t, {}, [1.2, 0, 0])).head.yaw).toBeCloseTo((20 * Math.PI) / 180, 3);
  });

  it('relaxes to rest when the source reports no face', () => {
    const p = new FacePipeline(raw());
    settle(p, (t) => frame(t, { jawOpen: 0.8 }));
    const lost = settle(p, (t) => ({ ...frame(t + 10), face: false }));
    expect(lost.present).toBe(false);
    expect(lost.bs[BS.jawOpen]).toBeCloseTo(0, 3);
  });
});

describe('FaceDriver', () => {
  it('follows frames while they arrive, then relaxes and idles', () => {
    const d = new FaceDriver(raw());
    for (let i = 0; i < 60; i++) d.push(frame(i / 60, { jawOpen: 0.7 }), i / 60);
    expect(d.update(1).bs[BS.jawOpen]).toBeCloseTo(0.7, 2);
    // No frames for a while: the mouth closes and the face is marked idle.
    const idle = d.update(3);
    expect(idle.present).toBe(false);
    expect(idle.bs[BS.jawOpen]).toBeCloseTo(0, 3);
    // Idle blinks happen now and then.
    let blinked = false;
    for (let t = 3; t < 12; t += 1 / 60) blinked ||= d.update(t).bs[BS.eyeBlinkLeft] > 0.9;
    expect(blinked).toBe(true);
  });

  it('blinks on its own while tracking only when asked to', () => {
    const blinksWhileTracking = (autoBlinks: boolean) => {
      const d = new FaceDriver(raw((s) => void (s.motion.autoBlinks = autoBlinks)));
      let most = 0;
      for (let i = 0; i < 60 * 12; i++) {
        const t = i / 60;
        d.push(frame(t), t);
        most = Math.max(most, d.update(t).bs[BS.eyeBlinkLeft]);
      }
      return most;
    };
    expect(blinksWhileTracking(false)).toBeCloseTo(0, 3);
    expect(blinksWhileTracking(true)).toBeGreaterThan(0.9);
  });

  it('turns the body part of the way when a head turn lasts, but barely for a glance', () => {
    const run = (turnFor: number) => {
      const d = new FaceDriver(raw((s) => void (s.motion.bodyFollow = 0.5)));
      let body = 0;
      for (let i = 0; i < 60 * 4; i++) {
        const t = i / 60;
        d.push(frame(t, {}, [t >= 1 && t < 1 + turnFor ? 0.6 : 0, 0, 0]), t);
        const face = d.update(t);
        if (t < 1 + turnFor) body = face.body.yaw;
      }
      return body;
    };
    expect(run(3)).toBeCloseTo(0.3, 1); // half of a held 0.6 rad turn
    expect(run(0.2)).toBeLessThan(0.1); // a quick glance
  });

  it('keeps the body still when following is off', () => {
    const d = new FaceDriver(raw((s) => void (s.motion.bodyFollow = 0)));
    let most = 0;
    for (let i = 0; i < 180; i++) {
      d.push(frame(i / 60, {}, [0.6, 0, 0.3]), i / 60);
      const face = d.update(i / 60);
      most = Math.max(most, Math.abs(face.body.yaw), Math.abs(face.body.roll));
    }
    expect(most).toBe(0);
  });
});
