import { useState } from 'react';
import type { TakeSummary } from '../../shared/protocol';
import { VIEW_NAMES } from '../../shared/scene';
import { clockTime, shortDate } from '../format';
import { store, type ExportState } from '../store';
import { useStudio } from '../useStudio';

/** What an export of this take is doing, for its row ("" when there's nothing to say). */
function exportNote(state: ExportState | null, take: string): string {
  if (!state || state.take !== take) return '';
  if (state.phase === 'rendering') return ` · exporting ${Math.round((state.done / Math.max(1, state.total)) * 100)}%`;
  if (state.phase === 'saving') return ' · adding your voice…';
  if (state.phase === 'error') return ' · export failed';
  return '';
}

function TakeRow({ take, open, loading }: { take: TakeSummary; open: boolean; loading: boolean }) {
  const { exporting, exportOptions } = useStudio();
  const busy = exporting?.phase === 'rendering' || exporting?.phase === 'saving';
  const mine = busy && exporting?.take === take.id;
  const formats = exportOptions.views.map((view) => VIEW_NAMES[view].split(' · ')[0]).join(' and ');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(take.name);

  const commit = () => {
    setEditing(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== take.name) void store.renameTake(take.id, trimmed);
    else setName(take.name);
  };

  return (
    <li className={`take ${open ? 'open' : ''}`}>
      {editing ? (
        <input
          className="take-name-input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setName(take.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" className="take-main" onClick={() => void store.openTake(take)} title="Open this take">
          <span className="take-name">{take.name}</span>
          <span className="take-meta">
            {shortDate(take.createdAt)} · {clockTime(take.duration)}
            {take.audio ? '' : ' · no audio'}
            {loading ? ' · loading…' : ''}
            {exportNote(exporting, take.id)}
          </span>
          {mine && exporting?.phase === 'rendering' && (
            <span className="take-progress">
              <span style={{ width: `${(exporting.done / Math.max(1, exporting.total)) * 100}%` }} />
            </span>
          )}
        </button>
      )}
      <div className="take-actions">
        {mine ? (
          <button type="button" title="Stop exporting" onClick={() => store.cancelExport()}>
            ■
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || exportOptions.views.length === 0}
            title={`Export as MP4 (${formats}, ${exportOptions.fps} fps) and download it to this computer`}
            onClick={() => void store.downloadTake(take)}
          >
            ⤓
          </button>
        )}
        <button type="button" title="Rename" onClick={() => setEditing(true)}>
          ✎
        </button>
        <button
          type="button"
          title="Delete"
          onClick={() => {
            if (confirm(`Delete "${take.name}"? This removes its audio and face data.`)) void store.deleteTake(take.id);
          }}
        >
          ✕
        </button>
      </div>
    </li>
  );
}

export function Takes() {
  const { takes, player, loadingTake, hub } = useStudio();
  return (
    <div className="takes">
      {takes.length === 0 ? (
        <p className="help">
          No takes yet. Hit <strong>Record</strong> to capture your voice and face data together; takes open here for
          playback and re-tuning.
        </p>
      ) : (
        <ul>
          {takes.map((take) => (
            <TakeRow key={take.id} take={take} open={player?.take.id === take.id} loading={loadingTake === take.id} />
          ))}
        </ul>
      )}
      {hub && <p className="help small">Saved in {hub.dataDir}/takes (outside the repo).</p>}
    </div>
  );
}
