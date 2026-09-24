import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubStatus, SourceId } from '../../shared/protocol';
import { clockTime } from '../format';
import { store } from '../store';
import { useStudio, useTick } from '../useStudio';
import { Segmented } from './controls';

function MicMeter() {
  const bar = useRef<HTMLDivElement>(null);
  const peak = useRef<HTMLDivElement>(null);
  useTick(
    useCallback(() => {
      const { rms, peak: peakDb } = store.level;
      const toPct = (db: number) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      if (bar.current) {
        bar.current.style.width = `${toPct(rms)}%`;
        bar.current.classList.toggle('hot', peakDb > -3);
      }
      if (peak.current) peak.current.style.left = `${toPct(peakDb)}%`;
    }, []),
  );
  return (
    <div className="meter" title="Microphone level (peak marker turns the bar red near clipping)">
      <div className="meter-fill" ref={bar} />
      <div className="meter-peak" ref={peak} />
    </div>
  );
}

function RecordButton() {
  const { recording, connected } = useStudio();
  const [, force] = useState(0);
  useEffect(() => {
    if (!recording.active) return;
    const id = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [recording.active]);
  if (recording.active) {
    const elapsed = recording.startedLocal !== undefined ? performance.now() / 1000 - recording.startedLocal : recording.elapsed ?? 0;
    return (
      <button type="button" className="record active" onClick={() => void store.stopRecording()}>
        ■ Stop <span className="record-time">{clockTime(elapsed)}</span>
      </button>
    );
  }
  return (
    <button type="button" className="record" disabled={!connected} onClick={() => void store.startRecording()}>
      ● Record
    </button>
  );
}

/** A short health summary for the active source: [state for color, text, tooltip]. */
function sourceHealth(source: SourceId, status: HubStatus | null): [string, string, string] {
  if (!status) return ['unknown', '…', ''];
  if (source === 'livelink') {
    const link = status.livelink;
    if (link.faceDetected) return ['ok', `iPhone: ${link.packetsPerSec} fps`, `From ${link.subject} at ${link.sender}`];
    if (link.receiving) return ['warn', 'iPhone: connected, no face', 'Packets are arriving, but the phone sees no face'];
    if (link.bindError) return ['off', 'iPhone: port busy', link.bindError];
    return ['off', 'iPhone: waiting', 'No packets yet; open Setup for the steps'];
  }
  if (source === 'webcam') {
    const cam = status.webcam;
    if (cam.state === 'error') return ['off', 'Camera: error', cam.error ?? ''];
    if (cam.state === 'starting') return ['warn', 'Camera: starting…', 'The first start downloads the face model (about 4 MB)'];
    if (!cam.running) return ['off', 'Camera: off', ''];
    if (cam.faceDetected) return ['ok', `Camera: ${Math.round(cam.fps)} fps`, `${cam.device}, tracking ${cam.inferenceMs} ms/frame`];
    return ['warn', 'Camera: no face', 'The camera is running but finds no face'];
  }
  return status.simulator.running ? ['ok', 'Simulator: running', ''] : ['off', 'Simulator: off', ''];
}

export function TopBar({ onSetup }: { onSetup: () => void }) {
  const { connected, config, status, audioDevices } = useStudio();
  const active = config?.activeSource ?? 'livelink';
  const [health, healthText, healthTitle] = sourceHealth(active, status);
  const audio = status?.audio;

  return (
    <header className="topbar">
      <div className="brand">
        vtube <span>studio</span>
      </div>
      <span className={`hub-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Connected to the hub' : 'Hub not reachable'} />

      <div className="topbar-group">
        <span className="label">Source</span>
        <Segmented<SourceId>
          value={active}
          onChange={(value) => void store.setSource(value)}
          options={[
            { value: 'livelink', label: 'iPhone', title: 'Live Link Face on your phone (best mouth detail)' },
            { value: 'webcam', label: 'Camera', title: 'Your webcam, tracked on this PC with MediaPipe' },
            { value: 'simulator', label: 'Simulator', title: 'A synthetic performer, for testing without a face' },
          ]}
        />
        <button
          type="button"
          className={`status-chip ${health}`}
          title={healthTitle}
          onClick={() => (active === 'livelink' ? onSetup() : store.setLayout('framing'))}
        >
          {healthText}
        </button>
      </div>

      <div className="topbar-group mic">
        <span className="label">Mic</span>
        <select
          value={config?.audioDevice ?? ''}
          onChange={(e) => void store.setAudioDevice(e.target.value || null)}
          onFocus={() => void store.refreshAudioDevices()}
          title={audio?.error ?? audio?.resolvedDevice ?? ''}
        >
          <option value="">System default{audio?.resolvedDevice && !config?.audioDevice ? ` (${shortDevice(audio.resolvedDevice, audioDevices)})` : ''}</option>
          {audioDevices.map((device) => (
            <option key={device.name} value={device.name}>
              {device.monitor ? '↺ ' : ''}
              {device.description}
            </option>
          ))}
        </select>
        {audio && !audio.running ? <span className="status-chip off" title={audio.error ?? ''}>{audio.disabled ? 'audio off' : 'no audio'}</span> : <MicMeter />}
      </div>

      <div className="topbar-spacer" />
      <RecordButton />
      <button type="button" onClick={onSetup}>
        Setup
      </button>
    </header>
  );
}

function shortDevice(name: string, devices: { name: string; description: string }[]): string {
  return devices.find((d) => d.name === name)?.description ?? name;
}
