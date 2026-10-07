/**
 * The authoritative world state and its rules of change. Deterministic: the state after any tick
 * depends only on the seed, the rules and the commands applied before it. Time is the tick counter
 * (4 per second); the server maps ticks to wall-clock time, never the simulation.
 *
 * Commands are applied between ticks (`apply`), and `step()` advances one tick. A replay applies the
 * same commands at the same ticks and reproduces every state hash.
 */
import type { Rules } from '@wa/rules';
import { Hasher } from './hash.ts';
import { generateMap } from './map/generate.ts';
import type { GameMap, Poi } from './map/types.ts';
import { findPath } from './nav/path.ts';
import { Rng } from './rng.ts';
import type { Vec2 } from './types.ts';

export type Gait = 'walk' | 'run';
export type Destination = Vec2 | { poiId: string } | { entityId: string };

export type Command = { type: 'spawn'; name: string } | { type: 'move'; to: Destination; gait?: Gait } | { type: 'stop' };

export type OrderStatus = 'running' | 'done' | 'failed' | 'interrupted';

/** Matches `Order` in openapi.yaml. */
export interface OrderView {
  id: string;
  type: string;
  targetId: string | null;
  status: OrderStatus;
  reason: string | null;
  etaMs: number | null;
}

export interface AgentView {
  id: string;
  name: string;
  state: 'alive';
  pos: Vec2;
  order: OrderView | null;
}

export type FailureCode = 'NO_PATH' | 'NOT_FOUND';

export type Outcome =
  | { ok: true; kind: 'order'; order: OrderView }
  | { ok: true; kind: 'spawned'; agent: AgentView }
  | { ok: false; code: FailureCode; message: string; details?: Record<string, unknown> };

export interface SimEvent {
  seq: number;
  id: string;
  tick: number;
  type: string;
  actorId: string | null;
  targetId: string | null;
  summary: string;
  data: Record<string, unknown>;
}

export interface WorldOptions {
  seed: string;
  rules: Rules;
  /** A pre-generated map for this seed (generated from the seed when omitted). */
  map?: GameMap;
}

interface Movement {
  points: Vec2[];
  cum: number[];
  total: number;
  startTick: number;
  stepM: number;
  etaTicks: number;
  seg: number;
  gait: Gait;
  /** Entity being followed, if any. */
  follow: string | null;
  goal: Vec2;
}

interface Order {
  id: string;
  type: 'move' | 'stop';
  targetId: string | null;
  status: OrderStatus;
  reason: string | null;
  label: string;
  move: Movement | null;
}

interface Agent {
  id: string;
  name: string;
  x: number;
  y: number;
  order: Order | null;
}

const EVENT_RING = 2000;

const fmtPos = (p: Vec2): string => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

