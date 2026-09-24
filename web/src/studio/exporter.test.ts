import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE } from '../shared/scene';
import type { TakeSummary } from '../shared/protocol';
import { exportDuration, exportScene, takeTimeAt } from './exporter';

function take(audio: Partial<NonNullable<TakeSummary['audio']>> | null): TakeSummary {
  return {
    id: '20260924-120000',
    name: 'test',
    createdAt: null,
    duration: 12.5,
    frameCount: 750,
    sources: ['webcam'],
    primarySource: 'webcam',
    audio:
      audio === null
        ? null
        : { file: 'audio.wav', sampleRate: 48000, channels: 1, sampleFormat: 's24', samples: 48000 * 12, device: null, startOffset: 0.2, ...audio },
    syncOffset: 0,
  };
}

describe('export timing', () => {
  it('runs as long as the voice recording', () => {
    expect(exportDuration(take({}))).toBe(12);
    expect(exportDuration(take({ samples: 44100 * 3, sampleRate: 44100 }))).toBe(3);
  });

  it('runs as long as the take when there is no audio', () => {
    expect(exportDuration(take(null))).toBe(12.5);
  });

  it('lines the face up with the voice: audio start plus the sync shift', () => {
    // The voice started 0.2 s into the take, so video time 0 shows the face at 0.2 s.
    expect(takeTimeAt(0, take({}), 0)).toBeCloseTo(0.2);
    expect(takeTimeAt(5, take({}), -0.05)).toBeCloseTo(5.15);
    expect(takeTimeAt(5, take(null), 0.1)).toBeCloseTo(5.1);
  });
});

describe('export scene', () => {
  it('puts transparent scenes on green, since MP4 has no alpha', () => {
    expect(exportScene({ ...DEFAULT_SCENE, background: 'transparent' }).background).toBe('green');
  });

  it('leaves every other background alone', () => {
    for (const background of ['set', 'green', 'color'] as const) {
      const scene = { ...DEFAULT_SCENE, background };
      expect(exportScene(scene)).toBe(scene);
    }
  });
});
