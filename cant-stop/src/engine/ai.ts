// CPU brains. Every personality shares one evaluator; they differ in how much
// risk they tolerate, which trails they love, and a few quirky hooks.

import {
  COLUMN_HEIGHT,
  COLUMNS_TO_WIN,
  bustProbability,
  claimedCount,
  currentPlayer,
  moveContext,
  type GameState,
  type MoveOption,
  type Progress,
} from "./rules";

export type LineKey = "roll" | "stop" | "bust" | "claim" | "win" | "rivalBust" | "think";

export interface CpuMemory {
  /** Hothead: grows with every bust. */
  tilt: number;
  /** Lucky Lou's favourite trails for this game. */
  lucky: number[];
}

export interface Personality {
  id: string;
  name: string;
  emoji: string;
  title: string;
  blurb: string;
  /** How much expected loss the CPU will accept per roll, relative to gain. */
  tolerance(state: GameState, memory: CpuMemory, random: () => number): number;
  /** Preference multiplier for progress on a column. */
  bias(column: number, state: GameState, memory: CpuMemory): number;
  /** Penalty for committing a fresh climber. */
  runnerCost: number;
  /** Extra appetite for reaching a summit this turn. */
  summitBonus: number;
  /** Bank as soon as any summit is reached this turn. */
  bankOnSummit: boolean;
  /** Weigh each option by the bust risk it leaves behind. */
  lookahead: number;
  lines: Record<LineKey, string[]>;
  /** Optional mood label shown in the HUD. */
  mood?(memory: CpuMemory): string | null;
}

const middleLove = (c: number) => 1 + 0.35 * Math.max(0, 3 - Math.abs(c - 7));
const edgeLove = (c: number) => (Math.abs(c - 7) >= 4 ? 2.4 : Math.abs(c - 7) === 3 ? 1.5 : Math.abs(c - 7) === 0 ? 0.6 : 1);

function opponentThreat(column: number, state: GameState): number {
  const me = currentPlayer(state).id;
  let best = 0;
  for (const p of state.players) {
    if (p.id === me) continue;
    const pos = state.camps[p.id]?.[column] ?? 0;
    best = Math.max(best, pos / COLUMN_HEIGHT[column]!);
  }
  return best;
}

function opponentNearWin(state: GameState): boolean {
  const me = currentPlayer(state).id;
  return state.players.some((p) => p.id !== me && claimedCount(state, p.id) >= COLUMNS_TO_WIN - 1);
}

