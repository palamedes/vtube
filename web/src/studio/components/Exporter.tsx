import { useEffect } from 'react';
import { VIEW_NAMES, type ViewId } from '../../shared/scene';
import { exportDuration, type ExportQuality } from '../exporter';
import { clockTime } from '../format';
import { store, type ExportFile } from '../store';
import { useStudio } from '../useStudio';
import { Segmented, Toggle } from './controls';

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

function FileList({ files }: { files: ExportFile[] }) {
  if (files.length === 0) return <p className="help small">Nothing exported yet.</p>;
  return (
    <ul className="export-files">
      {files.map((file) => (
        <li key={file.url}>
          <a href={file.url} download={file.file}>
            {file.file}
          </a>
          <span className="help small">
            {mb(file.size)} · {new Date(file.modified * 1000).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Progress() {
  const { exporting } = useStudio();
  if (!exporting) return null;
  if (exporting.phase === 'rendering') {
    const share = exporting.total > 0 ? exporting.done / exporting.total : 0;
    const elapsed = performance.now() / 1000 - exporting.startedAt;
    const left = share > 0.02 ? (elapsed / share) * (1 - share) : null;
    return (
      <div className="export-progress">
        <div className="bar">
          <div className="fill" style={{ width: `${share * 100}%` }} />
        </div>
        <span>
          Rendering frame {exporting.done} of {exporting.total}
          {left !== null && ` · about ${clockTime(left)} left`}
        </span>
        <button type="button" onClick={() => store.cancelExport()}>
          Cancel
        </button>
      </div>
    );
  }
  if (exporting.phase === 'saving') return <p className="help">Adding your voice and saving…</p>;
  if (exporting.phase === 'done') {
    return (
      <div className="export-done">
        <p>
          Done in {clockTime(exporting.seconds)}. Saved to <code>{exporting.files[0]?.path.replace(/\/[^/]+$/, '/')}</code>
        </p>
        <FileList files={exporting.files} />
      </div>
    );
  }
  if (exporting.phase === 'error') return <p className="help error-text">Export failed: {exporting.message}</p>;
  return <p className="help">Export canceled.</p>;
}

export function Exporter() {
  const { player, exporting, exports, settings, exportOptions } = useStudio();
  const { views, quality } = exportOptions;
  const fps = String(exportOptions.fps);
  const busy = exporting?.phase === 'rendering' || exporting?.phase === 'saving';

  useEffect(() => {
    void store.refreshExports();
  }, [player?.take.id]);

  if (!player) {
    return (
      <div className="export-panel">
        <p className="help">
          Open a take from the <strong>Takes</strong> list, then export it here: each format renders to an MP4 with your voice, laid out
          exactly as the preview shows.
        </p>
        <h4>Exports</h4>
        <FileList files={exports} />
      </div>
    );
  }

  const toggle = (view: ViewId, on: boolean) =>
    store.setExportOptions({ views: on ? [...new Set([...views, view])] : views.filter((v) => v !== view) });
  const duration = exportDuration(player.take);

  return (
    <div className="export-panel">
      <div className="export-options">
        <div>
          <h4>{player.take.name}</h4>
          <p className="help small">
            {clockTime(duration)} · {player.primary === 'voice' ? 'mouth from your voice' : `face from the ${player.primary === 'webcam' ? 'camera' : player.primary === 'livelink' ? 'iPhone' : 'simulator'}`}
            {player.syncOffset !== 0 && ` · face sync ${Math.round(player.syncOffset * 1000)} ms`}
            {!player.take.audio && ' · no audio in this take'}
          </p>
        </div>
        <div className="field">
          <span>Formats</span>
          {(['wide', 'tall'] as ViewId[]).map((view) => (
            <Toggle key={view} label={VIEW_NAMES[view]} checked={views.includes(view)} onChange={(on) => toggle(view, on)} />
          ))}
        </div>
        <div className="field">
          <span>Frame rate</span>
          <Segmented
            value={fps}
            onChange={(value) => store.setExportOptions({ fps: Number(value) })}
            options={[
              { value: '30', label: '30 fps' },
              { value: '60', label: '60 fps', title: 'Smoother, bigger files, twice the render time' },
            ]}
          />
        </div>
        <div className="field">
          <span>Quality</span>
          <Segmented<ExportQuality>
            value={quality}
            onChange={(value) => store.setExportOptions({ quality: value })}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'high', label: 'High' },
            ]}
          />
        </div>
        <div className="export-go">
          <button
            type="button"
            className="primary"
            disabled={busy || views.length === 0}
            onClick={() => void store.exportTake(exportOptions)}
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
          <Toggle
            label="Download when done"
            checked={exportOptions.download}
            hint="Also hand the files to the browser, which saves them in its downloads folder"
            onChange={(on) => store.setExportOptions({ download: on })}
          />
          {settings.scene.background === 'transparent' && <p className="help small">Transparent scenes export on green.</p>}
        </div>
      </div>
      <Progress />
      {exporting?.phase !== 'done' && (
        <>
          <h4>Exports of this take</h4>
          <FileList files={exports} />
        </>
      )}
    </div>
  );
}
