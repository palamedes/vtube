/**
 * Finds how far the face data lags the voice in a take, by lining up the
 * jaw-open curve with the loudness of the recorded audio. Mouths open with
 * syllables, so the two curves rise and fall together; the shift that makes
 * them match best is the tracking delay (Wi-Fi plus the phone's processing).
 */

export const HOP = 0.01; // seconds per analysis step

/** RMS loudness per HOP-long window. */
export function envelope(samples: Float32Array, sampleRate: number, hop = HOP): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * hop));
  const n = Math.floor(samples.length / size);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = k * size; i < (k + 1) * size; i++) sum += samples[i] * samples[i];
    out[k] = Math.sqrt(sum / size);
  }
  return out;
}

/** Linear interpolation of (times, values) at start + k * hop, held flat past the ends. */
export function resample(times: ArrayLike<number>, values: ArrayLike<number>, start: number, hop: number, n: number): Float32Array {
  const out = new Float32Array(n);
  if (times.length === 0) return out;
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = start + k * hop;
    while (j < times.length - 2 && times[j + 1] < t) j++;
    if (t <= times[0]) out[k] = values[0];
    else if (t >= times[times.length - 1]) out[k] = values[values.length - 1];
    else {
      const t0 = times[j];
      const t1 = times[j + 1];
      const w = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      out[k] = values[j] + (values[j + 1] - values[j]) * w;
    }
  }
  return out;
}

function standardize(x: Float32Array): Float32Array {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= Math.max(1, x.length);
  let variance = 0;
  for (const v of x) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / Math.max(1, x.length));
  const out = new Float32Array(x.length);
  if (std < 1e-9) return out;
  for (let i = 0; i < x.length; i++) out[i] = (x[i] - mean) / std;
  return out;
}

export interface SyncEstimate {
  /** Seconds to add to the take's syncOffset: positive means the face data runs late. */
  offset: number;
  /** How well jaw and loudness match at that shift (correlation, -1..1). */
  correlation: number;
  /** How far that match beats the best rival shift more than RIVAL_DISTANCE away. */
  margin: number;
  /** Whether the estimate is worth applying. */
  reliable: boolean;
}

export const MIN_CORRELATION = 0.2;
export const MIN_MARGIN = 0.03;
const RIVAL_DISTANCE = 0.15;

/**
 * `frameTimes` are take-relative seconds; audio sample 0 sits at take time `audioStart`.
 * Searches shifts within ±maxLag seconds.
 */
export function estimateSyncOffset(
  samples: Float32Array,
  sampleRate: number,
  frameTimes: ArrayLike<number>,
  jaw: ArrayLike<number>,
  audioStart: number,
  maxLag = 0.4,
): SyncEstimate {
  const loud = envelope(samples, sampleRate);
  // Compress the loudness so a few shouted words don't dominate.
  for (let i = 0; i < loud.length; i++) loud[i] = Math.log(1e-4 + loud[i]);
  const reference = standardize(loud);
  const n = reference.length;
  const lags = Math.round(maxLag / HOP);
  const grid = resample(frameTimes, jaw, audioStart - lags * HOP, HOP, n + 2 * lags);
  const signal = standardize(grid);
  const scores: number[] = [];
  let bestIndex = 0;
  for (let lag = -lags; lag <= lags; lag++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += reference[k] * signal[k + lags + lag];
    scores.push(sum / Math.max(1, n));
    if (scores[scores.length - 1] > scores[bestIndex]) bestIndex = scores.length - 1;
  }
  const best = scores[bestIndex];
  const rivalSteps = Math.round(RIVAL_DISTANCE / HOP);
  const rival = Math.max(-1, ...scores.filter((_, i) => Math.abs(i - bestIndex) > rivalSteps));
  const margin = best - rival;
  return {
    offset: (bestIndex - lags) * HOP,
    correlation: best,
    margin,
    reliable: best >= MIN_CORRELATION && margin >= MIN_MARGIN,
  };
}
