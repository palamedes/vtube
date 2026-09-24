import { CHARACTERS } from '../../characters';
import { DEFAULT_SCENE, VIEW_NAMES, type Background, type ViewId, type ViewScene } from '../../shared/scene';
import { store } from '../store';
import { useStudio } from '../useStudio';
import { Segmented, Slider, Toggle } from './controls';

const pct = (v: number) => `${Math.round(v * 100)}%`;

function editView(view: ViewId, mutate: (layout: ViewScene) => void) {
  store.updateSettings((settings) => mutate(settings.scene[view]));
}

/** Sliders for one format. Vertical sliders run bottom to top, so dragging right moves things up. */
function ViewControls({ view }: { view: ViewId }) {
  const { settings } = useStudio();
  const layout = settings.scene[view];
  const base = DEFAULT_SCENE[view];
  const relative = (v: number) => `${Math.round((v / base.headline.size) * 100)}%`;

  return (
    <div className="scene-view">
      <h4>{VIEW_NAMES[view]}</h4>
      <div className="scene-group">Character</div>
      <Slider
        label="Left ↔ right"
        value={layout.character.x}
        defaultValue={base.character.x}
        min={0}
        max={1}
        step={0.005}
        format={pct}
        onChange={(v) => editView(view, (l) => void (l.character.x = v))}
      />
      <Slider
        label="Down ↕ up"
        value={1 - layout.character.y}
        defaultValue={1 - base.character.y}
        min={-0.4}
        max={0.8}
        step={0.005}
        format={pct}
        onChange={(v) => editView(view, (l) => void (l.character.y = 1 - v))}
      />
      <Slider
        label="Size"
        value={layout.character.size}
        defaultValue={base.character.size}
        min={0.2}
        max={1.6}
        step={0.005}
        format={pct}
        onChange={(v) => editView(view, (l) => void (l.character.size = v))}
      />

      <div className="scene-group">
        Headline
        <Toggle label="Show" checked={layout.headline.show} onChange={(v) => editView(view, (l) => void (l.headline.show = v))} />
      </div>
      <fieldset disabled={!layout.headline.show}>
        <Slider
          label="Left ↔ right"
          value={layout.headline.x}
          defaultValue={base.headline.x}
          min={0}
          max={0.9}
          step={0.005}
          format={pct}
          onChange={(v) => editView(view, (l) => void (l.headline.x = v))}
        />
        <Slider
          label="Down ↕ up"
          value={1 - layout.headline.y}
          defaultValue={1 - base.headline.y}
          min={0.05}
          max={1}
          step={0.005}
          format={pct}
          onChange={(v) => editView(view, (l) => void (l.headline.y = 1 - v))}
        />
        <Slider
          label="Width"
          value={layout.headline.width}
          defaultValue={base.headline.width}
          min={0.2}
          max={1}
          step={0.005}
          format={pct}
          onChange={(v) => editView(view, (l) => void (l.headline.width = v))}
        />
        <Slider
          label="Text size"
          value={layout.headline.size}
          defaultValue={base.headline.size}
          min={base.headline.size * 0.4}
          max={base.headline.size * 2.5}
          step={base.headline.size / 100}
          format={relative}
          onChange={(v) => editView(view, (l) => void (l.headline.size = v))}
        />
      </fieldset>
      <div className="button-row">
        <button type="button" onClick={() => editView(view, (l) => Object.assign(l, structuredClone(base)))}>
          Reset this layout
        </button>
      </div>
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
        <p className="help small">The OBS page and exports use this same layout. Each format below has its own positions.</p>
      </div>
      <ViewControls view="wide" />
      <ViewControls view="tall" />
    </div>
  );
}
