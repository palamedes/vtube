import { BLENDSHAPES } from './arkit';
import { DEFAULT_SCENE, sanitizeScene, type SceneSettings } from './scene';

/** The performer's face at rest, subtracted so a relaxed face reads as zero. */
export interface NeutralPose {
  bs: number[];
  head: [number, number, number];
  capturedAt: string;
}

/**
 * Everything the Studio tunes: the face (calibration, gains, smoothing) and
 * the scene (character, layout per format, headline, background). The hub
 * stores this as an opaque JSON object; every page merges what it receives
 * over DEFAULT_SETTINGS, so older or partial settings keep working.
 * Smoothing values run 0 (raw) to 1 (heavy).
 */
export interface StudioSettings {
  version: 1;
  mirror: boolean;
  neutral: NeutralPose | null;
  head: {
    yawGain: number;
    pitchGain: number;
    rollGain: number;
    maxDegrees: number;
    smoothing: number;
  };
  eyes: {
    blinkLow: number;
    blinkHigh: number;
    linkBlinks: boolean;
    gazeStrength: number;
    smoothing: number;
    blinkSmoothing: number;
  };
  brows: { gain: number; smoothing: number };
  mouth: { jawGain: number; smileGain: number; shapeGain: number; smoothing: number };
  motion: { breathing: boolean; idleBlinks: boolean };
  scene: SceneSettings;
}

export const DEFAULT_SETTINGS: StudioSettings = {
  version: 1,
  mirror: false,
  neutral: null,
  head: { yawGain: 1, pitchGain: 1, rollGain: 1, maxDegrees: 35, smoothing: 0.55 },
  eyes: { blinkLow: 0.25, blinkHigh: 0.65, linkBlinks: false, gazeStrength: 0.35, smoothing: 0.5, blinkSmoothing: 0.1 },
  brows: { gain: 1.2, smoothing: 0.45 },
  mouth: { jawGain: 1.15, smileGain: 1, shapeGain: 1, smoothing: 0.25 },
  motion: { breathing: true, idleBlinks: true },
  scene: DEFAULT_SCENE,
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function mergeInto<T>(defaults: T, input: unknown): T {
  if (!isObject(defaults) || !isObject(input)) return defaults;
  const out: Json = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = input[key];
    if (value === undefined || fallback === null) continue;
    if (isObject(fallback)) out[key] = mergeInto(fallback, value);
    else if (typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))) out[key] = value;
  }
  return out as T;
}

function parseNeutral(value: unknown): NeutralPose | null {
  if (!isObject(value)) return null;
  const { bs, head, capturedAt } = value;
  if (!Array.isArray(bs) || bs.length !== BLENDSHAPES.length || !bs.every(isFiniteNumber)) return null;
  if (!Array.isArray(head) || head.length !== 3 || !head.every(isFiniteNumber)) return null;
  return { bs: [...bs], head: [head[0], head[1], head[2]], capturedAt: typeof capturedAt === 'string' ? capturedAt : '' };
}

/** Anything from the hub (or nothing) to complete, valid settings. */
export function mergeSettings(input: unknown): StudioSettings {
  const merged = mergeInto(DEFAULT_SETTINGS, input);
  return {
    ...merged,
    version: 1,
    neutral: isObject(input) ? parseNeutral(input.neutral) : null,
    scene: sanitizeScene(merged.scene),
  };
}
