/** Messages and REST shapes shared with the hub (hub/src/vtube_hub/server.py). */

import { BLENDSHAPES, type Blendshape } from './arkit';

export type Vec3 = [number, number, number];

/** One face sample before calibration or smoothing. `t` is seconds (hub clock, or since take start). */
export interface RawFrame {
  t: number;
  src: string;
  seq: number;
  face: boolean;
  bs: number[];
  head: Vec3;
  eyeL: Vec3;
  eyeR: Vec3;
}

export type SourceId = 'livelink' | 'webcam' | 'simulator' | 'voice';

export const SOURCE_NAMES: Record<SourceId, string> = { livelink: 'iPhone', webcam: 'Camera', simulator: 'Simulator', voice: 'Voice' };

/** What the voice source sets (hub/src/vtube_hub/voice.py); everything else stays at rest. */
const VOICE_CHANNELS: readonly Blendshape[] = [
  'jawOpen',
  'mouthFunnel',
  'mouthPucker',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
];

/**
 * Channels a source doesn't really track. The camera's tracker (MediaPipe) has
 * no tongue channel and barely moves the cheek, sneer, and sideways-jaw ones;
 * the iPhone tracks all 52.
 */
export const UNTRACKED: Record<SourceId, ReadonlySet<Blendshape>> = {
  livelink: new Set(),
  webcam: new Set<Blendshape>([
    'tongueOut',
    'cheekPuff',
    'cheekSquintLeft',
    'cheekSquintRight',
    'noseSneerLeft',
    'noseSneerRight',
    'jawForward',
    'jawLeft',
    'jawRight',
  ]),
  simulator: new Set(),
  voice: new Set(BLENDSHAPES.filter((name) => !VOICE_CHANNELS.includes(name))),
};

/** Per-source fixes that bring a tracker to the shared direction conventions. */
export interface Orientation {
  swapLR: boolean;
  yaw: 1 | -1;
  pitch: 1 | -1;
  roll: 1 | -1;
}

export const IDENTITY_ORIENTATION: Orientation = { swapLR: false, yaw: 1, pitch: 1, roll: 1 };

export interface WebcamConfig {
  device: string | null;
  width: number;
  height: number;
  fps: number;
  /** Keep tracking with the camera while another source is active, to compare them. */
  keepRunning: boolean;
}

export interface HubConfig {
  activeSource: SourceId;
  audioDevice: string | null;
  webcam: WebcamConfig;
  orientation: Partial<Record<SourceId, Orientation>>;
}

export interface WebcamStatus {
  state: 'off' | 'starting' | 'running' | 'error';
  running: boolean;
  device: string | null;
  error: string | null;
  actual: { width: number; height: number; fps: number } | null;
  fps: number;
  inferenceMs: number;
  faceDetected: boolean;
}

/** Where the face sits in the camera image (0..1 coordinates), about 15 times a second. */
export interface CameraMetrics {
  face: boolean;
  fps: number;
  inferenceMs: number;
  box?: [number, number, number, number];
  faceHeight?: number;
  centerX?: number;
  centerY?: number;
  eyeY?: number;
  brightness?: number | null;
}

export interface CameraDevice {
  device: string;
  name: string;
  formats: string[];
}

export interface CameraControl {
  type: string;
  min: number;
  max: number;
  step: number;
  default: number;
  value: number;
  inactive: boolean;
}

export type CameraControls = Partial<
  Record<'zoom_absolute' | 'pan_absolute' | 'tilt_absolute' | 'exposure_dynamic_framerate' | 'brightness', CameraControl>
>;

export interface LiveLinkStatus {
  listening: boolean;
  port: number | null;
  bindError: string | null;
  receiving: boolean;
  packetsPerSec: number;
  lastPacketAgo: number | null;
  sender: string | null;
  device: string | null;
  subject: string | null;
  version: number | null;
  rate: [number, number] | null;
  faceDetected: boolean;
  headRotation: boolean;
  droppedFrames: number;
  parseErrors: number;
  lastError: string | null;
  lastBadPacket: string | null;
}

export interface AudioStatus {
  running: boolean;
  device?: string | null;
  resolvedDevice?: string | null;
  error?: string | null;
  sampleRate?: number;
  disabled?: boolean;
}

export interface RecordingStatus {
  active: boolean;
  takeId?: string;
  name?: string;
  elapsed?: number;
  frames?: number;
}

export interface HubStatus {
  activeSource: SourceId;
  activeFps: number;
  livelink: LiveLinkStatus;
  webcam: WebcamStatus;
  simulator: { running: boolean };
  voice: { running: boolean; hearing: boolean };
  audio: AudioStatus;
  recording: RecordingStatus;
  clients: number;
}

export interface TakeAudio {
  file: string;
  sampleRate: number;
  channels: number;
  sampleFormat: string;
  samples: number;
  device: string | null;
  startOffset: number;
  interrupted?: boolean;
}

export interface TakeSummary {
  id: string;
  name: string;
  createdAt: string | null;
  duration: number;
  frameCount: number;
  sources: string[];
  /** The source that was active when the take was recorded. */
  primarySource: SourceId | null;
  audio: TakeAudio | null;
  syncOffset: number;
}

export interface NetworkInfo {
  addresses: { iface: string; address: string }[];
  /** Running firewall services, e.g. ["ufw"]. */
  firewalls: string[];
  livelinkPort: number;
  httpPort: number;
}

export interface HubState {
  version: string;
  settings: unknown;
  config: HubConfig;
  status: HubStatus;
  takes: TakeSummary[];
  network: NetworkInfo;
  dataDir: string;
}

export interface AudioSource {
  name: string;
  description: string;
  monitor: boolean;
}

export type HubMessage =
  | { type: 'hello'; state: HubState }
  | ({ type: 'frame' } & RawFrame)
  | { type: 'level'; rms: number; peak: number }
  | { type: 'camera'; metrics: CameraMetrics }
  | { type: 'status'; status: HubStatus }
  | { type: 'settings'; settings: unknown }
  | { type: 'config'; config: HubConfig }
  | { type: 'recording'; recording: RecordingStatus }
  | { type: 'takes'; takes: TakeSummary[] };

export type MessageOf<K extends HubMessage['type']> = Extract<HubMessage, { type: K }>;