export class World {
  readonly seed: string;
  readonly rules: Rules;
  readonly map: GameMap;
  private readonly rng: Rng;
  private readonly tickMs: number;
  private readonly agents = new Map<string, Agent>();
  private readonly agentList: Agent[] = [];
  private readonly events: SimEvent[] = [];
  private tickNo = 0;
  private orderSeq = 0;
  private eventSeq = 0;

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.rules = opts.rules;
    this.map = opts.map ?? generateMap(opts.seed, opts.rules);
    if (this.map.seed !== opts.seed) throw new Error(`Map was generated for seed "${this.map.seed}", not "${opts.seed}"`);
    this.rng = Rng.fromSeed(`world:${opts.seed}`);
    this.tickMs = 1000 / opts.rules.world.tickHz;
  }

  get tick(): number {
    return this.tickNo;
  }

  /** The id of the newest event, or 0 when none happened yet. */
  get lastEventSeq(): number {
    return this.eventSeq;
  }

  apply(agentId: string, command: Command): Outcome {
    if (command.type === 'spawn') return this.spawn(agentId, command.name);
    const agent = this.agents.get(agentId);
    if (!agent) return { ok: false, code: 'NOT_FOUND', message: `No agent ${agentId} in this world.` };
    if (command.type === 'stop') {
      agent.order = { id: this.nextOrderId(), type: 'stop', targetId: null, status: 'done', reason: null, label: 'stop', move: null };
      return { ok: true, kind: 'order', order: this.orderView(agent.order) };
    }
    return this.move(agent, command.to, command.gait ?? (this.rules.movement.defaultGait as Gait));
  }

  step(): void {
    this.tickNo++;
    // Phase 1: every body moves. Phase 2: followers react to where their targets ended up,
    // so the outcome doesn't depend on which agent happens to be updated first.
    const followers: Agent[] = [];
    for (const agent of this.agentList) {
      const o = agent.order;
      if (!o || o.status !== 'running' || !o.move) continue;
      if (this.advance(agent, o, o.move)) followers.push(agent);
    }
    for (const agent of followers) {
      const o = agent.order;
      if (o && o.status === 'running' && o.move) this.follow(agent, o, o.move);
    }
  }

  getAgent(id: string): AgentView | undefined {
    const a = this.agents.get(id);
    return a ? this.agentView(a) : undefined;
  }

  listAgents(): AgentView[] {
    return this.agentList.map((a) => this.agentView(a));
  }

  /** Events newer than `seq`, oldest first (only the last 2,000 are kept). */
  eventsSince(seq: number): SimEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  hash(): string {
    const h = new Hasher().str(this.map.hash).u32(this.tickNo);
    for (const word of this.rng.state()) h.u32(word);
    h.u32(this.orderSeq).u32(this.eventSeq).u32(this.agentList.length);
    for (const a of this.agentList) {
      h.str(a.id).str(a.name).f64(a.x).f64(a.y);
      const o = a.order;
      if (!o) {
        h.u32(0);
        continue;
      }
      h.u32(1).str(o.id).str(o.type).optStr(o.targetId).str(o.status).optStr(o.reason);
      const m = o.move;
      if (!m) {
        h.u32(0);
        continue;
      }
      h.u32(1).u32(m.startTick).u32(m.etaTicks).u32(m.seg).f64(m.stepM).f64(m.total).str(m.gait).optStr(m.follow);
      h.u32(m.points.length);
      for (const p of m.points) h.f64(p.x).f64(p.y);
    }
    h.u32(this.events.length);
    for (const e of this.events) h.u32(e.seq).u32(e.tick).str(e.type).optStr(e.actorId).optStr(e.targetId).str(e.summary);
    return h.digest();
  }

  // ---- commands ----

  private spawn(id: string, name: string): Outcome {
    if (this.agents.has(id)) throw new Error(`Agent ${id} is already in the world`);
    const coasts = this.map.pois.filter((p) => p.kind === 'coast');
    const coast = this.rng.pick(coasts);
    const nav = this.map.nav;
    const region = nav.regionAt(coast.pos.x, coast.pos.y);
    let pos: Vec2 = { ...coast.pos };
    for (let tries = 0; tries < 30; tries++) {
      const dx = this.rng.range(-coast.radiusM, coast.radiusM);
      const dy = this.rng.range(-coast.radiusM, coast.radiusM);
      if (dx * dx + dy * dy > coast.radiusM * coast.radiusM) continue;
      const x = coast.pos.x + dx;
      const y = coast.pos.y + dy;
      if (nav.regionAt(x, y) === region) {
        pos = { x, y };
        break;
      }
    }
    const agent: Agent = { id, name, x: pos.x, y: pos.y, order: null };
    this.agents.set(id, agent);
    this.agentList.push(agent);
    return { ok: true, kind: 'spawned', agent: this.agentView(agent) };
  }

  private move(agent: Agent, to: Destination, gait: Gait): Outcome {
    let goal: Vec2;
    let targetId: string | null = null;
    let follow: string | null = null;
    let label: string;
    if ('poiId' in to) {
      if (to.poiId === 'base' || to.poiId === 'bed') {
        return { ok: false, code: 'NOT_FOUND', message: `You have no ${to.poiId} yet.`, details: { poiId: to.poiId } };
      }
      const poi: Poi | undefined = this.map.pois.find((p) => p.id === to.poiId);
      if (!poi) return { ok: false, code: 'NOT_FOUND', message: `No place called ${to.poiId} on this map. See GET /v1/map.`, details: { poiId: to.poiId } };
      goal = poi.pos;
      targetId = poi.id;
      label = poi.name;
    } else if ('entityId' in to) {
      const target = this.agents.get(to.entityId);
      if (!target) return { ok: false, code: 'NOT_FOUND', message: `Nothing with id ${to.entityId} is in this world.`, details: { entityId: to.entityId } };
      goal = { x: target.x, y: target.y };
      targetId = target.id;
      follow = target.id;
      label = target.name;
    } else {
      goal = { x: to.x, y: to.y };
      label = fmtPos(goal);
    }

    const movement = this.plan(agent, goal, gait, follow);
    if (!movement) {
      return {
        ok: false,
        code: 'NO_PATH',
        message: `No walkable path to ${label}. Water, peaks and cliffs block movement.`,
        details: { to: goal },
      };
    }
    agent.order = { id: this.nextOrderId(), type: 'move', targetId, status: 'running', reason: null, label, move: movement };
    return { ok: true, kind: 'order', order: this.orderView(agent.order) };
  }

  private plan(agent: Agent, goal: Vec2, gait: Gait, follow: string | null): Movement | null {
    const result = findPath(this.map.nav, { x: agent.x, y: agent.y }, goal);
    if (!result.ok) return null;
    const speed = this.rules.movement.gaits.find((g) => g.id === gait)?.speedMps;
    if (speed === undefined) throw new Error(`rules.json has no gait "${gait}"`);
    const stepM = speed / this.rules.world.tickHz;
    const cum = [0];
    for (let i = 1; i < result.points.length; i++) {
      const a = result.points[i - 1] as Vec2;
      const b = result.points[i] as Vec2;
      cum.push((cum[i - 1] as number) + Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)));
    }
    const total = cum[cum.length - 1] as number;
    return {
      points: result.points,
      cum,
      total,
      startTick: this.tickNo,
      stepM,
      etaTicks: Math.max(1, Math.ceil(total / stepM)),
      seg: 0,
      gait,
      follow,
      goal: result.points[result.points.length - 1] as Vec2,
    };
  }

  // ---- ticking ----

  /** Moves the body along its path. Returns true when the order follows an entity (handled in phase 2). */
  private advance(agent: Agent, order: Order, m: Movement): boolean {
    const elapsed = this.tickNo - m.startTick;
    if (elapsed >= m.etaTicks) {
      agent.x = m.goal.x;
      agent.y = m.goal.y;
      if (m.follow === null) this.finish(agent, order, 'done', null);
    } else {
      this.placeAlong(agent, m, elapsed * m.stepM);
    }
    return m.follow !== null;
  }

  /** Ends a follow order next to the target, or re-plans when the target has moved on. */
  private follow(agent: Agent, order: Order, m: Movement): void {
    const target = m.follow === null ? undefined : this.agents.get(m.follow);
    if (!target) {
      this.finish(agent, order, 'failed', 'TARGET_LOST');
      return;
    }
    const near = this.rules.movement.entityArriveWithinM;
    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    if (dx * dx + dy * dy <= near * near) {
      this.finish(agent, order, 'done', null);
      return;
    }
    const elapsed = this.tickNo - m.startTick;
    const gx = target.x - m.goal.x;
    const gy = target.y - m.goal.y;
    const drifted = gx * gx + gy * gy > this.map.nav.cellM * this.map.nav.cellM;
    if (elapsed >= m.etaTicks || (elapsed % this.rules.world.tickHz === 0 && drifted)) {
      const next = this.plan(agent, { x: target.x, y: target.y }, m.gait, m.follow);
      if (next) order.move = next;
      else this.finish(agent, order, 'failed', 'NO_PATH');
    }
  }

  private placeAlong(agent: Agent, m: Movement, d: number): void {
    while (m.seg < m.points.length - 2 && (m.cum[m.seg + 1] as number) <= d) m.seg++;
    const a = m.points[m.seg] as Vec2;
    const b = m.points[m.seg + 1] as Vec2;
    const c0 = m.cum[m.seg] as number;
    const len = (m.cum[m.seg + 1] as number) - c0;
    const t = len > 0 ? (d - c0) / len : 1;
    agent.x = a.x + (b.x - a.x) * t;
    agent.y = a.y + (b.y - a.y) * t;
  }

  private finish(agent: Agent, order: Order, status: OrderStatus, reason: string | null): void {
    order.status = status;
    order.reason = reason;
    order.move = null;
    const here = { x: agent.x, y: agent.y };
    if (status === 'done') {
      this.emit('order_done', agent.id, order.targetId, `Arrived at ${order.label}.`, { orderId: order.id, pos: here });
    } else {
      this.emit('order_failed', agent.id, order.targetId, `Move to ${order.label} stopped: ${reason}.`, { orderId: order.id, reason, pos: here });
    }
  }

  private emit(type: string, actorId: string | null, targetId: string | null, summary: string, data: Record<string, unknown>): void {
    const seq = ++this.eventSeq;
    this.events.push({ seq, id: `e_${seq}`, tick: this.tickNo, type, actorId, targetId, summary: summary.slice(0, 160), data });
    if (this.events.length > EVENT_RING) this.events.splice(0, this.events.length - EVENT_RING);
  }

  // ---- views ----

  private nextOrderId(): string {
    return `o_${++this.orderSeq}`;
  }

  private orderView(o: Order): OrderView {
    let etaMs: number | null = null;
    if (o.type === 'move') {
      etaMs = o.status === 'running' && o.move ? Math.max(0, o.move.etaTicks - (this.tickNo - o.move.startTick)) * this.tickMs : 0;
    }
    return { id: o.id, type: o.type, targetId: o.targetId, status: o.status, reason: o.reason, etaMs };
  }

  private agentView(a: Agent): AgentView {
    return { id: a.id, name: a.name, state: 'alive', pos: { x: a.x, y: a.y }, order: a.order ? this.orderView(a.order) : null };
  }
}
