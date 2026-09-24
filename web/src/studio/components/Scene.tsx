import { useState } from 'react';
import { CHARACTERS } from '../../characters';
import {
  BUILTIN_LAYOUT,
  cleanPresetName,
  matchingPreset,
  MAX_PRESETS,
  sameView,
  VIEW_NAMES,
  withPreset,
  type Background,
  type ViewId,
  type ViewScene,
} from '../../shared/scene';
import { store } from '../store';
import { useStudio } from '../useStudio';
import { Segmented, Slider, Toggle } from './controls';

const pct = (v: number) => `${Math.round(v * 100)}%`;

function editView(view: ViewId, mutate: (layout: ViewScene) => void) {
  store.updateSettings((settings) => mutate(settings.scene[view]));
}

/** A circle with a slash through it. */
function ResetIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.9 12.1 12.1 3.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Sliders for one format. Vertical sliders run bottom to top, so dragging right
 * moves things up. The dot beside a slider, and the reset button, go back to the
 * layout saved as this format's default; ranges stay relative to the built-in one.
 */
function ViewControls({ view }: { view: ViewId }) {
  const { settings } = useStudio();
  const layout = settings.scene[view];
  const saved = settings.scene.defaults[view];
  const builtin = BUILTIN_LAYOUT[view];
  const isDefault = sameView(layout, saved);
  const relative = (v: number) => `${Math.round((v / builtin.headline.size) * 100)}%`;

  return (
    <div className="scene-view">
      <h4>{VIEW_NAMES[view]}</h4>
      <div className="scene-group">
        Character
        <Toggle label="Show" checked={layout.character.show} onChange={(v) => editView(view, (l) => void (l.character.show = v))} />
      </div>
      <fieldset disabled={!layout.character.show}>
        <Slider
          label="Left ↔ right"
          value={layout.character.x}
          defaultValue={saved.character.x}
          min={0}
          max={1}
          step={0.005}
          format={pct}
          onChange={(v) => editView(view, (l) => void (l.character.x = v))}
        />
        <Slider
          label="Down ↕ up"
          value={1 - layout.character.y}
          defaultValue={1 - saved.character.y}
          min={-0.4}
          max={0.8}
          step={0.005}
          format={pct}
          onChange={(v) => editView(view, (l) => void (l.character.y = 1 - v))}
        />
        <Slider
          label="Size"
          value={layout.character.size}
          defaultValue={saved.character.size}
          min={0.2}
          max={1.6}
          step={0.005}
          format={pct}
          onChange={(v) => editView(view, (l) => void (l.character.size = v))}
        />
      </fieldset>

      <div className="scene-group">
        Headline
        <Toggle label="Show" checked={layout.headline.show} onChange={(v) => editView(view, (l) => void (l.headline.show = v))} />
      </div>
      <fieldset disabled={!layout.headline.show}>
        <Slider
          label="Left ↔ right"
          value={layout.headline.x}
          defaultValue={saved.headline.x}
          min={0}
          max={0.9}
          step={0.005}
          format={pct}
          onChange={(v) => editView(view, (l) => void (l.headline.x = v))}
        />
        <Slider
          label="Down ↕ up"
          value={1 - layout.headline.y}
          defaultValue={1 - saved.headline.y}
          min={0.05}
          max={1}
          step={0.005}
          format={pct}
          onChange={(v) => editView(view, (l) => void (l.headline.y = 1 - v))}
        />
        <Slider
          label="Width"
          value={layout.headline.width}
          defaultValue={saved.headline.width}
          min={0.2}
          max={1}
          step={0.005}
          format={pct}
          onChange={(v) => editView(view, (l) => void (l.headline.width = v))}
        />
        <Slider
          label="Text size"
          value={layout.headline.size}
          defaultValue={saved.headline.size}
          min={builtin.headline.size * 0.4}
          max={builtin.headline.size * 2.5}
          step={builtin.headline.size / 100}
          format={relative}
          onChange={(v) => editView(view, (l) => void (l.headline.size = v))}
        />
      </fieldset>
      <div className="button-row layout-actions">
        <button
          type="button"
          disabled={isDefault}
          title="Make this layout what the reset button (and the dots beside the sliders) go back to"
          onClick={() => store.updateSettings((s) => void (s.scene.defaults[view] = structuredClone(s.scene[view])))}
        >
          {isDefault ? 'Saved as default' : 'Save as default'}
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={isDefault}
          title="Reset to the default layout"
          aria-label={`Reset the ${VIEW_NAMES[view]} layout to its default`}
          onClick={() => editView(view, (l) => Object.assign(l, structuredClone(saved)))}
        >
          <ResetIcon />
        </button>
      </div>
    </div>
  );
}

