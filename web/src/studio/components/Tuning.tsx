import { SOURCE_NAMES, type Orientation } from '../../shared/protocol';
import { DEFAULT_SETTINGS as D, type StudioSettings } from '../../shared/settings';
import { store } from '../store';
import { useStudio } from '../useStudio';
import { Section, Slider, Toggle } from './controls';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(2)}×`;
const degrees = (v: number) => `${Math.round(v)}°`;

function set(mutate: (draft: StudioSettings) => void) {
  store.updateSettings(mutate);
}

function describeFix(fix: Orientation | undefined): string {
  if (!fix) return 'not checked yet';
  const flips = [
    fix.yaw === -1 && 'turn flipped',
    fix.pitch === -1 && 'nod flipped',
    fix.roll === -1 && 'tilt flipped',
    fix.swapLR && 'left/right swapped',
  ].filter(Boolean);
  return flips.length ? `checked (${flips.join(', ')})` : 'checked, reports correctly';
}

export function Tuning() {
  const { settings: s, neutral, directions, config, player } = useStudio();
  const busy = neutral.phase !== 'idle' || directions.phase !== 'idle';
  const captured = s.neutral ? new Date(s.neutral.capturedAt) : null;
  const source = config?.activeSource ?? 'livelink';

  return (
    <div className="tuning">
      <Section title="Calibrate">
        <p className="help">
          <strong>Check directions</strong> once per source, so turning, tilting, and nodding move the character the right way.{' '}
          <strong>Capture your neutral face</strong> each session, after you settle in, so a relaxed face reads as zero.
        </p>
        <div className="button-row">
          <button type="button" className="primary" disabled={busy || !!player || source === 'voice'} onClick={() => void store.captureNeutral()}>
            {neutral.phase !== 'idle' ? 'Capturing…' : 'Capture neutral face'}
          </button>
          <button type="button" disabled={busy || !!player || source === 'voice'} onClick={() => void store.checkDirections()}>
            {directions.phase !== 'idle' ? 'Checking…' : 'Check directions'}
          </button>
          {s.neutral && (
            <button type="button" disabled={busy} onClick={() => store.clearNeutral()}>
              Clear neutral
            </button>
          )}
        </div>
        <p className="help small">
          Neutral face: {captured ? `captured ${captured.toLocaleString()}` : 'not captured yet (raw values used as-is)'}
          <br />
          {source === 'voice'
            ? 'The voice source needs neither: it has no face to calibrate.'
            : `Directions for the ${SOURCE_NAMES[source]}: ${describeFix(config?.orientation[source])}`}
        </p>
        <Toggle
          label="Mirror (like looking in a mirror)"
          checked={s.mirror}
          hint="Off: your left drives the character's left. On: your left drives the character's right."
          onChange={(v) => set((d) => void (d.mirror = v))}
        />
      </Section>

      <Section title="Head">
        <Slider label="Turn (yaw)" value={s.head.yawGain} defaultValue={D.head.yawGain} min={0} max={3} format={times} onChange={(v) => set((d) => void (d.head.yawGain = v))} />
        <Slider label="Nod (pitch)" value={s.head.pitchGain} defaultValue={D.head.pitchGain} min={0} max={3} format={times} onChange={(v) => set((d) => void (d.head.pitchGain = v))} />
        <Slider label="Tilt (roll)" value={s.head.rollGain} defaultValue={D.head.rollGain} min={0} max={3} format={times} onChange={(v) => set((d) => void (d.head.rollGain = v))} />
        <Slider label="Max angle" value={s.head.maxDegrees} defaultValue={D.head.maxDegrees} min={5} max={60} step={1} format={degrees} onChange={(v) => set((d) => void (d.head.maxDegrees = v))} />
        <Slider
          label="Smoothing"
          value={s.head.smoothing}
          defaultValue={D.head.smoothing}
          min={0}
          max={1}
          format={pct}
          hint="Higher is steadier but lags more"
          onChange={(v) => set((d) => void (d.head.smoothing = v))}
        />
      </Section>

      <Section title="Eyes">
        <Slider
          label="Gaze strength"
          value={s.eyes.gazeStrength}
          defaultValue={D.eyes.gazeStrength}
          min={0}
          max={1}
          format={pct}
          hint="How far the pupils follow your eyes. Keep it low so reading from a script doesn't look shifty."
          onChange={(v) => set((d) => void (d.eyes.gazeStrength = v))}
        />
        <Slider
          label="Blink starts at"
          value={s.eyes.blinkLow}
          defaultValue={D.eyes.blinkLow}
          min={0}
          max={0.9}
          format={pct}
          hint="Below this the lid stays open, so squints don't look like half blinks"
          onChange={(v) => set((d) => void (d.eyes.blinkLow = Math.min(v, d.eyes.blinkHigh - 0.05)))}
        />
        <Slider
          label="Fully closed at"
          value={s.eyes.blinkHigh}
          defaultValue={D.eyes.blinkHigh}
          min={0.1}
          max={1}
          format={pct}
          hint="At or above this the lid shuts completely"
          onChange={(v) => set((d) => void (d.eyes.blinkHigh = Math.max(v, d.eyes.blinkLow + 0.05)))}
        />
        <Slider label="Eye smoothing" value={s.eyes.smoothing} defaultValue={D.eyes.smoothing} min={0} max={1} format={pct} onChange={(v) => set((d) => void (d.eyes.smoothing = v))} />
        <Slider
          label="Blink smoothing"
          value={s.eyes.blinkSmoothing}
          defaultValue={D.eyes.blinkSmoothing}
          min={0}
          max={1}
          format={pct}
          hint="Keep low so blinks stay snappy"
          onChange={(v) => set((d) => void (d.eyes.blinkSmoothing = v))}
        />
      </Section>

      <Section title="Brows">
        <Slider label="Strength" value={s.brows.gain} defaultValue={D.brows.gain} min={0} max={3} format={times} onChange={(v) => set((d) => void (d.brows.gain = v))} />
        <Slider label="Smoothing" value={s.brows.smoothing} defaultValue={D.brows.smoothing} min={0} max={1} format={pct} onChange={(v) => set((d) => void (d.brows.smoothing = v))} />
      </Section>

      <Section title="Mouth">
        <Slider label="Jaw open" value={s.mouth.jawGain} defaultValue={D.mouth.jawGain} min={0} max={5} format={times} onChange={(v) => set((d) => void (d.mouth.jawGain = v))} />
        <Slider label="Smile" value={s.mouth.smileGain} defaultValue={D.mouth.smileGain} min={0} max={5} format={times} onChange={(v) => set((d) => void (d.mouth.smileGain = v))} />
        <Slider
          label="Shapes (oo, pucker, stretch…)"
          value={s.mouth.shapeGain}
          defaultValue={D.mouth.shapeGain}
          min={0}
          max={5}
          format={times}
          onChange={(v) => set((d) => void (d.mouth.shapeGain = v))}
        />
        <Slider
          label="Smoothing"
          value={s.mouth.smoothing}
          defaultValue={D.mouth.smoothing}
          min={0}
          max={1}
          format={pct}
          hint="Keep low: mouths move fast when talking"
          onChange={(v) => set((d) => void (d.mouth.smoothing = v))}
        />
      </Section>

      <Section title="Idle life">
        <Toggle label="Breathing" checked={s.motion.breathing} onChange={(v) => set((d) => void (d.motion.breathing = v))} />
        <Toggle label="Blink on its own when there's no face" checked={s.motion.idleBlinks} onChange={(v) => set((d) => void (d.motion.idleBlinks = v))} />
        <Toggle
          label="Blink on its own while tracking too"
          checked={s.motion.autoBlinks}
          hint="Adds natural blinks on top of yours, for when the tracker misses them"
          onChange={(v) => set((d) => void (d.motion.autoBlinks = v))}
        />
        <Toggle
          label="Blink both eyes together"
          checked={s.eyes.linkBlinks}
          hint="Hides one-eyed flickers; also hides winks"
          onChange={(v) => set((d) => void (d.eyes.linkBlinks = v))}
        />
        <Slider
          label="Body follows head turns"
          value={s.motion.bodyFollow}
          defaultValue={D.motion.bodyFollow}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          hint="When you turn or lean and hold it, the body slowly turns part of the way too; quick glances move only the head"
          onChange={(v) => set((d) => void (d.motion.bodyFollow = v))}
        />
      </Section>

      <div className="button-row end">
        <button
          type="button"
          onClick={() => {
            if (confirm('Reset all tuning to defaults? Your neutral face is kept.')) store.resetSettings();
          }}
        >
          Reset tuning
        </button>
      </div>
    </div>
  );
}
