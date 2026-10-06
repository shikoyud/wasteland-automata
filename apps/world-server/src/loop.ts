/**
 * Runs the simulation at a fixed rate. Deadlines sit on a fixed grid (start + n × interval), so a
 * slow tick is caught up on the next callbacks instead of drifting. More than a second behind,
 * the backlog is dropped: game time stalls rather than fast-forwarding through a burst of ticks.
 */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const WINDOW = 2400; // 10 minutes of 4 Hz ticks
const MAX_LAG_MS = 1000;

export interface TickStats {
  ticks: number;
  skippedTicks: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
}

export class TickLoop {
  private readonly durations = new Float64Array(WINDOW);
  private count = 0;
  private skipped = 0;
  private next = 0;
  private timer: unknown = null;
  private running = false;
  private readonly step: () => void;
  private readonly intervalMs: number;
  private readonly clock: Clock;

  constructor(step: () => void, intervalMs: number, clock: Clock = realClock) {
    this.step = step;
    this.intervalMs = intervalMs;
    this.clock = clock;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.next = this.clock.now() + this.intervalMs;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  stats(): TickStats {
    const n = Math.min(this.count, WINDOW);
    const sorted = Array.from(this.durations.subarray(0, n)).sort((a, b) => a - b);
    const at = (q: number): number => (n ? (sorted[Math.min(n - 1, Math.floor(n * q))] as number) : 0);
    return { ticks: this.count, skippedTicks: this.skipped, p50Ms: at(0.5), p99Ms: at(0.99), maxMs: n ? (sorted[n - 1] as number) : 0 };
  }

  private schedule(): void {
    const delay = Math.max(0, this.next - this.clock.now());
    this.timer = this.clock.setTimeout(() => this.run(), delay);
  }

  private run(): void {
    if (!this.running) return;
    const t0 = this.clock.now();
    this.step();
    const t1 = this.clock.now();
    this.durations[this.count % WINDOW] = t1 - t0;
    this.count++;
    this.next += this.intervalMs;
    const lag = t1 - this.next;
    if (lag > MAX_LAG_MS) {
      const drop = Math.floor(lag / this.intervalMs);
      this.skipped += drop;
      this.next = t1 + this.intervalMs;
    }
    this.schedule();
  }
}
