import { headlineLayout, KICKER_LINE_HEIGHT, KICKER_TRACKING, LINE_HEIGHT, VIEW_SIZE, type SceneSettings, type ViewId } from './scene';

/**
 * Pixel drawing for scenes: the background and the headline. The exporter
 * draws with these directly; the Studio and the OBS page use the same
 * background image, and mirror the headline's geometry in HTML.
 */

const HEADLINE_BG = 'rgba(8, 12, 28, 0.9)';
const HEADLINE_ACCENT = '#d64545';
const KICKER_COLOR = '#ff8a8a';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number, scene: SceneSettings): void {
  ctx.clearRect(0, 0, width, height);
  if (scene.background === 'transparent') return;
  if (scene.background === 'green' || scene.background === 'color') {
    ctx.fillStyle = scene.background === 'green' ? '#00b140' : scene.color;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  // The news set: a lit backdrop with faint horizontal slats.
  const glow = ctx.createRadialGradient(width * 0.7, height * 0.35, 0, width * 0.7, height * 0.35, Math.hypot(width, height) * 0.62);
  glow.addColorStop(0, '#3566b5');
  glow.addColorStop(0.5, '#1a2c57');
  glow.addColorStop(1, '#0b1328');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  const unit = Math.min(width, height) / 1080;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  for (let y = height; y > 0; y -= 36 * unit) ctx.fillRect(0, y - 2 * unit, width, 2 * unit);
}

const backgroundCache = new Map<string, string>();

/** The background as an image URL for CSS (null when transparent). Cached per look and view. */
export function backgroundImage(scene: SceneSettings, view: ViewId): string | null {
  if (scene.background === 'transparent') return null;
  const key = `${view}:${scene.background}:${scene.color}`;
  let url = backgroundCache.get(key);
  if (!url) {
    const { width, height } = VIEW_SIZE[view];
    const canvas = document.createElement('canvas');
    canvas.width = width / 2;
    canvas.height = height / 2;
    drawBackground(canvas.getContext('2d')!, canvas.width, canvas.height, scene);
    url = canvas.toDataURL('image/png');
    backgroundCache.set(key, url);
  }
  return url;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw the kicker and headline box for one view, at the given output size. */
export function drawHeadline(ctx: CanvasRenderingContext2D, scene: SceneSettings, view: ViewId, width: number, height: number): void {
  const layout = headlineLayout(scene[view], width, height);
  const { fontSize, kickerSize, accent, padding } = layout;
  const textLeft = layout.left + accent + padding;
  const textWidth = layout.width - accent - padding * 2;

  ctx.save();
  ctx.font = `700 ${fontSize}px ${FONT}`;
  const lines = wrap(ctx, scene.headline, textWidth);
  const hasKicker = scene.kicker.trim().length > 0;
  const boxHeight = padding * 2 + (hasKicker ? kickerSize * KICKER_LINE_HEIGHT : 0) + lines.length * fontSize * LINE_HEIGHT;

  ctx.fillStyle = HEADLINE_BG;
  ctx.fillRect(layout.left, layout.top, layout.width, boxHeight);
  ctx.fillStyle = HEADLINE_ACCENT;
  ctx.fillRect(layout.left, layout.top, accent, boxHeight);

  ctx.textBaseline = 'alphabetic';
  let y = layout.top + padding;
  if (hasKicker) {
    ctx.font = `700 ${kickerSize}px ${FONT}`;
    ctx.letterSpacing = `${kickerSize * KICKER_TRACKING}px`;
    ctx.fillStyle = KICKER_COLOR;
    ctx.fillText(scene.kicker.toUpperCase(), textLeft, y + baseline(ctx, kickerSize * KICKER_LINE_HEIGHT));
    ctx.letterSpacing = '0px';
    y += kickerSize * KICKER_LINE_HEIGHT;
  }
  ctx.font = `700 ${fontSize}px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  const lineHeight = fontSize * LINE_HEIGHT;
  for (const line of lines) {
    ctx.fillText(line, textLeft, y + baseline(ctx, lineHeight));
    y += lineHeight;
  }
  ctx.restore();
}

/** Where CSS puts the baseline in a line box: the font's ascent plus half the leading. */
function baseline(ctx: CanvasRenderingContext2D, lineHeight: number): number {
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = ctx.measureText('Hg');
  return (lineHeight - ascent - descent) / 2 + ascent;
}