/** Named layouts covering both formats: click one to use it. */
function Presets() {
  const { settings } = useStudio();
  const { presets } = settings.scene;
  const [name, setName] = useState('');
  const current = matchingPreset(settings.scene);
  const clean = cleanPresetName(name);
  const replacing = presets.some((p) => p.name.toLowerCase() === clean.toLowerCase());
  const full = presets.length >= MAX_PRESETS && !replacing;

  return (
    <div className="field presets">
      <span>Layout presets</span>
      {presets.length === 0 ? (
        <p className="help small">Save where everything sits in both formats under a name, and switch back to it with one click.</p>
      ) : (
        <ul className="preset-list">
          {presets.map((preset) => (
            <li key={preset.name} className={preset.name === current?.name ? 'active' : undefined}>
              <button
                type="button"
                className="preset-name"
                title="Use this layout in both formats"
                onClick={() =>
                  store.updateSettings((s) => {
                    s.scene.wide = structuredClone(preset.wide);
                    s.scene.tall = structuredClone(preset.tall);
                  })
                }
              >
                {preset.name}
              </button>
              <button
                type="button"
                className="icon-button"
                title={`Delete "${preset.name}"`}
                aria-label={`Delete the preset ${preset.name}`}
                onClick={() => {
                  if (confirm(`Delete the layout preset "${preset.name}"?`)) {
                    store.updateSettings((s) => void (s.scene.presets = s.scene.presets.filter((p) => p.name !== preset.name)));
                  }
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="preset-save"
        onSubmit={(event) => {
          event.preventDefault();
          if (!clean || full) return;
          store.updateSettings((s) => void (s.scene.presets = withPreset(s.scene, clean)));
          setName('');
        }}
      >
        <input type="text" value={name} maxLength={40} placeholder="Name this layout" onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!clean || full} title={full ? `Up to ${MAX_PRESETS} presets` : undefined}>
          {replacing ? 'Update' : 'Save'}
        </button>
      </form>
    </div>
  );
}

export function Scene() {
  const { settings } = useStudio();
  const scene = settings.scene;
  const edit = (mutate: (s: typeof scene) => void) => store.updateSettings((draft) => mutate(draft.scene));

  return (
    <div className="scene-panel">
      <div className="scene-shared">
        <label className="field">
          <span>Character</span>
          <select value={scene.character} onChange={(e) => edit((s) => void (s.character = e.target.value))}>
            {CHARACTERS.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Background</span>
          <Segmented<Background>
            value={scene.background}
            onChange={(value) => edit((s) => void (s.background = value))}
            options={[
              { value: 'set', label: 'News set' },
              { value: 'green', label: 'Green', title: 'Chroma green, for keying in an editor' },
              { value: 'color', label: 'Color' },
              { value: 'transparent', label: 'None', title: 'Transparent: for OBS. Exports use green instead.' },
            ]}
          />
          {scene.background === 'color' && (
            <input
              type="color"
              className="color-input"
              value={scene.color}
              onChange={(e) => edit((s) => void (s.color = e.target.value))}
            />
          )}
        </div>
        <label className="field">
          <span>Kicker (the small line above)</span>
          <input
            type="text"
            value={scene.kicker}
            maxLength={60}
            placeholder="Leave empty to hide it"
            onChange={(e) => edit((s) => void (s.kicker = e.target.value))}
          />
        </label>
        <label className="field">
          <span>Headline</span>
          <textarea rows={3} value={scene.headline} maxLength={200} onChange={(e) => edit((s) => void (s.headline = e.target.value))} />
        </label>
        <Presets />
        <p className="help small">The OBS page and exports use this same layout. Each format has its own positions.</p>
      </div>
      <ViewControls view="wide" />
      <ViewControls view="tall" />
    </div>
  );
}
