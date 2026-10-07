import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TickLoop, type Clock } from '../src/loop.ts';

/** A manual clock: time moves only when the test says so, and due timers then fire in order. */
class FakeClock implements Clock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(id: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== id);
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }
}

describe('tick loop', () => {
  test('it steps 4 times a second', () => {
    const clock = new FakeClock();
    let steps = 0;
    const loop = new TickLoop(() => steps++, 250, clock);
    loop.start();
    clock.advance(1000);
    assert.equal(steps, 4);
    clock.advance(9000);
    assert.equal(steps, 40);
    loop.stop();
  });

  test('a slow tick is caught up on the next callbacks, without drift', () => {
    const clock = new FakeClock();
    let steps = 0;
    const loop = new TickLoop(
      () => {
        steps++;
        if (steps === 2) clock.t += 600; // one tick takes 600 ms
      },
      250,
      clock,
    );
    loop.start();
    clock.advance(2000);
    assert.equal(steps, 8);
    loop.stop();
  });

  test('stop() cancels the next tick', () => {
    const clock = new FakeClock();
    let steps = 0;
    const loop = new TickLoop(() => steps++, 250, clock);
    loop.start();
    clock.advance(500);
    loop.stop();
    clock.advance(5000);
    assert.equal(steps, 2);
  });

  test('stats report how long ticks take', () => {
    const clock = new FakeClock();
    const loop = new TickLoop(() => (clock.t += 3), 250, clock);
    loop.start();
    clock.advance(25_000);
    loop.stop();
    const s = loop.stats();
    assert.equal(s.ticks, 100);
    assert.equal(s.p50Ms, 3);
    assert.equal(s.p99Ms, 3);
  });

  test('when it falls more than a second behind, it drops the backlog instead of bursting', () => {
    const clock = new FakeClock();
    let steps = 0;
    const loop = new TickLoop(
      () => {
        steps++;
        if (steps === 1) clock.t += 5000; // a 5-second stall
      },
      250,
      clock,
    );
    loop.start();
    clock.advance(5250);
    assert.ok(steps <= 3, `ran ${steps} ticks back to back`);
    assert.equal(loop.stats().skippedTicks > 0, true);
    loop.stop();
  });
});
