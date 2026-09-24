import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYOUT,
  characterBox,
  DEFAULT_SCENE,
  headlineLayout,
  matchingPreset,
  sameView,
  sanitizeScene,
  sceneCss,
  VIEW_SIZE,
  VIEWS,
  withPreset,
  type SceneSettings,
} from './scene';
import { mergeSettings } from './settings';

const percent = (value: string) => Number(value.replace('%', '')) / 100;
const cqw = (value: string) => Number(value.replace('cqw', '')) / 100;

describe('scene layout', () => {
  it('stands the character on its bottom edge, centered on x', () => {
    const box = characterBox(DEFAULT_SCENE.wide, 1920, 1080);
    expect(box.width).toBeCloseTo(0.94 * 1080);
    expect(box.height).toBe(box.width);
    expect(box.left + box.width / 2).toBeCloseTo(0.69 * 1920);
    expect(box.top + box.height).toBeCloseTo(1080);
  });

  it('fills the width of the tall format by default', () => {
    const box = characterBox(DEFAULT_SCENE.tall, 1080, 1920);
    expect(box.left).toBeCloseTo(0);
    expect(box.width).toBeCloseTo(1080);
    expect(box.top + box.height).toBeCloseTo(0.62 * 1920);
  });

  it('gives the HTML frames the same geometry the exporter draws', () => {
    const scene: SceneSettings = structuredClone(DEFAULT_SCENE);
    scene.wide.character = { show: true, x: 0.3, y: 0.9, size: 0.7 };
    scene.tall.headline.size = 0.07;
    for (const view of VIEWS) {
      const { width, height } = VIEW_SIZE[view];
      const css = sceneCss(scene[view], view);
      const box = characterBox(scene[view], width, height);
      expect(percent(css.character.left) * width).toBeCloseTo(box.left);
      expect(percent(css.character.top) * height).toBeCloseTo(box.top);
      expect(percent(css.character.width) * width).toBeCloseTo(box.width);
      expect(percent(css.character.height) * height).toBeCloseTo(box.height);

      // Text sizes are container query units: share of the frame's width.
      const text = headlineLayout(scene[view], width, height);
      expect(percent(css.headline.left) * width).toBeCloseTo(text.left);
      expect(percent(css.headline.top) * height).toBeCloseTo(text.top);
      expect(percent(css.headline.width) * width).toBeCloseTo(text.width);
      expect(cqw(css.headline.fontSize) * width).toBeCloseTo(text.fontSize);
      expect(cqw(css.headline.kickerFontSize) * width).toBeCloseTo(text.kickerSize);
      expect(cqw(css.headline.padding) * width).toBeCloseTo(text.padding);
      expect(cqw(css.headline.borderLeftWidth) * width).toBeCloseTo(text.accent);
    }
  });

  it('scales the headline with the frame, so a small preview matches the full-size export', () => {
    const full = headlineLayout(DEFAULT_SCENE.wide, 1920, 1080);
    const preview = headlineLayout(DEFAULT_SCENE.wide, 640, 360);
    expect(preview.fontSize / full.fontSize).toBeCloseTo(1 / 3);
    expect(preview.left / full.left).toBeCloseTo(1 / 3);
    expect(preview.top / full.top).toBeCloseTo(1 / 3);
  });
});

describe('scene settings', () => {
  it('fixes values that make no sense', () => {
    const scene: SceneSettings = structuredClone(DEFAULT_SCENE);
    scene.background = 'plaid' as SceneSettings['background'];
    scene.color = 'red';
    scene.headline = 'x'.repeat(500);
    scene.wide.character.size = 40;
    scene.tall.headline.width = 0;
    const clean = sanitizeScene(scene);
    expect(clean.background).toBe('set');
    expect(clean.color).toBe(DEFAULT_SCENE.color);
    expect(clean.headline).toHaveLength(200);
    expect(clean.wide.character.size).toBe(3);
    expect(clean.tall.headline.width).toBe(0.1);
    expect(clean.wide.headline).toEqual(DEFAULT_SCENE.wide.headline);
  });

  it('fills in a scene for settings saved before scenes existed', () => {
    const settings = mergeSettings({ version: 1, motion: { breathing: false } });
    expect(settings.scene).toEqual(DEFAULT_SCENE);
    expect(settings.motion.breathing).toBe(false);
  });

  it('keeps the parts of a saved scene that are valid', () => {
    const settings = mergeSettings({
      scene: { character: 'mascot', headline: 'Rain again', background: 'green', tall: { headline: { show: false, y: 'low' } } },
    });
    expect(settings.scene.character).toBe('mascot');
    expect(settings.scene.headline).toBe('Rain again');
    expect(settings.scene.background).toBe('green');
    expect(settings.scene.tall.headline.show).toBe(false);
    expect(settings.scene.tall.headline.y).toBe(DEFAULT_SCENE.tall.headline.y);
    expect(settings.scene.wide).toEqual(DEFAULT_SCENE.wide);
  });
});

describe('layout defaults and presets', () => {
  it('fills in defaults, presets, and character visibility for older settings', () => {
    const settings = mergeSettings({ scene: { wide: { character: { x: 0.4 } } } });
    expect(settings.scene.wide.character).toEqual({ ...BUILTIN_LAYOUT.wide.character, x: 0.4 });
    expect(settings.scene.defaults).toEqual(BUILTIN_LAYOUT);
    expect(settings.scene.presets).toEqual([]);
  });

  it('keeps valid presets, fixes their values, and drops the rest', () => {
    const settings = mergeSettings({
      scene: {
        presets: [
          { name: '  News   desk ', wide: { character: { x: 9 } }, tall: {} },
          { name: '', wide: {}, tall: {} },
          { name: 42 },
          'nonsense',
          { name: 'news desk', wide: { headline: { show: false } } },
        ],
      },
    });
    expect(settings.scene.presets).toHaveLength(1);
    const [preset] = settings.scene.presets;
    expect(preset.name).toBe('news desk');
    expect(preset.wide.headline.show).toBe(false);
    expect(preset.wide.character).toEqual(BUILTIN_LAYOUT.wide.character);
    expect(preset.tall).toEqual(BUILTIN_LAYOUT.tall);
  });

  it('ignores presets that are not a list', () => {
    expect(mergeSettings({ scene: { presets: { name: 'x' } } }).scene.presets).toEqual([]);
  });

  it('saves the current layout under a name, replacing one with the same name', () => {
    const scene: SceneSettings = structuredClone(DEFAULT_SCENE);
    scene.presets = withPreset(scene, 'News');
    scene.wide.character.x = 0.3;
    scene.tall.character.show = false;
    scene.presets = withPreset(scene, 'Book reading');
    expect(scene.presets.map((p) => p.name)).toEqual(['News', 'Book reading']);
    expect(matchingPreset(scene)?.name).toBe('Book reading');

    scene.presets = withPreset(scene, 'news');
    expect(scene.presets.map((p) => p.name)).toEqual(['news', 'Book reading']);
    expect(scene.presets[0].wide.character.x).toBe(0.3);
    // Saved presets are copies, not live views of the layout.
    scene.wide.character.x = 0.5;
    expect(scene.presets[0].wide.character.x).toBe(0.3);
    expect(matchingPreset(scene)).toBeNull();
  });

  it('compares layouts to within slider precision', () => {
    const a = structuredClone(BUILTIN_LAYOUT.wide);
    const b = structuredClone(a);
    b.character.x += 1e-6;
    expect(sameView(a, b)).toBe(true);
    b.character.show = false;
    expect(sameView(a, b)).toBe(false);
  });
});
