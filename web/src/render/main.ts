/**
 * The page OBS captures.
 *
 *   /render                       the character alone, filling the page, transparent
 *   /render?view=wide|tall        placed as in the Studio's 16:9 or 9:16 scene (size the
 *                                 browser source 1920×1080 or 1080×1920)
 *   &full=1                       the whole scene: background, character, headline
 *   &character=placeholder        override the scene's character
 *   &bg=checker                   show the transparency (for checking in a normal browser)
 *   &hub=ws://127.0.0.1:8750/ws   hub override (default: this page's host)
 *
 * It follows the Studio live: tuning, scene layout, and headline all update as you change them.
 */
import { findCharacter } from '../characters';
import type { CharacterInstance } from '../characters/types';
import { FaceDriver } from '../shared/driver';
import { defaultSocketUrl, HubClient } from '../shared/hubClient';
import { sceneCss, type ViewId } from '../shared/scene';
import '../shared/scene.css';
import { backgroundImage } from '../shared/sceneDraw';
import { mergeSettings, type StudioSettings } from '../shared/settings';
import './render.css';

const params = new URLSearchParams(location.search);
const view: ViewId | null = params.get('view') === 'wide' || params.get('view') === 'tall' ? (params.get('view') as ViewId) : null;
const full = view !== null && params.get('full') === '1';
if (params.get('bg') === 'checker') document.body.classList.add('checker');

const stage = document.getElementById('stage')!;
const holder = document.createElement('div');
holder.className = view ? 'scene-character' : 'fill';
stage.appendChild(holder);
if (view) stage.classList.add('scene-stage');

const headline = document.createElement('div');
headline.className = 'scene-headline';
const kicker = document.createElement('span');
kicker.className = 'kicker';
const headlineText = document.createElement('span');
headline.append(kicker, headlineText);
if (full) stage.appendChild(headline);

const driver = new FaceDriver();
const client = new HubClient(defaultSocketUrl('render'));
const clock = () => performance.now() / 1000;
let character: CharacterInstance | null = null;
let characterId = '';

function showCharacter(id: string): void {
  if (id === characterId && character) return;
  character?.destroy();
  character = findCharacter(id).create(holder);
  characterId = id;
}

function layout(settings: StudioSettings): void {
  if (!view) return;
  const scene = settings.scene;
  const css = sceneCss(scene[view], view);
  Object.assign(holder.style, css.character);
  holder.style.display = scene[view].character.show ? '' : 'none';
  if (!full) return;
  const background = backgroundImage(scene, view);
  stage.style.backgroundImage = background ? `url(${background})` : '';
  stage.style.backgroundSize = '100% 100%';
  headline.style.display = scene[view].headline.show ? '' : 'none';
  Object.assign(headline.style, {
    left: css.headline.left,
    top: css.headline.top,
    width: css.headline.width,
    padding: css.headline.padding,
    borderLeftWidth: css.headline.borderLeftWidth,
    fontSize: css.headline.fontSize,
  });
  kicker.textContent = scene.kicker;
  kicker.style.display = scene.kicker.trim() ? '' : 'none';
  kicker.style.fontSize = css.headline.kickerFontSize;
  headlineText.textContent = scene.headline;
}

// The hub sends every running source (so the Studio can compare them); this
// page follows only the active one.
let activeSource = 'livelink';

function applySettings(raw: unknown): void {
  const settings = mergeSettings(raw);
  driver.setSettings(settings);
  showCharacter(params.get('character') ?? settings.scene.character);
  character!.setOptions({ breathing: settings.motion.breathing });
  layout(settings);
}

showCharacter(params.get('character') ?? 'placeholder');
client.on('hello', (message) => {
  activeSource = message.state.config.activeSource;
  applySettings(message.state.settings);
});
client.on('config', (message) => {
  if (message.config.activeSource !== activeSource) driver.reset();
  activeSource = message.config.activeSource;
});
client.on('settings', (message) => applySettings(message.settings));
client.on('frame', (frame) => {
  if (frame.src === activeSource) driver.push(frame, clock());
});
client.connect();

const tick = () => {
  const now = clock();
  character?.update(driver.update(now), now);
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
