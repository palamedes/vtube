import { useState } from 'react';
import { Segmented } from './controls';
import { Exporter } from './Exporter';
import { Monitor } from './Monitor';
import { Scene } from './Scene';

type Tab = 'scene' | 'tracking' | 'export';
const TABS: Tab[] = ['scene', 'tracking', 'export'];

function rememberedTab(): Tab {
  try {
    const saved = localStorage.getItem('vtube.bottomTab') as Tab | null;
    return saved && TABS.includes(saved) ? saved : 'scene';
  } catch {
    return 'scene';
  }
}

/** Below the preview: set up the scene, watch the tracking, export takes. */
export function BottomPanel() {
  const [tab, setTab] = useState<Tab>(rememberedTab);
  return (
    <div className="panel bottom-panel">
      <div className="bottom-tabs">
        <Segmented<Tab>
          value={tab}
          onChange={(value) => {
            setTab(value);
            try {
              localStorage.setItem('vtube.bottomTab', value);
            } catch {
              // not critical
            }
          }}
          options={[
            { value: 'scene', label: 'Scene', title: 'Character placement, headline, and background for each format' },
            { value: 'tracking', label: 'Tracking', title: 'Every face channel, raw and tuned' },
            { value: 'export', label: 'Export', title: 'Render a take to MP4 for YouTube and Shorts' },
          ]}
        />
      </div>
      <div className="bottom-body">
        {tab === 'scene' && <Scene />}
        {tab === 'tracking' && <Monitor />}
        {tab === 'export' && <Exporter />}
      </div>
    </div>
  );
}
