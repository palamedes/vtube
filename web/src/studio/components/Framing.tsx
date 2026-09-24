import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraControls } from '../../shared/protocol';
import { cameraAdvice, restAngleAdvice, TARGET, type Advice } from '../framing';
import { store } from '../store';
import { useStudio, useTick } from '../useStudio';
import { CharacterView } from './CharacterView';
import { Slider, Toggle } from './controls';

const MODES = [
  { label: '1280 × 720 at 60 fps (recommended)', width: 1280, height: 720, fps: 60 },
  { label: '1920 × 1080 at 60 fps', width: 1920, height: 1080, fps: 60 },
  { label: '1280 × 720 at 30 fps', width: 1280, height: 720, fps: 30 },
];

// Target zone for the face box, in image coordinates: centered, eyes a little above the middle.
const ZONE_CENTER_Y = 0.42;
const FACE_ASPECT = 0.78; // face width / height

function zoneRect(faceHeight: number, aspect: number) {
  const w = faceHeight * FACE_ASPECT * aspect;
  return { x: 0.5 - w / 2, y: ZONE_CENTER_Y - faceHeight / 2, width: w, height: faceHeight };
}

function AdviceList({ advice }: { advice: Advice[] }) {
  return (
    <ul className="advice">
      {advice.map((item) => (
        <li key={item.text} className={item.ok ? 'ok' : 'fix'}>
          {item.text}
        </li>
      ))}
    </ul>
  );
}

function useThrottled<T>(read: () => T, interval = 250): T {
  const [value, setValue] = useState(read);
  const last = useRef(0);
  useTick(
    useCallback(
      (now: number) => {
        if (now - last.current < interval / 1000) return;
        last.current = now;
        setValue(read());
      },
      [read, interval],
    ),
  );
  return value;
}