export const PERSONALITIES: Personality[] = [
  {
    id: "professor",
    name: "Professor Hoot",
    emoji: "🦉",
    title: "The Calculator",
    blurb: "Knows the exact odds of every roll and plays them coldly. Annoyingly hard to beat.",
    tolerance: () => 1,
    bias: () => 1,
    runnerCost: 1.6,
    summitBonus: 3,
    bankOnSummit: false,
    lookahead: 0.8,
    lines: {
      roll: ["The numbers favour boldness.", "Statistically sound.", "Proceeding, per the model."],
      stop: ["The expected value says: camp.", "A prudent consolidation.", "Q.E.D."],
      bust: ["A 1-in-12 event. Regrettable.", "Variance, my old nemesis.", "Hmm. Recalibrating."],
      claim: ["Exactly as calculated.", "Summit secured, hypothesis confirmed."],
      win: ["Mathematics prevails!"],
      rivalBust: ["Should have checked the odds.", "Predictable."],
      think: ["Computing…", "Enumerating 1,296 outcomes…"],
    },
  },
  {
    id: "tortoise",
    name: "Tess the Tortoise",
    emoji: "🐢",
    title: "Slow & Steady",
    blurb: "Banks early, loves the busy middle trails, and pitches a tent the moment a summit is in reach.",
    tolerance: () => 0.75,
    bias: (c) => middleLove(c),
    runnerCost: 2.5,
    summitBonus: 2,
    bankOnSummit: true,
    lookahead: 0.6,
    lines: {
      roll: ["Just one more… carefully.", "Slowly does it."],
      stop: ["That's plenty for today.", "Time for a nap in the tent.", "Safe and sound!"],
      bust: ["Oh dear, oh dear.", "I knew I should've stopped!", "Back to the bottom… slowly."],
      claim: ["Slow and steady wins the summit!", "Made it, eventually!"],
      win: ["The tortoise wins again!"],
      rivalBust: ["Should've taken a nap.", "Tsk, too hasty."],
      think: ["Hmm, let me think about that…", "No rush…"],
    },
  },
  {
    id: "daredevil",
    name: "Dax Daredevil",
    emoji: "🧨",
    title: "Never Stops",
    blurb: "Rolls until something explodes. Spectacular summits, even more spectacular avalanches.",
    tolerance: () => 4,
    bias: () => 1,
    runnerCost: 0.3,
    summitBonus: 5,
    bankOnSummit: false,
    lookahead: 0,
    lines: {
      roll: ["MORE!", "Can't stop, won't stop!", "Again! AGAIN!", "Hold my pickaxe."],
      stop: ["Fine. FINE. Camping.", "Ugh, boring but okay."],
      bust: ["WORTH IT!", "That was AWESOME.", "Avalanche? More like AVA-LAUNCH!"],
      claim: ["NOTHING CAN STOP ME!", "Summit speedrun!"],
      win: ["Told you. Never stop!"],
      rivalBust: ["Amateur avalanche.", "Ha! Rookie numbers."],
      think: ["Roll roll roll…", "No thoughts, only dice."],
    },
  },
  {
    id: "goat",
    name: "Billy the Goat",
    emoji: "🐐",
    title: "Edge Lord",
    blurb: "Scorns the crowded middle and scrambles up the short, sheer edge trails: 2, 3, 11 and 12.",
    tolerance: () => 1.15,
    bias: (c) => edgeLove(c),
    runnerCost: 1.2,
    summitBonus: 3,
    bankOnSummit: false,
    lookahead: 0.3,
    lines: {
      roll: ["Baaa-ck up the cliff!", "Edges are for goats."],
      stop: ["Nibbling some grass.", "Baaa. Camp time."],
      bust: ["Baaaaaaa!", "Slipped on a pebble.", "The cliff fought back."],
      claim: ["King of the crag!", "Goats belong on top!"],
      win: ["G.O.A.T. — literally."],
      rivalBust: ["Should've stuck to the edges.", "Baa-ha-ha!"],
      think: ["*chews thoughtfully*", "Which ledge…"],
    },
  },
  {
    id: "hothead",
    name: "Hothead Hal",
    emoji: "🌋",
    title: "Goes On Tilt",
    blurb: "Starts sensible. Every bust makes them angrier and wilder, until a good camp calms them down.",
    tolerance: (_s, m) => 0.8 + m.tilt,
    bias: () => 1,
    runnerCost: 1.4,
    summitBonus: 3,
    bankOnSummit: false,
    lookahead: 0.4,
    lines: {
      roll: ["I'm FINE.", "Roll it. Just roll it.", "Watch THIS."],
      stop: ["Okay. Deep breaths. Camping.", "See? I can be calm."],
      bust: ["ARE YOU KIDDING ME?!", "These dice are RIGGED!", "*kicks a rock*"],
      claim: ["THAT'S what I'm talking about!", "Ha! Who's angry now?"],
      win: ["I was never worried. Not once."],
      rivalBust: ["HA! Feel my pain!", "Welcome to the club."],
      think: ["Grrr…", "*fuming quietly*"],
    },
    mood: (m) => (m.tilt >= 2 ? "🔥 FURIOUS" : m.tilt >= 0.8 ? "😤 tilted" : null),
  },
  {
    id: "saboteur",
    name: "Sly the Fox",
    emoji: "🦊",
    title: "The Spoiler",
    blurb: "Races rivals up the trails they're closest to finishing — and plays reckless when someone is about to win.",
    tolerance: (s) => (opponentNearWin(s) ? 1.9 : 1.05),
    bias: (c, s) => 1 + 2.2 * opponentThreat(c, s),
    runnerCost: 1.3,
    summitBonus: 4,
    bankOnSummit: false,
    lookahead: 0.5,
    lines: {
      roll: ["Mind if I borrow your trail?", "Sneaking up…"],
      stop: ["I'll just wait here. Behind you.", "Tent pitched right on your toes."],
      bust: ["Foiled!", "Curses, outfoxed!"],
      claim: ["Oops, was this your summit?", "Snatched it!"],
      win: ["Too slow, all of you."],
      rivalBust: ["Hehehe.", "Such a shame. Such a shame."],
      think: ["Plotting…", "Whose plans can I ruin…"],
    },
  },
  {
    id: "lucky",
    name: "Lucky Lou",
    emoji: "🍀",
    title: "Superstitious",
    blurb: "Has two lucky trails each game and chases them shamelessly. Decides when to stop by gut feeling.",
    tolerance: (_s, _m, random) => 0.5 + random() * 2.2,
    bias: (c, _s, m) => (m.lucky.includes(c) ? 3 : 1),
    runnerCost: 1,
    summitBonus: 3,
    bankOnSummit: false,
    lookahead: 0,
    lines: {
      roll: ["I can feel it in my socks!", "Lucky roll incoming!", "Kissing the dice…"],
      stop: ["Gut says stop.", "A black cat crossed my path. Camping."],
      bust: ["Must've been a mirror I broke.", "Bad omen!", "My lucky socks have failed me."],
      claim: ["Never doubt the clover!", "Lucky lucky lucky!"],
      win: ["Skill? No. Luck. Glorious luck."],
      rivalBust: ["Should've brought a horseshoe.", "Unlucky, friend!"],
      think: ["Consulting the tea leaves…", "Eeny, meeny…"],
    },
    mood: (m) => `lucky: ${m.lucky.join(" & ")}`,
  },
];

