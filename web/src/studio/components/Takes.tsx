import { useState } from 'react';
import type { TakeSummary } from '../../shared/protocol';
import { clockTime, shortDate } from '../format';
import { store } from '../store';
import { useStudio } from '../useStudio';

function TakeRow({ take, open, loading }: { take: TakeSummary; open: boolean; loading: boolean }) {
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
          </span>
        </button>
      )}
      <div className="take-actions">
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
