import type { FaceDriver } from '../shared/driver';
import type { RawFrame, SourceId, TakeSummary } from '../shared/protocol';

/** Index of the last element <= value, or -1. */
function lastAtOrBefore(sorted: Float64Array, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** One source's frames within a take. */
export class Track {
  readonly times: Float64Array;
  private cursor = -1;

  constructor(readonly frames: RawFrame[]) {
    this.times = Float64Array.from(frames, (frame) => frame.t);
  }

  /** Feed the driver every frame up to `takeTime`; returns the current frame. */
  advance(takeTime: number, now: number, driver: FaceDriver): RawFrame | null {
    const index = lastAtOrBefore(this.times, takeTime);
    if (index < 0) {
      this.cursor = -1;
      return null;
    }
    if (index < this.cursor || index - this.cursor > 30) {
      // Seeked, or fell far behind: restart the filters at the new spot.
      driver.reset();
      this.cursor = index - 1;
    }
    if (index === this.cursor) {
      driver.push(this.frames[index], now); // paused: keep the face alive
    } else {
      for (let i = this.cursor + 1; i <= index; i++) driver.push(this.frames[i], now);
      this.cursor = index;
    }
    return this.frames[index];
  }
}

/**
 * Plays a recorded take in the Studio: the voice through an <audio> element,
 * each source's frames fed to its own driver in step with it. The audio clock
 * leads; frames are looked up at audio time + the audio's start offset +
 * syncOffset.
 */
export class Player {
  syncOffset: number;
  readonly tracks: Map<SourceId, Track>;
  /** The source that was live when the take was recorded (falls back to the first one present). */
  readonly primary: SourceId;
  private clockPosition = 0;
  private clockStartedAt: number | null = null;

  private constructor(
    readonly take: TakeSummary,
    frames: RawFrame[],
    readonly audio: HTMLAudioElement | null,
  ) {
    this.syncOffset = take.syncOffset ?? 0;
    const bySource = new Map<SourceId, RawFrame[]>();
    for (const frame of frames) {
      const src = frame.src as SourceId;
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src)!.push(frame);
    }
    this.tracks = new Map([...bySource].map(([src, list]) => [src, new Track(list)]));
    const first = this.tracks.keys().next().value ?? 'livelink';
    this.primary = take.primarySource && this.tracks.has(take.primarySource) ? take.primarySource : first;
  }

  static async load(take: TakeSummary): Promise<Player> {
    const response = await fetch(`/api/takes/${take.id}/frames.jsonl`);
    if (!response.ok) throw new Error(`couldn't load the take's frames (${response.status})`);
    const frames = (await response.text())
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RawFrame);
    let audio: HTMLAudioElement | null = null;
    if (take.audio) {
      audio = new Audio(`/api/takes/${take.id}/audio.wav`);
      audio.preload = 'auto';
    }
    return new Player(take, frames, audio);
  }

  get primaryTrack(): Track | undefined {
    return this.tracks.get(this.primary);
  }

  get duration(): number {
    const audioDuration = this.audio && Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    return Math.max(this.take.duration, audioDuration);
  }

  get playing(): boolean {
    return this.audio ? !this.audio.paused : this.clockStartedAt !== null;
  }

  get position(): number {
    if (this.audio) return this.audio.currentTime;
    if (this.clockStartedAt === null) return this.clockPosition;
    return Math.min(this.duration, this.clockPosition + performance.now() / 1000 - this.clockStartedAt);
  }

  play(): void {
    if (this.position >= this.duration - 0.05) this.seek(0);
    if (this.audio) void this.audio.play();
    else if (this.clockStartedAt === null) this.clockStartedAt = performance.now() / 1000;
  }

  pause(): void {
    if (this.audio) this.audio.pause();
    else if (this.clockStartedAt !== null) {
      this.clockPosition = this.position;
      this.clockStartedAt = null;
    }
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(seconds: number): void {
    const t = Math.min(Math.max(0, seconds), this.duration);
    if (this.audio) this.audio.currentTime = t;
    else {
      this.clockPosition = t;
      if (this.clockStartedAt !== null) this.clockStartedAt = performance.now() / 1000;
    }
  }

  /** Take time (frame clock) for the current audio position. */
  get takeTime(): number {
    return this.position + (this.take.audio?.startOffset ?? 0) + this.syncOffset;
  }

  /** Feed every source's driver up to now. Returns the primary source's current raw frame, for the monitor. */
  advance(now: number, driverFor: (source: SourceId) => FaceDriver): RawFrame | null {
    const t = this.takeTime;
    let primaryFrame: RawFrame | null = null;
    for (const [source, track] of this.tracks) {
      const frame = track.advance(t, now, driverFor(source));
      if (source === this.primary) primaryFrame = frame;
    }
    return primaryFrame;
  }

  dispose(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
  }
}
