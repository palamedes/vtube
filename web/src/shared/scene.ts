/**
 * The scene around the character: where it stands in each output format, the
 * headline, and the background. The Studio preview, the OBS page, and the
 * exporter all place things with the functions here, so what you set up is
 * exactly what gets recorded.
 */

export type ViewId = 'wide' | 'tall';
export type Background = 'set' | 'green' | 'color' | 'transparent';

export const VIEWS: ViewId[] = ['wide', 'tall'];

/** Output size of each view, in pixels. */
export const VIEW_SIZE: Record<ViewId, { width: number; height: number }> = {
  wide: { width: 1920, height: 1080 },
  tall: { width: 1080, height: 1920 },
};

export const VIEW_NAMES: Record<ViewId, string> = { wide: '16:9 · YouTube', tall: '9:16 · Shorts, Reels, TikTok' };

export interface ViewScene {
  /** x: center (share of frame width); y: bottom edge (share of frame height); size: height (share of frame height). */
  character: { x: number; y: number; size: number };
  /** x, y: top-left corner; width: share of frame width; size: headline text height, share of frame width. */
  headline: { show: boolean; x: number; y: number; width: number; size: number };
}

export interface SceneSettings {
  character: string;
  background: Background;
  color: string;
  kicker: string;
  headline: string;
  wide: ViewScene;
  tall: ViewScene;
}

export const DEFAULT_SCENE: SceneSettings = {
  character: 'placeholder',
  background: 'set',
  color: '#1d2b55',
  kicker: 'Tonight',
  headline: 'Your headline goes here',
  wide: {
    character: { x: 0.69, y: 1, size: 0.94 },
    headline: { show: true, x: 0.04, y: 0.74, width: 0.48, size: 0.021 },
  },
  tall: {
    character: { x: 0.5, y: 0.62, size: 0.5625 },
    headline: { show: true, x: 0.06, y: 0.645, width: 0.88, size: 0.05 },
  },
};

const BACKGROUNDS: Background[] = ['set', 'green', 'color', 'transparent'];

/** Fix values that type-check but make no sense (called after the generic settings merge). */
export function sanitizeScene(scene: SceneSettings): SceneSettings {
  const clampView = (view: ViewScene): ViewScene => ({
    character: {
      x: clamp(view.character.x, -0.5, 1.5),
      y: clamp(view.character.y, 0, 2),
      size: clamp(view.character.size, 0.05, 3),
    },
    headline: {
      show: view.headline.show,
      x: clamp(view.headline.x, -0.5, 1),
      y: clamp(view.headline.y, 0, 1),
      width: clamp(view.headline.width, 0.1, 1),
      size: clamp(view.headline.size, 0.005, 0.2),
    },
  });
  return {
    ...scene,
    background: BACKGROUNDS.includes(scene.background) ? scene.background : DEFAULT_SCENE.background,
    color: /^#[0-9a-f]{6}$/i.test(scene.color) ? scene.color : DEFAULT_SCENE.color,
    kicker: scene.kicker.slice(0, 60),
    headline: scene.headline.slice(0, 200),
    wide: clampView(scene.wide),
    tall: clampView(scene.tall),
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The character's square box, in the given frame's pixels. */
export function characterBox(view: ViewScene, width: number, height: number): Box {
  const side = view.character.size * height;
  return { left: view.character.x * width - side / 2, top: view.character.y * height - side, width: side, height: side };
}

export interface HeadlineLayout {
  left: number;
  top: number;
  width: number;
  /** Headline text size in pixels. */
  fontSize: number;
  kickerSize: number;
  /** Width of the colored bar down the left edge. */
  accent: number;
  padding: number;
}

/** Line heights of the headline and the kicker, as multiples of their text size (scene.css uses the same). */
export const LINE_HEIGHT = 1.2;
export const KICKER_LINE_HEIGHT = 1.5;
/** The kicker's letter spacing, as a multiple of its text size. */
export const KICKER_TRACKING = 0.12;

export interface SceneCss {
  character: { left: string; top: string; width: string; height: string };
  headline: {
    left: string;
    top: string;
    width: string;
    padding: string;
    borderLeftWidth: string;
    fontSize: string;
    kickerFontSize: string;
  };
}

/**
 * The same layout as CSS values, for HTML frames. Positions are percentages of
 * the frame; text sizes use container query units (`cqw`), so the frame needs
 * `container-type: size` and the text scales with it exactly as the export does.
 */
export function sceneCss(view: ViewScene, id: ViewId): SceneCss {
  const { width, height } = VIEW_SIZE[id];
  const box = characterBox(view, width, height);
  const text = headlineLayout(view, width, height);
  const x = (px: number) => `${(px / width) * 100}%`;
  const y = (px: number) => `${(px / height) * 100}%`;
  const cq = (px: number) => `${(px / width) * 100}cqw`;
  return {
    character: { left: x(box.left), top: y(box.top), width: x(box.width), height: y(box.height) },
    headline: {
      left: x(text.left),
      top: y(text.top),
      width: x(text.width),
      padding: cq(text.padding),
      borderLeftWidth: cq(text.accent),
      fontSize: cq(text.fontSize),
      kickerFontSize: cq(text.kickerSize),
    },
  };
}

/** The headline box, in the given frame's pixels. Its height follows from the text. */
export function headlineLayout(view: ViewScene, width: number, height: number): HeadlineLayout {
  const fontSize = view.headline.size * width;
  return {
    left: view.headline.x * width,
    top: view.headline.y * height,
    width: view.headline.width * width,
    fontSize,
    kickerSize: fontSize * 0.4,
    accent: Math.max(2, fontSize * 0.12),
    padding: fontSize * 0.45,
  };
}
