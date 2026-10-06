// Pure, serialisable Can't Stop rules engine. No DOM, no randomness inside:
// dice are passed in with the `roll` action so a server can stay authoritative.

export const COLUMNS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_HEIGHT: Record<number, number> = {
  2: 3, 3: 5, 4: 7, 5: 9, 6: 11, 7: 13, 8: 11, 9: 9, 10: 7, 11: 5, 12: 3,
};

export const MAX_RUNNERS = 3;
export const COLUMNS_TO_WIN = 3;
export const MAX_PLAYERS = 4;

export type Dice = [number, number, number, number];
export type PlayerKind = "human" | "cpu";

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  kind: PlayerKind;
  personality?: string;
}

/** column -> step reached (1..height). Missing key = not on that column. */
export type Progress = Record<number, number>;

export interface MoveOption {
  /** Columns to advance, in order. Same column twice = two steps. */
  moves: number[];
  /** Dice index pairs used for each move (aligned with `moves`). */
  pairs: [number, number][];
}

export type Phase = "roll" | "choose" | "finished";

export interface GameState {
  players: PlayerInfo[];
  camps: Record<string, Progress>;
  /** column -> player id that claimed it */
  claimed: Record<number, string>;
  current: number;
  runners: Progress;
  phase: Phase;
  dice: Dice | null;
  options: MoveOption[];
  turn: number;
  winner: string | null;
}

export type Action =
  | { type: "roll"; dice: Dice }
  | { type: "choose"; option: number }
  | { type: "stop" };

export type GameEvent =
  | { type: "turnStarted"; player: string }
  | { type: "rolled"; player: string; dice: Dice; options: MoveOption[] }
  | { type: "advanced"; player: string; column: number; from: number; to: number; newRunner: boolean }
  | { type: "busted"; player: string; runners: Progress }
  | { type: "banked"; player: string; runners: Progress; previous: Progress }
  | { type: "claimed"; player: string; column: number; evicted: string[] }
  | { type: "won"; player: string };

export class RuleError extends Error {}

export function createGame(players: PlayerInfo[], firstPlayer = 0): GameState {
  if (players.length < 2 || players.length > MAX_PLAYERS) {
    throw new RuleError(`Need 2-${MAX_PLAYERS} players`);
  }
  return {
    players,
    camps: Object.fromEntries(players.map((p) => [p.id, {}])),
    claimed: {},
    current: firstPlayer,
    runners: {},
    phase: "roll",
    dice: null,
    options: [],
    turn: 1,
    winner: null,
  };
}

export function currentPlayer(state: GameState): PlayerInfo {
  return state.players[state.current]!;
}

/** Where the active player stands on a column right now (runner beats camp). */
export function positionOn(state: Pick<GameState, "runners" | "camps">, playerId: string, column: number): number {
  return state.runners[column] ?? state.camps[playerId]?.[column] ?? 0;
}

/** The minimal slice of state needed to work out legal moves. */
export interface MoveContext {
  claimed: Record<number, string>;
  camps: Progress;
  runners: Progress;
}

export function moveContext(state: GameState): MoveContext {
  return {
    claimed: state.claimed,
    camps: state.camps[currentPlayer(state).id] ?? {},
    runners: state.runners,
  };
}

function tryAdvance(ctx: MoveContext, runners: Progress, column: number): Progress | null {
  if (ctx.claimed[column]) return null;
  const pos = runners[column] ?? ctx.camps[column] ?? 0;
  if (pos >= COLUMN_HEIGHT[column]!) return null;
  if (runners[column] === undefined && Object.keys(runners).length >= MAX_RUNNERS) return null;
  return { ...runners, [column]: pos + 1 };
}

const PAIRINGS: [[number, number], [number, number]][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
];

export function legalOptions(ctx: MoveContext, dice: Dice): MoveOption[] {
  const seen = new Set<string>();
  const out: MoveOption[] = [];
  const add = (moves: number[], pairs: [number, number][]) => {
    const key = [...moves].sort((a, b) => a - b).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ moves, pairs });
  };

  for (const [pa, pb] of PAIRINGS) {
    let a = dice[pa[0]]! + dice[pa[1]]!;
    let b = dice[pb[0]]! + dice[pb[1]]!;
    let [pairA, pairB] = [pa, pb];
    if (b < a) [a, b, pairA, pairB] = [b, a, pairB, pairA];

    const afterA = tryAdvance(ctx, ctx.runners, a);
    const both = afterA && tryAdvance(ctx, afterA, b);
    if (both) {
      add([a, b], [pairA, pairB]);
      continue;
    }
    // Can't use both: the player picks whichever single sum is legal.
    if (afterA) add([a], [pairA]);
    if (tryAdvance(ctx, ctx.runners, b)) add([b], [pairB]);
  }
  return out;
}

/** Every one of the 6^4 equally likely rolls, precomputed once. */
export const ALL_ROLLS: Dice[] = (() => {
  const rolls: Dice[] = [];
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++)
        for (let d = 1; d <= 6; d++) rolls.push([a, b, c, d]);
  return rolls;
})();

