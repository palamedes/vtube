export function clockTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  const rest = s - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function signedMs(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${ms > 0 ? '+' : ''}${ms} ms`;
}