function CameraControlsPanel() {
  const { config, status, cameraDevices } = useStudio();
  const [controls, setControls] = useState<CameraControls | undefined>();
  const pending = useRef<Record<string, number>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const running = status?.webcam.running ?? false;
  const device = status?.webcam.device ?? '';
  const hasControls = running && device.startsWith('/dev/'); // a video file (testing) has none

  useEffect(() => {
    void store.refreshCameraDevices();
  }, []);
  useEffect(() => {
    if (hasControls) void store.cameraControls().then(setControls);
    else setControls(undefined);
  }, [hasControls, device]);

  const change = (name: string, value: number) => {
    setControls((current) => current && { ...current, [name]: { ...current[name as keyof CameraControls]!, value } });
    pending.current[name] = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const values = pending.current;
      pending.current = {};
      void store.setCameraControls(values).then((fresh) => fresh && setControls(fresh));
    }, 150);
  };

  const cam = config?.webcam;
  const mode = MODES.findIndex((m) => m.width === cam?.width && m.height === cam?.height && m.fps === cam?.fps);
  const zoom = controls?.zoom_absolute;
  const pan = controls?.pan_absolute;
  const tilt = controls?.tilt_absolute;
  const lowLight = controls?.exposure_dynamic_framerate;
  const brightness = controls?.brightness;

  return (
    <div className="framing-controls">
      <label className="field">
        <span>Camera</span>
        <select value={cam?.device ?? ''} onChange={(e) => void store.setWebcam({ device: e.target.value || null })}>
          <option value="">First camera found</option>
          {cameraDevices.map((device) => (
            <option key={device.device} value={device.device}>
              {device.name} ({device.device})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Mode</span>
        <select
          value={mode}
          onChange={(e) => {
            const m = MODES[Number(e.target.value)];
            void store.setWebcam({ width: m.width, height: m.height, fps: m.fps });
          }}
        >
          {mode < 0 && <option value={-1}>{`${cam?.width} × ${cam?.height} at ${cam?.fps} fps`}</option>}
          {MODES.map((m, i) => (
            <option key={m.label} value={i}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {zoom && (
        <Slider
          label="Zoom"
          value={zoom.value}
          defaultValue={zoom.default}
          min={zoom.min}
          max={zoom.max}
          step={zoom.step}
          format={(v) => `${(v / 100).toFixed(2)}×`}
          hint="Digital zoom on the camera's 4K sensor: tighter framing without losing tracking detail"
          onChange={(v) => change('zoom_absolute', v)}
        />
      )}
      {pan && tilt && (
        <>
          <Slider
            label="Pan (when zoomed)"
            value={pan.value}
            defaultValue={pan.default}
            min={pan.min}
            max={pan.max}
            step={pan.step}
            format={(v) => `${Math.round(v / 3600)}°`}
            onChange={(v) => change('pan_absolute', v)}
          />
          <Slider
            label="Tilt (when zoomed)"
            value={tilt.value}
            defaultValue={tilt.default}
            min={tilt.min}
            max={tilt.max}
            step={tilt.step}
            format={(v) => `${Math.round(v / 3600)}°`}
            onChange={(v) => change('tilt_absolute', v)}
          />
        </>
      )}
      {brightness && (
        <Slider
          label="Brightness"
          value={brightness.value}
          defaultValue={brightness.default}
          min={brightness.min}
          max={brightness.max}
          step={brightness.step}
          format={(v) => String(Math.round(v))}
          onChange={(v) => change('brightness', v)}
        />
      )}
      {lowLight && (
        <Toggle
          label="Slow down in low light (off keeps 60 fps)"
          checked={lowLight.value === 1}
          hint="When on, the camera lowers its frame rate in dim light to brighten the picture; tracking gets choppier"
          onChange={(v) => change('exposure_dynamic_framerate', v ? 1 : 0)}
        />
      )}
      {(zoom || pan) && (
        <div className="button-row">
          <button
            type="button"
            onClick={() => {
              for (const [name, control] of Object.entries(controls ?? {})) {
                if (name !== 'brightness' && name !== 'exposure_dynamic_framerate') change(name, control.default);
              }
            }}
          >
            Reset zoom and pan
          </button>
        </div>
      )}
      <Toggle
        label="Keep camera tracking while the iPhone is active (for Compare)"
        checked={cam?.keepRunning ?? false}
        onChange={(v) => void store.setWebcam({ keepRunning: v })}
      />
      {!running && status?.webcam.error && <p className="help small error-text">{status.webcam.error}</p>}
    </div>
  );
}

function CameraFraming() {
  const { status } = useStudio();
  const box = useRef<SVGRectElement>(null);
  const eyes = useRef<SVGLineElement>(null);
  const [mirrored, setMirrored] = useState(() => {
    try {
      return localStorage.getItem('vtube.mirrorPreview') !== 'no';
    } catch {
      return true;
    }
  });
  const webcam = status?.webcam;
  const aspect = webcam?.actual ? webcam.actual.height / webcam.actual.width : 9 / 16;

  useTick(
    useCallback(() => {
      const m = store.camera;
      const rect = box.current;
      const line = eyes.current;
      if (!rect || !line) return;
      const visible = Boolean(m?.face && m.box);
      rect.style.display = visible ? '' : 'none';
      line.style.display = visible ? '' : 'none';
      if (!visible || !m?.box) return;
      const [x0, y0, x1, y1] = m.box;
      rect.setAttribute('x', String(x0));
      rect.setAttribute('y', String(y0));
      rect.setAttribute('width', String(x1 - x0));
      rect.setAttribute('height', String(y1 - y0));
      const good = (m.faceHeight ?? 0) >= TARGET.faceHeight[0] && (m.faceHeight ?? 0) <= TARGET.faceHeight[1];
      rect.setAttribute('class', good ? 'face-box good' : 'face-box');
      line.setAttribute('y1', String(m.eyeY));
      line.setAttribute('y2', String(m.eyeY));
      line.setAttribute('x1', String(x0 - 0.03));
      line.setAttribute('x2', String(x1 + 0.03));
    }, []),
  );

  const expectedFps = webcam?.actual?.fps || 60;
  const advice = useThrottled(useCallback(() => cameraAdvice(store.camera, mirrored, expectedFps), [mirrored, expectedFps]));
  const small = zoneRect(TARGET.faceHeight[0], aspect);
  const large = zoneRect(TARGET.faceHeight[1], aspect);

  return (
    <div className="framing">
      <div className="framing-main">
        <div className="camera-column">
          <div className={`camera-feed ${mirrored ? 'mirrored' : ''}`}>
            {webcam?.running ? (
              <img src="/api/camera/preview.mjpg" alt="What the camera sees" />
            ) : (
              <div className="camera-off">{webcam?.state === 'starting' ? 'Starting the camera…' : webcam?.error ?? 'Camera is off'}</div>
            )}
            <svg viewBox="0 0 1 1" preserveAspectRatio="none">
              <rect className="zone" {...large} />
              <rect className="zone" {...small} />
              <line className="guide" x1={0.5} x2={0.5} y1={0} y2={1} />
              <rect ref={box} className="face-box" />
              <line ref={eyes} className="eye-line" />
            </svg>
          </div>
          <div className="camera-meta">
            <span>
              {webcam?.actual ? `${webcam.actual.width} × ${webcam.actual.height}` : '—'} · {webcam ? Math.round(webcam.fps) : 0} fps · tracking{' '}
              {webcam ? webcam.inferenceMs.toFixed(1) : '—'} ms/frame
            </span>
            <Toggle
              label="Mirror preview"
              checked={mirrored}
              onChange={(v) => {
                setMirrored(v);
                try {
                  localStorage.setItem('vtube.mirrorPreview', v ? 'yes' : 'no');
                } catch {
                  // not critical
                }
              }}
            />
          </div>
          <p className="help small">
            Dashed boxes: your face box should land between them. Solid box: where the camera finds your face (green when the size is right).
          </p>
        </div>
        <div className="framing-character">
          <CharacterView source="webcam" />
        </div>
      </div>
      <div className="framing-side">
        <h4>Camera check</h4>
        <AdviceList advice={advice} />
        <CameraControlsPanel />
      </div>
    </div>
  );
}

const PHONE_TIPS = [
  'Distance: about 30 to 50 cm (a forearm to an arm away). Face ID\'s sweet spot; closer than 25 cm loses the chin, farther than about 60 cm loses mouth detail.',
  'Height: eye level, or a little below, tipped up slightly toward your face.',
  'Placement: right next to (or just under) your script, so reading keeps your face pointed at the phone.',
  'Keep the mic out of the way: the phone must see your whole mouth and chin. Bring a boom mic in from the side or below.',
  'Portrait or landscape both work; the front sensor just needs a clear view of your face.',
  'Glasses are fine (the sensor sees through clear lenses); tilt them or the lights if you see glare in Live Link Face.',
];

function PhoneFraming() {
  const read = useCallback(() => {
    const raw = store.raw;
    return raw?.face ? restAngleAdvice(raw.head[0], raw.head[1], 'iPhone') : null;
  }, []);
  const live = useThrottled(read, 400);
  return (
    <div className="framing phone">
      <div className="framing-main">
        <div className="phone-tips">
          <h4>Where to put the iPhone</h4>
          <ul>
            {PHONE_TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
          <p className="help small">Live Link Face shows its own camera view with a face mesh: glance at it to confirm the whole face is in frame.</p>
        </div>
        <div className="framing-character">
          <CharacterView source="livelink" />
        </div>
      </div>
      <div className="framing-side">
        <h4>While you look at your script</h4>
        {live ? <AdviceList advice={live} /> : <p className="help">No face from the phone yet.</p>}
        <p className="help small">This reads your head angle as the phone sees it. Check it with your head in its normal reading position.</p>
      </div>
    </div>
  );
}

export function Framing() {
  const { config } = useStudio();
  const active = config?.activeSource;
  if (active === 'webcam') return <CameraFraming />;
  if (active === 'livelink') return <PhoneFraming />;
  return <p className="help framing-empty">Framing applies to the iPhone and the camera. Switch the source to one of them.</p>;
}
