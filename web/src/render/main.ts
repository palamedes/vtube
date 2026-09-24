/**
 * The page OBS captures: one character, transparent background, nothing else.
 *
 *   /render?character=placeholder     which character (default: placeholder)
 *   &bg=transparent|checker|#00b140   background (default: transparent)
 *   &hub=ws://127.0.0.1:8750/ws        hub override (default: this page's host)
 *
 * It applies the same tuning the Studio shows, live, as settings change.
 */
import { findCharacter } from '../characters';
import { FaceDriver } from '../shared/driver';
import { defaultSocketUrl, HubClient } from '../shared/hubClient';
import { mergeSettings } from '../shared/settings';
import './render.css';

const params = new URLSearchParams(location.search);
const background = params.get('bg') ?? 'transparent';
if (background === 'checker') document.body.classList.add('checker');
else if (background !== 'transparent') document.body.style.background = background;

const stage = document.getElementById('stage')!;
const character = findCharacter(params.get('character')).create(stage);
const driver = new FaceDriver();
const client = new HubClient(defaultSocketUrl('render'));
const clock = () => performance.now() / 1000;

// The hub sends every running source (so the Studio can compare them); this
// page follows only the active one.
let activeSource = 'livelink';

const applySettings = (raw: unknown) => {
  const settings = mergeSettings(raw);
  driver.setSettings(settings);
  character.setOptions({ breathing: settings.motion.breathing });
};

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
  character.update(driver.update(now), now);
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
