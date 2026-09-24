import { describe, expect, it } from 'vitest';
import { envelope, estimateSyncOffset, resample } from './autosync';

const RATE = 8000;

/** A fake read: bursts of noise (syllables) with gaps, and the jaw opening on each burst. */
function syntheticTake(seconds: number, faceLate: number) {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const syllables: [number, number][] = [];
  for (let t = 0.2; t < seconds - 0.5; ) {
    const length = 0.08 + 0.2 * Math.abs(random());
    syllables.push([t, t + length]);
    t += length + 0.05 + 0.35 * Math.abs(random());
  }
  const loudAt = (t: number) => syllables.some(([a, b]) => t >= a && t < b);
  const samples = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = (loudAt(i / RATE) ? 0.5 : 0.01) * random();
  // Face frames at 60 fps; the jaw follows the voice but its timestamps run `faceLate` behind.
  const times: number[] = [];
  const jaw: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    times.push(t);
    jaw.push(loudAt(t - faceLate) ? 0.6 : 0.05);
  }
  return { samples, times, jaw };
}

describe('autosync', () => {
  it('computes an RMS envelope', () => {
    const tone = Float32Array.from({ length: RATE }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / RATE));
    const env = envelope(tone, RATE);
    expect(env).toHaveLength(100);
    expect(env[50]).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('resamples with interpolation and flat ends', () => {
    const out = resample([0, 1, 2], [0, 10, 20], -1, 0.5, 8);
    expect(Array.from(out)).toEqual([0, 0, 0, 5, 10, 15, 20, 20]);
  });

  it.each([0, 0.07, 0.15, -0.04])('finds a face delay of %s s', (late) => {
    const { samples, times, jaw } = syntheticTake(20, late);
    const result = estimateSyncOffset(samples, RATE, times, jaw, 0);
    expect(Math.abs(result.offset - late)).toBeLessThanOrEqual(0.02);
    expect(result.reliable).toBe(true);
    expect(result.correlation).toBeGreaterThan(0.5);
  });

  it('accounts for when the audio started', () => {
    // Audio began 0.3 s into the take; the face is 0.05 s late.
    const { samples, times, jaw } = syntheticTake(20, 0.05);
    const shiftedTimes = times.map((t) => t + 0.3);
    const result = estimateSyncOffset(samples, RATE, shiftedTimes, jaw, 0.3);
    expect(Math.abs(result.offset - 0.05)).toBeLessThanOrEqual(0.02);
  });

  it('refuses to guess on silence', () => {
    const result = estimateSyncOffset(new Float32Array(RATE * 5), RATE, [0, 5], [0, 0], 0);
    expect(result.reliable).toBe(false);
  });

  it('refuses to guess when the face has nothing to do with the voice', () => {
    const { samples } = syntheticTake(20, 0);
    const { times, jaw } = syntheticTake(20, 0);
    // Scramble the jaw curve in half-second blocks so it no longer follows the voice.
    const blocks = 40;
    const per = Math.floor(jaw.length / blocks);
    const scrambled = Array.from({ length: blocks }, (_, b) => jaw.slice(((b * 17) % blocks) * per, (((b * 17) % blocks) + 1) * per)).flat();
    const result = estimateSyncOffset(samples, RATE, times.slice(0, scrambled.length), scrambled, 0);
    expect(result.reliable).toBe(false);
  });
});
