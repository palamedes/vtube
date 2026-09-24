import { SOURCE_NAMES, type SourceId } from '../../shared/protocol';
import { backgroundImage } from '../../shared/sceneDraw';
import { clockTime, signedMs } from '../format';
import { store, type Layout } from '../store';
import { useStudio } from '../useStudio';
import { CharacterView } from './CharacterView';
import { Segmented } from './controls';
import { Framing } from './Framing';
import { SceneFrame } from './SceneFrame';

function Compare() {
  const { sources, player, config, settings } = useStudio();
  const order: SourceId[] = ['livelink', 'webcam', 'simulator', 'voice'];
  const shown = order.filter((source) => sources.includes(source));
  if (shown.length < 2) {
    return (
      <div className="compare-empty">
        <p>
          <strong>Compare</strong> shows the same performance driven by two trackers side by side. It needs two sources at once:
          right now {shown.length === 1 ? `only the ${SOURCE_NAMES[shown[0]]} is` : 'nothing is'} sending a face.
        </p>
        {!player && (
          <p className="help">
            Keep the camera tracking while the iPhone is active, then start Live Link Face on the phone. Record a take like that and you
            can compare it later too.
            <br />
            <button
              type="button"
              className="primary"
              disabled={config?.webcam.keepRunning}
              onClick={() => void store.setWebcam({ keepRunning: true })}
            >
              {config?.webcam.keepRunning ? 'Camera is kept running' : 'Keep the camera running'}
            </button>
          </p>
        )}
      </div>
    );
  }
  const primary = player?.primary ?? config?.activeSource;
  const background = backgroundImage(settings.scene, 'wide');
  return (
    <>
      {shown.map((source) => (
        <div
          key={source}
          className={`frame square ${background ? '' : 'bg-checker'}`}
          style={background ? { backgroundImage: `url(${background})` } : undefined}
        >
          <CharacterView characterId={settings.scene.character} source={source} />
          <span className="frame-label">
            {SOURCE_NAMES[source]}
            {source === primary ? (player ? ' · recorded live' : ' · live output') : ''}
          </span>
        </div>
      ))}
    </>
  );
}

function PlayerBar() {
  const { player } = useStudio();
  if (!player) return null;
  const nudge = (ms: number) => void store.setSyncOffset(player.syncOffset + ms / 1000);
  return (
    <div className="player-bar">
      <button type="button" className="play" onClick={() => store.togglePlay()} title="Play/pause (Space)">
        {player.playing ? '❚❚' : '▶'}
      </button>
      <span className="time">{clockTime(player.position)}</span>
      <input
        className="scrub"
        type="range"
        min={0}
        max={Math.max(0.1, player.duration)}
        step={0.01}
        value={player.position}
        onChange={(e) => store.seek(Number(e.target.value))}
      />
      <span className="time">{clockTime(player.duration)}</span>
      <div className="sync" title="Shift the face data against the voice. Positive means the face data runs late.">
        <span className="sync-label">Face sync</span>
        <button type="button" onClick={() => nudge(-50)}>−50</button>
        <button type="button" onClick={() => nudge(-10)}>−10</button>
        <span className="sync-value">{signedMs(player.syncOffset)}</span>
        <button type="button" onClick={() => nudge(10)}>+10</button>
        <button type="button" onClick={() => nudge(50)}>+50</button>
        <button type="button" onClick={() => void store.autoSync()} disabled={!player.take.audio}>
          Auto-sync
        </button>
      </div>
      <button type="button" className="to-live" onClick={() => store.closeTake()}>
        Back to live
      </button>
    </div>
  );
}

function Overlay() {
  const { neutral, directions } = useStudio();
  if (neutral.phase !== 'idle') {
    return (
      <div className="capture-overlay">
        <div>
          <strong>{neutral.phase === 'countdown' ? neutral.secondsLeft : 'Hold still…'}</strong>
          <p>Relax your face and look where you'll read from, like you're about to start.</p>
        </div>
      </div>
    );
  }
  if (directions.phase === 'step') {
    return (
      <div className="capture-overlay">
        <div>
          <span className="overlay-step">
            Check directions · step {directions.index + 1} of {directions.total}
          </span>
          <p className="overlay-prompt">{directions.prompt}</p>
          <strong>{directions.capturing ? 'Hold it…' : directions.secondsLeft}</strong>
        </div>
      </div>
    );
  }
  return null;
}

export function Preview() {
  const { player, status, config, layout } = useStudio();
  const live = !player;
  const active = config?.activeSource ?? 'livelink';
  const tracking =
    live &&
    (active === 'simulator'
      ? status?.simulator.running
      : active === 'webcam'
        ? status?.webcam.faceDetected
        : status?.livelink.faceDetected);

  return (
    <div className="preview">
      <div className="preview-toolbar">
        <span className={`mode ${live ? 'live' : 'playback'}`}>
          {live ? (
            <>
              <span className="dot" /> LIVE · {SOURCE_NAMES[active]}
              {!tracking && <span className="mode-note"> (no face, idling)</span>}
            </>
          ) : (
            <>▶ TAKE · {player.take.name}</>
          )}
        </span>
        <Segmented<Layout>
          value={layout}
          onChange={(value) => store.setLayout(value)}
          options={[
            { value: 'wide', label: '16:9' },
            { value: 'tall', label: '9:16' },
            { value: 'both', label: 'Both' },
            { value: 'compare', label: 'Compare', title: 'The same performance from two trackers, side by side' },
            { value: 'framing', label: 'Framing', title: 'Camera view, framing guides, and placement tips' },
          ]}
        />
      </div>
      <div className={`stage layout-${layout}`}>
        {(layout === 'wide' || layout === 'both') && <SceneFrame view="wide" />}
        {(layout === 'tall' || layout === 'both') && <SceneFrame view="tall" />}
        {layout === 'compare' && <Compare />}
        {layout === 'framing' && <Framing />}
        <Overlay />
      </div>
      <PlayerBar />
    </div>
  );
}