export const PERSONALITY_BY_ID: Record<string, Personality> = Object.fromEntries(PERSONALITIES.map((p) => [p.id, p]));

/** Unknown or missing personalities fall back to the Professor. */
export function personalityFor(id: string | undefined): Personality {
  return (id && PERSONALITY_BY_ID[id]) || PERSONALITIES[0]!;
}

export function newMemory(random: () => number = Math.random): CpuMemory {
  const pool = [4, 5, 6, 7, 8, 9, 10];
  const a = pool.splice(Math.floor(random() * pool.length), 1)[0]!;
  const b = pool[Math.floor(random() * pool.length)]!;
  return { tilt: 0, lucky: [a, b].sort((x, y) => x - y) };
}

/** Called after events so moody CPUs can react. */
export function updateMemory(memory: CpuMemory, outcome: "bust" | "bank"): CpuMemory {
  if (outcome === "bust") return { ...memory, tilt: Math.min(3.2, memory.tilt + 0.9) };
  return { ...memory, tilt: memory.tilt * 0.4 };
}

// --- evaluation -------------------------------------------------------------

function stepValue(column: number, from: number, to: number): number {
  const h = COLUMN_HEIGHT[column]!;
  // Fraction of the trail climbed, with later steps worth a bit more.
  return ((to - from) / h) * 10 * (1 + (0.6 * to) / h);
}

/** How much unbanked progress would be lost by busting now. */
function atRisk(state: GameState, runners: Progress, persona: Personality, memory: CpuMemory): number {
  const camps = state.camps[currentPlayer(state).id] ?? {};
  let total = 0;
  for (const [col, pos] of Object.entries(runners)) {
    const c = Number(col);
    total += stepValue(c, camps[c] ?? 0, pos) * persona.bias(c, state, memory);
    if (pos >= COLUMN_HEIGHT[c]!) total += 6 + persona.summitBonus;
  }
  return total;
}

function summitsPending(state: GameState, runners: Progress): number {
  return Object.entries(runners).filter(([c, pos]) => pos >= COLUMN_HEIGHT[Number(c)]!).length;
}

function applyMoves(state: GameState, option: MoveOption): Progress {
  const camps = state.camps[currentPlayer(state).id] ?? {};
  const runners = { ...state.runners };
  for (const c of option.moves) runners[c] = (runners[c] ?? camps[c] ?? 0) + 1;
  return runners;
}

export function scoreOption(state: GameState, option: MoveOption, persona: Personality, memory: CpuMemory): number {
  const camps = state.camps[currentPlayer(state).id] ?? {};
  let runners = { ...state.runners };
  let score = 0;
  for (const c of option.moves) {
    const isNew = runners[c] === undefined;
    const from = runners[c] ?? camps[c] ?? 0;
    if (isNew) score -= persona.runnerCost * [1, 1.6, 2.6][Object.keys(runners).length]!;
    runners = { ...runners, [c]: from + 1 };
    score += stepValue(c, from, from + 1) * persona.bias(c, state, memory);
    if (from + 1 >= COLUMN_HEIGHT[c]!) score += persona.summitBonus;
  }
  if (persona.lookahead > 0) {
    const p = bustProbability({ ...moveContext(state), runners });
    score -= persona.lookahead * p * atRisk(state, runners, persona, memory) * 0.5;
  }
  return score;
}

export function chooseOption(state: GameState, persona: Personality, memory: CpuMemory): number {
  let best = 0;
  let bestScore = -Infinity;
  state.options.forEach((opt, i) => {
    const s = scoreOption(state, opt, persona, memory);
    if (s > bestScore) [best, bestScore] = [i, s];
  });
  return best;
}

export interface StopDecision {
  stop: boolean;
  bustChance: number;
}

/** Expected value per successful roll, in `stepValue` units (empirical). */
const GAIN_PER_ROLL = 2.2;

export function decideStop(
  state: GameState,
  persona: Personality,
  memory: CpuMemory,
  random: () => number = Math.random,
): StopDecision {
  const runners = state.runners;
  const bustChance = bustProbability(moveContext(state));
  if (Object.keys(runners).length === 0) return { stop: false, bustChance };

  const me = currentPlayer(state).id;
  const pending = summitsPending(state, runners);
  // Everyone banks a winning hand.
  if (claimedCount(state, me) + pending >= COLUMNS_TO_WIN) return { stop: true, bustChance };
  if (persona.bankOnSummit && pending > 0) return { stop: true, bustChance };

  const risk = bustChance * atRisk(state, runners, persona, memory);
  const reward = (1 - bustChance) * GAIN_PER_ROLL * persona.tolerance(state, memory, random);
  return { stop: risk > reward, bustChance };
}

export { applyMoves as previewRunners };