/** Bitmask of every pair sum a roll can make, with how many rolls share it. */
const ROLL_MASKS: [mask: number, count: number][] = (() => {
  const counts = new Map<number, number>();
  for (const d of ALL_ROLLS) {
    let mask = 0;
    for (const [[a, b], [c, e]] of PAIRINGS) mask |= (1 << (d[a]! + d[b]!)) | (1 << (d[c]! + d[e]!));
    counts.set(mask, (counts.get(mask) ?? 0) + 1);
  }
  return [...counts];
})();

/**
 * Exact probability that the next roll has no legal move. A roll busts iff
 * none of its pair sums lands on a playable column, so we only need masks.
 */
export function bustProbability(ctx: MoveContext): number {
  const free = Object.keys(ctx.runners).length < MAX_RUNNERS;
  let playable = 0;
  for (const c of COLUMNS) {
    if (ctx.claimed[c]) continue;
    const pos = ctx.runners[c] ?? ctx.camps[c] ?? 0;
    if (pos >= COLUMN_HEIGHT[c]!) continue;
    if (free || ctx.runners[c] !== undefined) playable |= 1 << c;
  }
  let busts = 0;
  for (const [mask, count] of ROLL_MASKS) if ((mask & playable) === 0) busts += count;
  return busts / ALL_ROLLS.length;
}

export function canStop(state: GameState): boolean {
  return state.phase === "roll" && Object.keys(state.runners).length > 0;
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

function nextTurn(state: GameState, events: GameEvent[]): GameState {
  const current = (state.current + 1) % state.players.length;
  const next: GameState = {
    ...state,
    current,
    runners: {},
    phase: "roll",
    dice: null,
    options: [],
    turn: state.turn + 1,
  };
  events.push({ type: "turnStarted", player: state.players[current]!.id });
  return next;
}

export function applyAction(state: GameState, action: Action): ApplyResult {
  if (state.phase === "finished") throw new RuleError("Game is over");
  const player = currentPlayer(state);
  const events: GameEvent[] = [];

  switch (action.type) {
    case "roll": {
      if (state.phase !== "roll") throw new RuleError("Choose a move first");
      if (!isValidDice(action.dice)) throw new RuleError("Invalid dice");
      const options = legalOptions(moveContext(state), action.dice);
      events.push({ type: "rolled", player: player.id, dice: action.dice, options });
      if (options.length === 0) {
        events.push({ type: "busted", player: player.id, runners: state.runners });
        return { state: nextTurn({ ...state, dice: action.dice }, events), events };
      }
      return { state: { ...state, phase: "choose", dice: action.dice, options }, events };
    }

    case "choose": {
      if (state.phase !== "choose") throw new RuleError("Roll first");
      const option = state.options[action.option];
      if (!option) throw new RuleError("No such option");
      const ctx = moveContext(state);
      let runners = state.runners;
      for (const column of option.moves) {
        const next = tryAdvance(ctx, runners, column);
        if (!next) throw new RuleError("Illegal move");
        events.push({
          type: "advanced",
          player: player.id,
          column,
          from: positionOn({ runners, camps: state.camps }, player.id, column),
          to: next[column]!,
          newRunner: runners[column] === undefined,
        });
        runners = next;
      }
      return { state: { ...state, runners, phase: "roll", options: [] }, events };
    }

    case "stop": {
      if (!canStop(state)) throw new RuleError("Nothing to bank yet");
      const previous: Progress = {};
      const mine: Progress = { ...state.camps[player.id] };
      for (const [col, pos] of Object.entries(state.runners)) {
        const c = Number(col);
        if (mine[c] !== undefined) previous[c] = mine[c]!;
        mine[c] = pos;
      }
      let camps = { ...state.camps, [player.id]: mine };
      const claimed = { ...state.claimed };
      events.push({ type: "banked", player: player.id, runners: state.runners, previous });

      for (const [col, pos] of Object.entries(state.runners)) {
        const c = Number(col);
        if (pos < COLUMN_HEIGHT[c]!) continue;
        claimed[c] = player.id;
        const evicted: string[] = [];
        camps = Object.fromEntries(
          Object.entries(camps).map(([pid, prog]) => {
            if (pid === player.id || prog[c] === undefined) return [pid, prog];
            evicted.push(pid);
            const { [c]: _, ...rest } = prog;
            return [pid, rest];
          }),
        );
        events.push({ type: "claimed", player: player.id, column: c, evicted });
      }

      const banked: GameState = { ...state, camps, claimed };
      if (claimedCount(banked, player.id) >= COLUMNS_TO_WIN) {
        events.push({ type: "won", player: player.id });
        return {
          state: { ...banked, runners: {}, phase: "finished", options: [], winner: player.id },
          events,
        };
      }
      return { state: nextTurn(banked, events), events };
    }
  }
}

export function claimedCount(state: Pick<GameState, "claimed">, playerId: string): number {
  return Object.values(state.claimed).filter((p) => p === playerId).length;
}

function isValidDice(dice: unknown): dice is Dice {
  // Index explicitly: `every` would skip holes in a sparse array.
  if (!Array.isArray(dice) || dice.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const d = dice[i];
    if (!Number.isInteger(d) || d < 1 || d > 6) return false;
  }
  return true;
}

export function rollDice(random: () => number = Math.random): Dice {
  const d = () => 1 + Math.floor(random() * 6);
  return [d(), d(), d(), d()];
}
