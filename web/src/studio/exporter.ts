import { BufferTarget, CanvasSource, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, Quality, type VideoCodec } from 'mediabunny';
import { findCharacter } from '../characters';
import { FaceDriver } from '../shared/driver';
import type { RawFrame, TakeSummary } from '../shared/protocol';
import { characterBox, VIEW_SIZE, type SceneSettings, type ViewId } from '../shared/scene';
import { drawBackground, drawHeadline } from '../shared/sceneDraw';
import type { StudioSettings } from '../shared/settings';
import { Track } from './player';

/**
 * Renders a take to video, frame by frame, in the browser: the face data goes
 * through the same tuning as the live view, the scene is drawn exactly as the
 * Studio lays it out, and WebCodecs encodes it. The result is video only; the
 * hub then adds the take's original voice recording (see hub/exports.py), so
 * the audio is never re-timed or resampled.
 */

export type ExportQuality = 'standard' | 'high';

export interface ExportRequest {
  take: TakeSummary;
  /** The frames of the source to render (usually the take's primary source). */
  frames: RawFrame[];
  settings: StudioSettings;
  /** Face-vs-voice shift in seconds (the player's current value). */
  syncOffset: number;
  views: ViewId[];
  fps: number;
  quality: ExportQuality;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}

export interface RenderedView {
  view: ViewId;
  data: ArrayBuffer;
  codec: VideoCodec;
}

/** How far past its box a character is drawn, as a fraction of the box's size. */
const MARGIN = 0.25;

/** Bits per second at 30 fps; 60 fps gets half again. */
const BITRATE: Record<ExportQuality, number> = { standard: 8_000_000, high: 16_000_000 };

/** How long the export runs: the voice recording when there is one, else the take. */
export function exportDuration(take: TakeSummary): number {
  return take.audio ? take.audio.samples / take.audio.sampleRate : take.duration;
}

/** Which moment of the take's face data belongs at output time `t` (seconds from the start of the audio). */
export function takeTimeAt(t: number, take: TakeSummary, syncOffset: number): number {
  return t + (take.audio?.startOffset ?? 0) + syncOffset;
}

/** Exports can't be transparent (MP4 has no alpha), so a transparent scene exports on green. */
export function exportScene(scene: SceneSettings): SceneSettings {
  return scene.background === 'transparent' ? { ...scene, background: 'green' } : scene;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function renderTake(request: ExportRequest): Promise<RenderedView[]> {
  const { take, settings, views, fps, signal } = request;
  const scene = exportScene(settings.scene);
  const total = Math.max(1, Math.round(exportDuration(take) * fps));
  const bitrate = BITRATE[request.quality] * (fps > 30 ? 1.5 : 1);

  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: 1080, height: 1920, bitrate });
  if (!codec) throw new Error("This browser can't encode video. Try Chrome.");

  // One character instance, rasterized once per frame and drawn into every view.
  const host = document.createElement('div');
  const character = findCharacter(scene.character).create(host);
  character.setOptions({ breathing: settings.motion.breathing });
  const svg = host.querySelector('svg');
  if (!svg) throw new Error("This character can't be exported yet (it isn't drawn as SVG).");
  // The Studio lets a character draw past its box (a raised head, a swinging
  // beard), so rasterize a margin around the box too.
  const { x, y, width, height } = svg.viewBox.baseVal;
  if (width > 0 && height > 0) {
    svg.setAttribute('viewBox', `${x - width * MARGIN} ${y - height * MARGIN} ${width * (1 + 2 * MARGIN)} ${height * (1 + 2 * MARGIN)}`);
  }
  const raster = Math.ceil(
    (1 + 2 * MARGIN) *
      Math.max(...views.map((view) => characterBox(scene[view], VIEW_SIZE[view].width, VIEW_SIZE[view].height).width)),
  );
  svg.setAttribute('width', String(raster));
  svg.setAttribute('height', String(raster));
  const serializer = new XMLSerializer();
  const image = new Image();

  const driver = new FaceDriver(settings);
  const track = new Track(request.frames);

  const outputs = views.map((view) => {
    const { width, height } = VIEW_SIZE[view];
    const canvas = makeCanvas(width, height);
    const background = makeCanvas(width, height);
    drawBackground(background.getContext('2d')!, width, height, scene);
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new CanvasSource(canvas, { codec, quality: new Quality({ bitrate }), keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: fps });
    return { view, canvas, ctx: canvas.getContext('2d')!, background, output, source, box: characterBox(scene[view], width, height) };
  });

  try {
    await Promise.all(outputs.map((o) => o.output.start()));
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException('Export canceled', 'AbortError');
      const t = i / fps;
      track.advance(takeTimeAt(t, take, request.syncOffset), t, driver);
      character.update(driver.update(t), t);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializer.serializeToString(svg))}`;
      await image.decode();
      for (const o of outputs) {
        const { width, height } = VIEW_SIZE[o.view];
        o.ctx.drawImage(o.background, 0, 0);
        const pad = o.box.width * MARGIN;
        o.ctx.drawImage(image, o.box.left - pad, o.box.top - pad, o.box.width + 2 * pad, o.box.height + 2 * pad);
        if (scene[o.view].headline.show) drawHeadline(o.ctx, scene, o.view, width, height);
        await o.source.add(t, 1 / fps);
      }
      if (i % 5 === 0) request.onProgress(i, total);
    }
    for (const o of outputs) o.source.close();
    await Promise.all(outputs.map((o) => o.output.finalize()));
    request.onProgress(total, total);
  } catch (error) {
    await Promise.all(outputs.map((o) => o.output.cancel().catch(() => undefined)));
    throw error;
  } finally {
    character.destroy();
  }
  return outputs.map((o) => ({ view: o.view, data: o.output.target.buffer!, codec }));
}
