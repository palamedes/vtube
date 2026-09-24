import { useEffect, useState } from 'react';
import { BottomPanel } from './components/BottomPanel';
import { Section } from './components/controls';
import { Preview } from './components/Preview';
import { Setup } from './components/Setup';
import { Takes } from './components/Takes';
import { TopBar } from './components/TopBar';
import { Tuning } from './components/Tuning';
import { store } from './store';
import { useStudio } from './useStudio';

export function App() {
  const { connected, notice, player } = useStudio();
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.code === 'Space' && player && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) {
        event.preventDefault();
        store.togglePlay();
      }
      if (event.key === 'Escape') setSetupOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  return (
    <div className="app">
      <TopBar onSetup={() => setSetupOpen(true)} />
      {!connected && (
        <div className="banner">
          Can't reach the hub. Start it with <code>./vt</code> from the repo root; this page reconnects on its own.
        </div>
      )}
      <main className="layout">
        <aside className="panel takes-panel">
          <Section title="Takes">
            <Takes />
          </Section>
        </aside>
        <div className="center">
          <Preview />
          <BottomPanel />
        </div>
        <aside className="panel tuning-panel">
          <Tuning />
        </aside>
      </main>
      {notice && <div className={`toast ${notice.kind}`}>{notice.text}</div>}
      {setupOpen && <Setup onClose={() => setSetupOpen(false)} />}
    </div>
  );
}
