import { describe, expect, test } from "bun:test";
import {
  ALL_ROLLS,
  applyAction,
  bustProbability,
  createGame,
  legalOptions,
  type GameState,
  type MoveContext,
  type PlayerInfo,
} from "./rules";

const players: PlayerInfo[] = [
  { id: "a", name: "A", color: "#f00", kind: "human" },
  { id: "b", name: "B", color: "#00f", kind: "human" },
];

const ctx = (over: Partial<MoveContext> = {}): MoveContext => ({ claimed: {}, camps: {}, runners: {}, ...over });
const keys = (opts: { moves: number[] }[]) => opts.map((o) => o.moves.join("+")).sort();

describe("legalOptions", () => {
  test("offers each distinct pairing", () => {
    // pairings: 1+2/3+4 = 3,7 ; 1+3/2+4 = 4,6 ; 1+4/2+3 = 5,5
    expect(keys(legalOptions(ctx(), [1, 2, 3, 4]))).toEqual(["3+7", "4+6", "5+5"]);
  });

  test("dedupes identical pairings", () => {
    expect(keys(legalOptions(ctx(), [3, 3, 3, 3]))).toEqual(["6+6"]);
  });

  test("with one runner left, splits into single choices", () => {
    const opts = legalOptions(ctx({ runners: { 2: 1, 12: 1 } }), [1, 2, 3, 4]);
    expect(keys(opts)).toEqual(["3", "4", "5+5", "6", "7"]);
  });

  test("with no runners left, only existing runner columns are legal", () => {
    expect(keys(legalOptions(ctx({ runners: { 3: 1, 4: 1, 5: 1 } }), [1, 2, 3, 4]))).toEqual(["3", "4", "5+5"]);
    expect(legalOptions(ctx({ runners: { 2: 1, 3: 1, 12: 1 } }), [2, 2, 4, 4])).toEqual([]);
  });

  test("claimed columns are blocked", () => {
    expect(keys(legalOptions(ctx({ claimed: { 7: "b" } }), [1, 2, 3, 4]))).toEqual(["3", "4+6", "5+5"]);
  });

  test("a double move stops at the summit", () => {
    expect(keys(legalOptions(ctx({ camps: { 2: 2 } }), [1, 1, 1, 1]))).toEqual(["2"]);
    expect(keys(legalOptions(ctx({ camps: { 2: 3 } }), [1, 1, 1, 1]))).toEqual([]);
  });
});

describe("bustProbability", () => {
  test("is zero with free runners and open board", () => {
    expect(bustProbability(ctx())).toBe(0);
  });

  test("matches the known odds for 6/7/8", () => {
    // Classic Can't Stop figure: ~8.1% bust chance on 6, 7, 8.
    expect(bustProbability(ctx({ runners: { 6: 1, 7: 1, 8: 1 } }))).toBeCloseTo(0.0802, 3);
  });
});

describe("turn flow", () => {
  test("roll, choose, stop banks camps and passes turn", () => {
    let s: GameState = createGame(players);
    s = applyAction(s, { type: "roll", dice: [1, 2, 3, 4] }).state;
    expect(s.phase).toBe("choose");
    const idx = s.options.findIndex((o) => o.moves.join() === "3,7");
    const chose = applyAction(s, { type: "choose", option: idx });
    expect(chose.state.runners).toEqual({ 3: 1, 7: 1 });
    const stopped = applyAction(chose.state, { type: "stop" });
    expect(stopped.state.camps.a).toEqual({ 3: 1, 7: 1 });
    expect(stopped.state.current).toBe(1);
    expect(stopped.events.map((e) => e.type)).toEqual(["banked", "turnStarted"]);
  });

  test("bust discards runners and passes turn", () => {
    let s: GameState = { ...createGame(players), runners: { 2: 1, 3: 1, 12: 1 } };
    const r = applyAction(s, { type: "roll", dice: [2, 2, 4, 4] });
    expect(r.events.map((e) => e.type)).toEqual(["rolled", "busted", "turnStarted"]);
    expect(r.state.current).toBe(1);
    expect(r.state.runners).toEqual({});
    expect(r.state.camps.a).toEqual({});
  });

  test("topping a column claims it, evicts others, and three claims wins", () => {
    let s: GameState = {
      ...createGame(players),
      claimed: { 3: "a", 11: "a" },
      camps: { a: { 3: 5, 11: 5 }, b: { 2: 1 } },
      runners: { 2: 3 },
    };
    const r = applyAction(s, { type: "stop" });
    expect(r.state.claimed[2]).toBe("a");
    expect(r.state.camps.b).toEqual({});
    expect(r.state.winner).toBe("a");
    expect(r.state.phase).toBe("finished");
    expect(r.events.map((e) => e.type)).toEqual(["banked", "claimed", "won"]);
  });

  test("rejects sparse or out-of-range dice", () => {
    const sparse = [1, 1, 1] as unknown as [number, number, number, number];
    sparse.length = 4;
    expect(() => applyAction(createGame(players), { type: "roll", dice: sparse })).toThrow();
    expect(() => applyAction(createGame(players), { type: "roll", dice: [1, 2, 3, 7] })).toThrow();
  });

  test("cannot stop before moving", () => {
    expect(() => applyAction(createGame(players), { type: "stop" })).toThrow();
  });
});

test("fast bust probability agrees with brute force", () => {
  const cases: MoveContext[] = [
    ctx({ runners: { 2: 1, 3: 1, 12: 1 } }),
    ctx({ runners: { 4: 2, 10: 1 }, claimed: { 7: "b", 6: "b" } }),
    ctx({ runners: { 5: 9 }, camps: { 8: 11 } }),
  ];
  for (const c of cases) {
    const brute = ALL_ROLLS.filter((d) => legalOptions(c, d).length === 0).length / ALL_ROLLS.length;
    expect(bustProbability(c)).toBeCloseTo(brute, 10);
  }
});
