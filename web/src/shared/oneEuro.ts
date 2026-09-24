/**
 * One Euro filter (Casiez, Roussel, Vogel 2012): heavy smoothing when a value
 * is still, which kills jitter, and light smoothing when it moves fast, which
 * avoids lag. `minCutoff` (Hz) sets the resting smoothness; `beta` sets how
 * quickly it lets go when the value moves.
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private tPrev = 0;

  constructor(
    private minCutoff = 1,
    private beta = 0,
    private readonly dCutoff = 1,
  ) {}

  configure(minCutoff: number, beta: number): void {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.tPrev = t;
      return value;
    }
    const dt = t - this.tPrev;
    if (dt <= 0) return this.x;
    this.tPrev = t;
    const derivative = (value - this.x) / dt;
    this.dx += alpha(dt, this.dCutoff) * (derivative - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(dt, cutoff) * (value - this.x);
    return this.x;
  }
}

function alpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
