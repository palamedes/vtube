import { BS } from './arkit';
import { clamp, copyFaceState, createFaceState, FacePipeline, lerpFaceState, smoothstep, type FaceState } from './processing';
import type { RawFrame } from './protocol';
import { DEFAULT_SETTINGS, type StudioSettings } from './settings';

/** Frames older than this mean tracking stopped (phone asleep, Wi-Fi hiccup, hub gone). */
const STALE_AFTER = 0.5;
/** How long the face takes to relax to rest once tracking stops. */
const RELAX_TIME = 0.6;
/** How slowly the body catches up with a head turn (seconds, time constant). */
const BODY_LAG = 0.8;

const REST = createFaceState();

/**
 * Blinks for a face nobody is performing: roughly every 3 to 5 seconds, with
 * an occasional double blink, so an idle character never looks frozen.
 */
export function idleBlink(now: number): number {
  const period = 4.1;
  const cycle = Math.floor(now / period);
  const offset = ((Math.sin(cycle * 12.9898) * 43758.5453) % 1 + 1) % 1; // 0..1 per cycle
  const start = cycle * period + offset * 1.2;
  const bump = (t0: number) => {
    const x = (now - t0) / 0.17;
    return x >= 0 && x <= 1 ? Math.sin(Math.PI * x) ** 2 : 0;
  };
  const double = offset > 0.8 ? bump(start + 0.3) : 0;
  return Math.max(bump(start), double);
}

/**
 * Turns a stream of raw frames into the face a character should show right
 * now. When frames stop, or the source reports no face, the character relaxes
 * to rest and keeps blinking instead of freezing mid-word.
 */
export class FaceDriver {
  readonly face = createFaceState();
  private readonly pipeline: FacePipeline;
  private readonly relaxFrom = createFaceState();
  private settings: StudioSettings;
  private lastFrameAt = -Infinity;
  private lostAt: number | null = null;
  private readonly body = { yaw: 0, roll: 0 };
  private lastUpdate: number | null = null;

  constructor(settings: StudioSettings = DEFAULT_SETTINGS) {
    this.settings = settings;
    this.pipeline = new FacePipeline(settings);
  }

  setSettings(settings: StudioSettings): void {
    this.settings = settings;
    this.pipeline.setSettings(settings);
  }

  /** Feed a frame; `now` is the page clock in seconds. */
  push(frame: RawFrame, now: number): void {
    this.pipeline.process(frame);
    this.lastFrameAt = now;
  }

  /** Forget filter history, e.g. after seeking in a take. */
  reset(): void {
    this.pipeline.reset();
    this.lastUpdate = null;
  }

  /** Call once per animation frame. */
  update(now: number): FaceState {
    const tracked = this.pipeline.state;
    const tracking = now - this.lastFrameAt < STALE_AFTER && tracked.present;
    const motion = this.settings.motion;
    if (tracking) {
      this.lostAt = null;
      copyFaceState(tracked, this.face);
      if (motion.autoBlinks) addBlink(this.face, idleBlink(now));
    } else {
      if (this.lostAt === null) {
        // Frames that stopped arriving went stale STALE_AFTER after the last one;
        // a source reporting "no face" is noticed right away.
        this.lostAt = tracked.present ? Math.min(now, this.lastFrameAt + STALE_AFTER) : now;
        copyFaceState(this.face, this.relaxFrom);
      }
      const k = smoothstep(0, RELAX_TIME, now - this.lostAt);
      lerpFaceState(this.relaxFrom, REST, k, this.face);
      this.face.present = false;
      if (motion.idleBlinks || motion.autoBlinks) addBlink(this.face, idleBlink(now) * k);
    }
    this.followWithBody(now, motion.bodyFollow);
    return this.face;
  }

  /**
   * The body takes on part of any turn or lean that lasts, lagging well behind
   * the head, so a quick glance moves only the head. Starts (and restarts
   * after a seek) already caught up.
   */
  private followWithBody(now: number, follow: number): void {
    const yaw = this.face.head.yaw * follow;
    const roll = this.face.head.roll * follow;
    const k = this.lastUpdate === null ? 1 : 1 - Math.exp(-clamp(now - this.lastUpdate, 0, 0.25) / BODY_LAG);
    this.lastUpdate = now;
    this.body.yaw += (yaw - this.body.yaw) * k;
    this.body.roll += (roll - this.body.roll) * k;
    this.face.body.yaw = this.body.yaw;
    this.face.body.roll = this.body.roll;
  }
}

function addBlink(face: FaceState, blink: number): void {
  face.bs[BS.eyeBlinkLeft] = Math.max(face.bs[BS.eyeBlinkLeft], blink);
  face.bs[BS.eyeBlinkRight] = Math.max(face.bs[BS.eyeBlinkRight], blink);
}
