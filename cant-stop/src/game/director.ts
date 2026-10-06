// Runs a game: applies actions, plays the resulting events one at a time
// (3D + HUD), then drives CPU seats. The HUD only ever sees `shown`, the state
// as of the last finished animation, so it never runs ahead of the mountain.

import {
  personalityFor,
  chooseOption,
  decideStop,
  newMemory,
  updateMemory,
  type CpuMemory,
  type LineKey,
} from "../engine/ai";
import { applyAction, rollDice, type Action, type GameEvent, type GameState, type PlayerInfo } from "../engine/rules";
import { sfx } from "../audio/sfx";
import type { MountainScene } from "../scene/MountainScene";

export interface DirectorView {
  shown: GameState;
  busy: boolean;
  /** Dice currently on the tray; `rollId` bumps on every new roll. */
  dice: { values: GameState["dice"]; rollId: number };
  highlight: number | null;
  bubbles: Record<string, { text: string; id: number }>;
  bust: { player: string; id: number } | null;
  memory: Record<string, CpuMemory>;
  log: { id: number; text: string; player?: string }[];
}

export type Speed = "chill" | "normal" | "fast";
const SPEED: Record<Speed, number> = { chill: 1.3, normal: 1, fast: 0.45 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Director {
  private state: GameState;
  private queue: { events: GameEvent[]; state: GameState }[] = [];
  private pumping = false;
  private disposed = false;
  private cpuPending = false;
  private nextId = 1;
  private listeners = new Set<() => void>();
  private speed: Speed = "normal";
  view: DirectorView;

  constructor(
    initial: GameState,
    private scene: MountainScene,
  ) {
    this.state = initial;
    const memory: Record<string, CpuMemory> = {};
    for (const p of initial.players) if (p.kind === "cpu") memory[p.id] = newMemory();
    this.view = {
      shown: initial,
      busy: false,
      dice: { values: null, rollId: 0 },
      highlight: null,
      bubbles: {},
      bust: null,
      memory,
      log: [],
    };
    scene.setPlayers(initial.players);
    scene.sync(initial);
    this.logLine(`${this.player(initial.players[initial.current]!.id).name} sets off first.`);
    setTimeout(() => this.afterIdle(), 600);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private update(patch: Partial<DirectorView>) {
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn();
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
    this.scene.timeScale = SPEED[speed];
  }

  private ms(base: number) {
    return base * SPEED[this.speed];
  }

  private player(id: string): PlayerInfo {
    return this.state.players.find((p) => p.id === id)!;
  }

  private logLine(text: string, player?: string) {
    const log = [...this.view.log, { id: this.nextId++, text, player }].slice(-60);
    this.update({ log });
  }

  /** Human input. Ignored while animating or when it's a CPU's turn. */
  humanAction(action: { type: "roll" } | { type: "stop" } | { type: "choose"; option: number }) {
    const p = this.state.players[this.state.current]!;
    if (this.view.busy || p.kind !== "human") return;
    this.dispatch(action.type === "roll" ? { type: "roll", dice: rollDice() } : action);
  }

  setHighlight(index: number | null) {
    if (this.view.highlight === index) return;
    this.update({ highlight: index });
    this.scene.preview(index === null ? null : (this.state.options[index] ?? null), this.state);
  }

  private dispatch(action: Action) {
    if (this.disposed) return;
    if (action.type === "choose") {
      const p = this.state.players[this.state.current]!;
      const moves = this.state.options[action.option]?.moves ?? [];
      const route = moves.length === 2 && moves[0] === moves[1] ? `${moves[0]} twice` : moves.join(" & ");
      this.logLine(`🧗 ${p.name} climbs ${route}`, p.id);
    }
    const result = applyAction(this.state, action);
    this.state = result.state;
    this.queue.push(result);
    this.update({ busy: true });
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    while (this.queue.length && !this.disposed) {
      const batch = this.queue.shift()!;
      for (const e of batch.events) {
        if (this.disposed) return;
        await this.play(e);
      }
      if (this.disposed) return;
      this.scene.sync(batch.state);
      this.update({ shown: batch.state, highlight: null });
    }
    this.pumping = false;
    if (this.disposed) return;
    this.update({ busy: false });
    this.afterIdle();
  }

  private say(playerId: string, key: LineKey, chance = 1) {
    const p = this.player(playerId);
    if (p.kind !== "cpu" || Math.random() > chance) return;
    const lines = personalityFor(p.personality).lines[key];
    if (!lines?.length) return;
    const text = lines[Math.floor(Math.random() * lines.length)]!;
    const id = this.nextId++;
    this.update({ bubbles: { ...this.view.bubbles, [playerId]: { text, id } } });
    setTimeout(() => {
      if (this.view.bubbles[playerId]?.id !== id) return;
      const { [playerId]: _, ...rest } = this.view.bubbles;
      this.update({ bubbles: rest });
    }, 2600);
  }

  private async play(e: GameEvent) {
    const name = (id: string) => this.player(id).name;
    switch (e.type) {
      case "rolled":
        sfx.rattle();
        this.scene.preview(null);
        this.update({ dice: { values: e.dice, rollId: this.view.dice.rollId + 1 } });
        // Dice need ~1s to land whatever the speed setting.
        await sleep(Math.max(900, this.ms(1100)));
        return;
      case "advanced":
        sfx.hop();
        if (e.newRunner) sfx.pop();
        return this.scene.advance(e);
      case "busted": {
        sfx.bust();
        this.logLine(`💥 ${name(e.player)} busted — avalanche!`, e.player);
        this.update({ bust: { player: e.player, id: this.nextId++ } });
        this.say(e.player, "bust");
        if (this.player(e.player).kind === "cpu") {
          this.update({ memory: { ...this.view.memory, [e.player]: updateMemory(this.view.memory[e.player]!, "bust") } });
        }
        for (const p of this.state.players) if (p.id !== e.player) this.say(p.id, "rivalBust", 0.3);
        await this.scene.bust(e.player, e.runners);
        this.update({ bust: null });
        return;
      }
      case "banked": {
        sfx.bank();
        const cols = Object.keys(e.runners).join(", ");
        this.logLine(`⛺ ${name(e.player)} made camp on ${cols}`, e.player);
        if (this.player(e.player).kind === "cpu") {
          this.update({ memory: { ...this.view.memory, [e.player]: updateMemory(this.view.memory[e.player]!, "bank") } });
        }
        return this.scene.bank(e.player, e.runners, e.previous);
      }
      case "claimed":
        sfx.claim();
        this.logLine(`🚩 ${name(e.player)} conquered the ${e.column} summit!`, e.player);
        this.say(e.player, "claim");
        return this.scene.claim(e.player, e.column, e.evicted);
      case "won":
        sfx.win();
        this.logLine(`🏆 ${name(e.player)} wins the expedition!`, e.player);
        this.say(e.player, "win");
        this.scene.celebrate(true);
        return;
      case "turnStarted":
        sfx.turn();
        this.update({ dice: { values: null, rollId: this.view.dice.rollId } });
        await sleep(this.ms(250));
        return;
    }
  }

  private afterIdle() {
    if (this.disposed || this.cpuPending || this.view.busy) return;
    const s = this.state;
    if (s.phase === "finished") return;
    const p = s.players[s.current]!;
    if (p.kind !== "cpu") return;
    this.cpuPending = true;
    void this.cpuTurn(p).finally(() => {
      this.cpuPending = false;
    });
  }

  private async cpuTurn(p: PlayerInfo) {
    const persona = personalityFor(p.personality);
    const memory = this.view.memory[p.id]!;
    await sleep(this.ms(550));
    if (this.disposed) return;
    const s = this.state;
    if (s.phase === "choose") {
      const idx = chooseOption(s, persona, memory);
      this.setHighlight(idx);
      await sleep(this.ms(850));
      if (this.disposed) return;
      this.dispatch({ type: "choose", option: idx });
      return;
    }
    const { stop } = decideStop(s, persona, memory);
    if (stop) {
      this.say(p.id, "stop", 0.8);
      await sleep(this.ms(500));
      this.dispatch({ type: "stop" });
    } else {
      if (Object.keys(s.runners).length > 0) this.say(p.id, "roll", 0.35);
      this.dispatch({ type: "roll", dice: rollDice() });
    }
  }

  dispose() {
    this.disposed = true;
    this.scene.celebrate(false);
    this.listeners.clear();
  }
}
