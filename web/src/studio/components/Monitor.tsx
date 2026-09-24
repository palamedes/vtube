import { useCallback, useEffect, useRef, useState } from 'react';
import { BS, GROUPS, type BlendshapeGroup } from '../../shared/arkit';
import { SOURCE_NAMES, UNTRACKED } from '../../shared/protocol';
import { store } from '../store';
import { useStudio, useTick } from '../useStudio';

const ROW = 13;
const GROUP_GAP = 18;
const HEADER = 46;
const COLORS: Record<string, string> = {
  eyes: '#7dd3fc',
  brows: '#c4b5fd',
  jaw: '#fda4af',
  mouth: '#fdba74',
  other: '#fde68a',
};
const COLUMNS: BlendshapeGroup[][] = [
  GROUPS.filter((g) => g.id !== 'mouth'),
  GROUPS.filter((g) => g.id === 'mouth'),
];
const HEIGHT = HEADER + Math.max(...COLUMNS.map((col) => col.reduce((h, g) => h + GROUP_GAP + g.names.length * ROW, 0))) + 8;

const deg = (radians: number) => `${((radians * 180) / Math.PI).toFixed(1)}°`;

/**
 * Every channel, live: the thin grey line is the raw value from the phone,
 * the colored bar is what the character receives after tuning. The header
 * shows head angles (raw from the phone vs tuned) and gaze. Channels the
 * source can't track are dimmed.
 */
export function Monitor() {
  const { config, player } = useStudio();
  const source = player?.primary ?? config?.activeSource ?? 'livelink';
  const untracked = UNTRACKED[source];
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    observer.observe(wrap.current!);
    return () => observer.disconnect();
  }, []);

  useTick(
    useCallback(() => {
      const el = canvas.current;
      if (!el) return;
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(width * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(HEIGHT * dpr);
        el.style.width = `${width}px`;
        el.style.height = `${HEIGHT}px`;
      }
      const ctx = el.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, HEIGHT);
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';

      const face = store.driver.face;
      const raw = store.raw;

      // Header: head and gaze.
      ctx.fillStyle = '#9aa0b4';
      const rawHead = raw ? `raw ${raw.head.map((r) => deg(r)).join(' ')}` : 'raw —';
      ctx.fillText(
        `head  yaw ${deg(face.head.yaw)}  pitch ${deg(face.head.pitch)}  roll ${deg(face.head.roll)}   (${rawHead})`,
        8,
        12,
      );
      ctx.fillText(
        `gaze  x ${face.gaze.x.toFixed(2)}  y ${face.gaze.y.toFixed(2)}     face ${face.present ? 'tracked' : 'not tracked'}`,
        8,
        30,
      );

      const colWidth = (width - 16) / 2;
      COLUMNS.forEach((groups, c) => {
        const x0 = 8 + c * (colWidth + 8);
        const labelW = Math.min(132, colWidth * 0.42);
        const barX = x0 + labelW;
        const barW = colWidth - labelW - 40;
        let y = HEADER;
        for (const group of groups) {
          ctx.fillStyle = '#e8e8ee';
          ctx.fillText(group.label.toUpperCase(), x0, y + 8);
          y += GROUP_GAP;
          const color = COLORS[group.id];
          for (const name of group.names) {
            const i = BS[name];
            const value = face.bs[i];
            const dim = untracked.has(name);
            ctx.fillStyle = dim ? '#4f5466' : '#9aa0b4';
            ctx.fillText(name, x0, y + ROW / 2);
            if (dim) {
              ctx.fillStyle = '#1e2029';
              ctx.fillRect(barX, y + 2, barW, ROW - 4);
              y += ROW;
              continue;
            }
            ctx.fillStyle = '#262833';
            ctx.fillRect(barX, y + 2, barW, ROW - 4);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, value * 1.6);
            ctx.fillRect(barX, y + 2, barW * value, ROW - 4);
            ctx.globalAlpha = 1;
            if (raw) {
              ctx.fillStyle = '#e8e8ee';
              ctx.fillRect(barX + barW * Math.min(1, raw.bs[i]) - 1, y + 1, 2, ROW - 2);
            }
            ctx.fillStyle = value > 0.05 ? '#e8e8ee' : '#5d6275';
            ctx.fillText(value.toFixed(2), barX + barW + 6, y + ROW / 2);
            y += ROW;
          }
        }
      });
    }, [width, untracked]),
  );

  return (
    <div className="monitor" ref={wrap}>
      <canvas ref={canvas} />
      <p className="monitor-key">
        <span className="key-raw" /> raw from the source <span className="key-tuned" /> after tuning (what the character gets)
        {untracked.size > 0 &&
          (source === 'voice'
            ? ' · dimmed: the voice source only moves the mouth, blinks, and brows'
            : ` · dimmed: the ${SOURCE_NAMES[source]} can't track these (the iPhone can)`)}
      </p>
    </div>
  );
}
