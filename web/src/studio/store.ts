import { BLENDSHAPES, BS } from '../shared/arkit';
import { FaceDriver } from '../shared/driver';
import { api, defaultSocketUrl, HubClient } from '../shared/hubClient';
import {
  IDENTITY_ORIENTATION,
  SOURCE_NAMES,
  type AudioSource,
  type CameraControls,
  type CameraDevice,
  type CameraMetrics,
  type HubConfig,
  type HubState,
  type HubStatus,
  type RawFrame,
  type RecordingStatus,
  type SourceId,
  type TakeSummary,
  type WebcamConfig,
} from '../shared/protocol';
import { DEFAULT_SETTINGS, mergeSettings, type StudioSettings } from '../shared/settings';
import type { ViewId } from '../shared/scene';
import { estimateSyncOffset } from './autosync';
import { sampleOf, solveDirections, STEPS, type Finding, type Sample, type StepId } from './directions';
import { renderTake, type ExportQuality } from './exporter';
import { Player } from './player';

/** A finished export on disk (served by the hub). */
export interface ExportFile {
  take: string;
  file: string;
  url: string;
  size: number;
  path: string;
  modified: number;
}

export type ExportState =
  | { phase: 'rendering'; done: number; total: number; startedAt: number }
  | { phase: 'saving'; startedAt: number }
  | { phase: 'done'; files: ExportFile[]; seconds: number }
  | { phase: 'error'; message: string }
  | { phase: 'canceled' };

export interface PlayerView {
  take: TakeSummary;
  primary: SourceId;
  playing: boolean;
  position: number;
  duration: number;
  syncOffset: number;
}

export type NeutralPhase = { phase: 'idle' } | { phase: 'countdown'; secondsLeft: number } | { phase: 'capturing' };

export type DirectionsPhase =
  | { phase: 'idle' }
  | { phase: 'step'; index: number; total: number; prompt: string; secondsLeft: number; capturing: boolean };

export type Layout = 'wide' | 'tall' | 'both' | 'compare' | 'framing';
const LAYOUTS: Layout[] = ['wide', 'tall', 'both', 'compare', 'framing'];

function rememberedLayout(): Layout {
  try {
    const saved = localStorage.getItem('vtube.layout') as Layout | null;
    return saved && LAYOUTS.includes(saved) ? saved : 'both';
  } catch {
    return 'both';
  }
}

export interface Snapshot {
  connected: boolean;
  layout: Layout;
  hub: HubState | null;
  config: HubConfig | null;
  status: HubStatus | null;
  settings: StudioSettings;
  takes: TakeSummary[];
  recording: RecordingStatus & { startedLocal?: number };
  audioDevices: AudioSource[];
  cameraDevices: CameraDevice[];
  player: PlayerView | null;
  loadingTake: string | null;
  neutral: NeutralPhase;
  directions: DirectionsPhase;
  /** Sources with face data right now (live) or in the open take: what Compare can show. */
  sources: SourceId[];
  exporting: ExportState | null;
  exports: ExportFile[];
  notice: { kind: 'error' | 'info'; text: string } | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = () => performance.now() / 1000;
const FINDING_TEXT: Record<Finding, string> = { ok: 'OK', flipped: 'was backwards, fixed', unclear: 'unclear' };

/**
 * Everything the Studio knows, outside React. Low-frequency state goes
 * through `snapshot` (React re-renders on change); the 60 fps stuff (faces,
 * raw frames, audio level, camera framing) is read directly by canvases and
 * characters on each animation frame via `onTick`.
 */
export class StudioStore {
  readonly client = new HubClient(defaultSocketUrl('studio'));
  /** The raw frame behind the main face (live or playback), for the monitor. */
  raw: RawFrame | null = null;
  level = { rms: -120, peak: -120 };
  camera: CameraMetrics | null = null;
  player: Player | null = null;

