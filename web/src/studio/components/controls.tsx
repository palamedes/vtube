import type { ReactNode } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  format?: (value: number) => string;
  hint?: string;
  onChange: (value: number) => void;
}

export function Slider({ label, value, min, max, step = 0.01, defaultValue, format, hint, onChange }: SliderProps) {
  const changed = defaultValue !== undefined && Math.abs(value - defaultValue) > step / 2;
  return (
    <label className="slider" title={hint}>
      <span className="slider-head">
        <span>{label}</span>
        <span className="slider-value">
          {changed && (
            <button
              type="button"
              className="reset-dot"
              title={`Reset to ${format ? format(defaultValue!) : defaultValue}`}
              onClick={(event) => {
                event.preventDefault();
                onChange(defaultValue!);
              }}
            >
              ●
            </button>
          )}
          {format ? format(value) : value.toFixed(2)}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Toggle({ label, checked, hint, onChange }: { label: string; checked: boolean; hint?: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'active' : ''}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}