  private readonly drivers = new Map<SourceId, FaceDriver>();
  private readonly lastFrameAt = new Map<SourceId, number>();
  private snapshot: Snapshot = {
    connected: false,
    layout: rememberedLayout(),
    hub: null,
    config: null,
    status: null,
    settings: DEFAULT_SETTINGS,
    takes: [],
    recording: { active: false },
    audioDevices: [],
    cameraDevices: [],
    player: null,
    loadingTake: null,
    neutral: { phase: 'idle' },
    directions: { phase: 'idle' },
    sources: [],
    exporting: null,
    exports: [],
    notice: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly tickListeners = new Set<(now: number) => void>();
  private settingsTimer: ReturnType<typeof setTimeout> | undefined;
  private settingsDirty = false;
  private captureFrames: RawFrame[] | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPlayerPublish = 0;
  private lastSourcesCheck = 0;
  private exportAbort: AbortController | null = null;

  constructor() {
    const { client } = this;
    client.onConnection((connected) => this.set({ connected }));
    client.on('hello', ({ state }) => {
      const settings = mergeSettings(state.settings);
      this.drivers.forEach((driver) => driver.setSettings(settings));
      this.set({
        hub: state,
        config: state.config,
        status: state.status,
        settings,
        takes: state.takes,
        recording: this.withLocalStart(state.status.recording),
      });
      void this.refreshAudioDevices();
    });
    client.on('frame', (frame) => {
      const source = frame.src as SourceId;
      this.captureFrames?.push(frame);
      this.lastFrameAt.set(source, clock());
      if (this.player) return;
      this.driverFor(source).push(frame, clock());
      if (source === this.activeSource) this.raw = frame;
    });
    client.on('level', ({ rms, peak }) => {
      this.level = { rms, peak };
    });
    client.on('camera', ({ metrics }) => {
      this.camera = metrics;
    });
    client.on('status', ({ status }) => this.set({ status, recording: this.withLocalStart(status.recording) }));
    client.on('config', ({ config }) => this.set({ config }));
    client.on('recording', ({ recording }) => this.set({ recording: this.withLocalStart(recording) }));
    client.on('takes', ({ takes }) => this.set({ takes }));
    client.on('settings', ({ settings }) => {
      if (this.settingsDirty) return; // our own edits are newer
      const merged = mergeSettings(settings);
      this.drivers.forEach((driver) => driver.setSettings(merged));
      this.set({ settings: merged });
    });
    client.connect();
    requestAnimationFrame(this.tick);
  }

  // Sources and faces

  /** The source whose face is "the" face: the live source, or the take's primary source. */
  get activeSource(): SourceId {
    return this.player?.primary ?? this.snapshot.config?.activeSource ?? 'livelink';
  }

  driverFor(source: SourceId): FaceDriver {
    let driver = this.drivers.get(source);
    if (!driver) {
      driver = new FaceDriver(this.snapshot.settings);
      this.drivers.set(source, driver);
    }
    return driver;
  }

  get driver(): FaceDriver {
    return this.driverFor(this.activeSource);
  }

  // Subscription plumbing

  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onTick(listener: (now: number) => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  private set(partial: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.listeners.forEach((listener) => listener());
  }

  private withLocalStart(recording: RecordingStatus): Snapshot['recording'] {
    if (!recording.active) return recording;
    const current = this.snapshot.recording;
    const startedLocal =
      current.active && current.takeId === recording.takeId && current.startedLocal !== undefined
        ? current.startedLocal
        : clock() - (recording.elapsed ?? 0);
    return { ...recording, startedLocal };
  }

  private tick = () => {
    const now = clock();
    const player = this.player;
    if (player) {
      this.raw = player.advance(now, (source) => this.driverFor(source));
      if (now - this.lastPlayerPublish > 0.1) {
        this.lastPlayerPublish = now;
        this.publishPlayer();
      }
    }
    this.drivers.forEach((driver) => driver.update(now));
    if (now - this.lastSourcesCheck > 0.5) {
      this.lastSourcesCheck = now;
      this.publishSources(now);
    }
    this.tickListeners.forEach((listener) => listener(now));
    requestAnimationFrame(this.tick);
  };

  private publishSources(now: number): void {
    const sources = this.player
      ? [...this.player.tracks.keys()]
      : ([...this.lastFrameAt].filter(([, at]) => now - at < 1.5).map(([source]) => source) as SourceId[]);
    sources.sort();
    if (sources.join() !== this.snapshot.sources.join()) this.set({ sources });
  }

  setLayout(layout: Layout): void {
    this.set({ layout });
    try {
      localStorage.setItem('vtube.layout', layout);
    } catch {
      // Storage can be unavailable (private window); the choice just won't stick.
    }
  }

  notify(kind: 'error' | 'info', text: string): void {
    clearTimeout(this.noticeTimer);
    this.set({ notice: { kind, text } });
    this.noticeTimer = setTimeout(() => this.set({ notice: null }), kind === 'error' ? 8000 : 5000);
  }

  private async attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (error) {
      this.notify('error', error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  // Tuning

  updateSettings(mutate: (draft: StudioSettings) => void): void {
    const next = structuredClone(this.snapshot.settings);
    mutate(next);
    this.drivers.forEach((driver) => driver.setSettings(next));
    this.set({ settings: next });
    this.settingsDirty = true;
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => void this.saveSettings(), 250);
  }

  private async saveSettings(): Promise<void> {
    const sent = this.snapshot.settings;
    await this.attempt(() => api('PUT', '/api/settings', sent));
    if (this.snapshot.settings === sent) this.settingsDirty = false;
  }

  /** Reset the face tuning; the neutral face and the scene are kept. */
  resetSettings(): void {
    const { neutral, scene } = this.snapshot.settings;
    this.updateSettings((draft) => Object.assign(draft, structuredClone(DEFAULT_SETTINGS), { neutral, scene }));
  }

  /** Collect the active source's frames for `ms` milliseconds. */
  private async collect(ms: number): Promise<RawFrame[]> {
    const source = this.activeSource;
    this.captureFrames = [];
    await sleep(ms);
    const frames = this.captureFrames.filter((frame) => frame.src === source);
    this.captureFrames = null;
    return frames;
  }

  private busyWithCalibration(): boolean {
    if (this.player) {
      this.notify('error', 'Close the take and go back to live first.');
      return true;
    }
    if (this.snapshot.neutral.phase !== 'idle' || this.snapshot.directions.phase !== 'idle') return true;
    return false;
  }

  async captureNeutral(): Promise<void> {
    if (this.busyWithCalibration()) return;
    for (let secondsLeft = 3; secondsLeft > 0; secondsLeft--) {
      this.set({ neutral: { phase: 'countdown', secondsLeft } });
      await sleep(1000);
    }
    this.set({ neutral: { phase: 'capturing' } });
    const frames = (await this.collect(1200)).filter((frame) => frame.face);
    this.set({ neutral: { phase: 'idle' } });
    if (frames.length < 10) {
      this.notify('error', 'No face data came in. Is the source tracking? (Check the status next to the source buttons.)');
      return;
    }
    const bs = BLENDSHAPES.map((_, i) => frames.reduce((sum, frame) => sum + frame.bs[i], 0) / frames.length);
    const head = [0, 1, 2].map((i) => frames.reduce((sum, frame) => sum + frame.head[i], 0) / frames.length) as [
      number,
      number,
      number,
    ];
    this.updateSettings((draft) => {
      draft.neutral = { bs, head, capturedAt: new Date().toISOString() };
    });
    this.notify('info', `Neutral face captured from ${frames.length} frames.`);
  }

  clearNeutral(): void {
    this.updateSettings((draft) => {
      draft.neutral = null;
    });
  }

  /** Walk the performer through turn, tilt, nod, and eyes; fix whatever this source reports backwards. */
  async checkDirections(): Promise<void> {
    if (this.busyWithCalibration()) return;
    const source = this.activeSource;
    const samples = {} as Record<StepId, Sample>;
    for (const [index, step] of STEPS.entries()) {
      for (let secondsLeft = index === 0 ? 3 : 2; secondsLeft > 0; secondsLeft--) {
        this.set({ directions: { phase: 'step', index, total: STEPS.length, prompt: step.prompt, secondsLeft, capturing: false } });
        await sleep(1000);
      }
      this.set({ directions: { phase: 'step', index, total: STEPS.length, prompt: step.prompt, secondsLeft: 0, capturing: true } });
      const sample = sampleOf(await this.collect(1000));
      if (!sample) {
        this.set({ directions: { phase: 'idle' } });
        this.notify('error', `No face data from the ${SOURCE_NAMES[source]} during "${step.prompt}" Check it's tracking and try again.`);
        return;
      }
      samples[step.id] = sample;
    }
    this.set({ directions: { phase: 'idle' } });
    const current = this.snapshot.config?.orientation[source] ?? IDENTITY_ORIENTATION;
    const { fix, findings } = solveDirections(current, samples);
    await this.attempt(() => api('PUT', '/api/config', { orientation: { [source]: fix } }));
    const summary = (Object.entries(findings) as [string, Finding][]).map(([axis, f]) => `${axis} ${FINDING_TEXT[f]}`).join(', ');
    const unclear = Object.values(findings).includes('unclear');
    this.notify(
      unclear ? 'error' : 'info',
      `${SOURCE_NAMES[source]} directions: ${summary}.${unclear ? ' Run it again with bigger moves for the unclear ones.' : ''}`,
    );
  }

  // Hub configuration

  async setSource(activeSource: SourceId): Promise<void> {
    await this.attempt(() => api('PUT', '/api/config', { activeSource }));
  }

  async setAudioDevice(audioDevice: string | null): Promise<void> {
    await this.attempt(() => api('PUT', '/api/config', { audioDevice }));
  }

  async setWebcam(changes: Partial<WebcamConfig>): Promise<void> {
    await this.attempt(() => api('PUT', '/api/config', { webcam: changes }));
  }

  async refreshAudioDevices(): Promise<void> {
    const devices = await this.attempt(() => api<AudioSource[]>('GET', '/api/audio/devices'));
    if (devices) this.set({ audioDevices: devices });
  }

  async refreshCameraDevices(): Promise<void> {
    const devices = await this.attempt(() => api<CameraDevice[]>('GET', '/api/camera/devices'));
    if (devices) this.set({ cameraDevices: devices });
  }

  async cameraControls(): Promise<CameraControls | undefined> {
    try {
      return await api<CameraControls>('GET', '/api/camera/controls');
    } catch {
      return undefined; // the camera isn't running (or is a file); the controls just hide
    }
  }

  async setCameraControls(values: Record<string, number>): Promise<CameraControls | undefined> {
    return this.attempt(() => api<CameraControls>('PUT', '/api/camera/controls', values));
  }

  // Recording

  async startRecording(): Promise<void> {
    await this.attempt(() => api('POST', '/api/record/start', {}));
  }

  async stopRecording(): Promise<void> {
    const meta = await this.attempt(() => api<{ name: string; duration: number }>('POST', '/api/record/stop'));
    if (meta) this.notify('info', `Saved "${meta.name}" (${meta.duration.toFixed(1)} s).`);
  }

  // Takes

  async openTake(take: TakeSummary): Promise<void> {
    this.set({ loadingTake: take.id });
    const player = await this.attempt(() => Player.load(take));
    this.set({ loadingTake: null });
    if (!player) return;
    this.closeTake();
    this.player = player;
    this.drivers.forEach((driver) => driver.reset());
    this.publishPlayer();
    this.publishSources(clock());
    if (!this.exportAbort) this.set({ exporting: null });
    void this.refreshExports();
  }

  closeTake(): void {
    this.player?.dispose();
    this.player = null;
    this.drivers.forEach((driver) => driver.reset());
    this.set({ player: null });
  }

  private publishPlayer(): void {
    const p = this.player;
    this.set({
      player: p && {
        take: p.take,
        primary: p.primary,
        playing: p.playing,
        position: p.position,
        duration: p.duration,
        syncOffset: p.syncOffset,
      },
    });
  }

  togglePlay(): void {
    this.player?.toggle();
    this.publishPlayer();
  }

  seek(seconds: number): void {
    this.player?.seek(seconds);
    this.publishPlayer();
  }

  async setSyncOffset(seconds: number): Promise<void> {
    const player = this.player;
    if (!player) return;
    const offset = Math.round(Math.max(-2, Math.min(2, seconds)) * 1000) / 1000;
    player.syncOffset = offset;
    this.publishPlayer();
    await this.attempt(() => api('PATCH', `/api/takes/${player.take.id}`, { syncOffset: offset }));
  }

  async autoSync(): Promise<void> {
    const player = this.player;
    const track = player?.primaryTrack;
    if (!player?.take.audio || !track) {
      this.notify('error', 'This take has no audio to sync against.');
      return;
    }
    const result = await this.attempt(async () => {
      const bytes = await (await fetch(`/api/takes/${player.take.id}/audio.wav`)).arrayBuffer();
      const context = new OfflineAudioContext(1, 1, 48000);
      const audio = await context.decodeAudioData(bytes);
      const jaw = track.frames.map((frame) => (frame.face ? frame.bs[BS.jawOpen] : 0));
      return estimateSyncOffset(audio.getChannelData(0), audio.sampleRate, track.times, jaw, player.take.audio!.startOffset);
    });
    if (!result) return;
    const match = `match ${result.correlation.toFixed(2)}, margin ${result.margin.toFixed(2)}`;
    if (!result.reliable) {
      this.notify('error', `No clear match (${match}). Auto-sync needs a take with a few seconds of speech.`);
      return;
    }
    await this.setSyncOffset(result.offset);
    this.notify('info', `Face data runs ${Math.round(result.offset * 1000)} ms behind the voice. Applied (${match}).`);
  }

  // Export

  async refreshExports(): Promise<void> {
    const take = this.player?.take.id;
    const files = await this.attempt(() => api<ExportFile[]>('GET', take ? `/api/exports?take=${take}` : '/api/exports'));
    if (files) this.set({ exports: files });
  }

  /** Render the open take to MP4 in each chosen format; the hub adds the voice and saves the files. */
  async exportTake(options: { views: ViewId[]; fps: number; quality: ExportQuality }): Promise<void> {
    const player = this.player;
    const track = player?.primaryTrack;
    if (!player || !track || this.exportAbort) return;
    player.pause();
    this.publishPlayer();
    const abort = new AbortController();
    this.exportAbort = abort;
    const startedAt = clock();
    let lastPublish = 0;
    this.set({ exporting: { phase: 'rendering', done: 0, total: 1, startedAt } });
    try {
      const rendered = await renderTake({
        take: player.take,
        frames: track.frames,
        settings: this.snapshot.settings,
        syncOffset: player.syncOffset,
        views: options.views,
        fps: options.fps,
        quality: options.quality,
        signal: abort.signal,
        onProgress: (done, total) => {
          if (clock() - lastPublish < 0.2 && done < total) return;
          lastPublish = clock();
          this.set({ exporting: { phase: 'rendering', done, total, startedAt } });
        },
      });
      this.set({ exporting: { phase: 'saving', startedAt } });
      const files: ExportFile[] = [];
      for (const result of rendered) {
        const response = await fetch(`/api/takes/${player.take.id}/export?view=${result.view}&codec=${result.codec}`, {
          method: 'POST',
          headers: { 'Content-Type': 'video/mp4' },
          body: new Blob([result.data], { type: 'video/mp4' }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? `saving failed (${response.status})`);
        files.push(body as ExportFile);
      }
      this.set({ exporting: { phase: 'done', files, seconds: clock() - startedAt } });
      this.notify('info', `Exported ${files.length === 1 ? files[0].file : `${files.length} videos`}.`);
      void this.refreshExports();
    } catch (error) {
      if (abort.signal.aborted) this.set({ exporting: { phase: 'canceled' } });
      else this.set({ exporting: { phase: 'error', message: error instanceof Error ? error.message : String(error) } });
    } finally {
      this.exportAbort = null;
    }
  }

  cancelExport(): void {
    this.exportAbort?.abort();
  }

  async renameTake(id: string, name: string): Promise<void> {
    await this.attempt(() => api('PATCH', `/api/takes/${id}`, { name }));
  }

  async deleteTake(id: string): Promise<void> {
    if (this.player?.take.id === id) this.closeTake();
    await this.attempt(() => api('DELETE', `/api/takes/${id}`));
  }
}

export const store = new StudioStore();
