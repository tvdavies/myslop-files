// Headless CPU tournament: `bun scripts/simulate.ts [games]`
import { PERSONALITIES, chooseOption, decideStop, newMemory, updateMemory, type CpuMemory } from "../src/engine/ai";
import { applyAction, createGame, rollDice, type GameState } from "../src/engine/rules";

const games = Number(process.argv[2] ?? 200);
const ids = PERSONALITIES.map((p) => p.id);
const stats = Object.fromEntries(ids.map((id) => [id, { played: 0, wins: 0, turns: 0, busts: 0, banks: 0 }]));
let totalTurns = 0;

for (let g = 0; g < games; g++) {
  const seats = [...ids].sort(() => Math.random() - 0.5).slice(0, 4);
  let state: GameState = createGame(seats.map((id, i) => ({ id: `p${i}`, name: id, color: "#000", kind: "cpu", personality: id })), g % 4);
  const mem: Record<string, CpuMemory> = Object.fromEntries(state.players.map((p) => [p.id, newMemory()]));
  let guard = 0;
  while (state.phase !== "finished" && guard++ < 20000) {
    const p = state.players[state.current]!;
    const persona = PERSONALITIES.find((x) => x.id === p.personality)!;
    const s = stats[persona.id]!;
    let r;
    if (state.phase === "choose") r = applyAction(state, { type: "choose", option: chooseOption(state, persona, mem[p.id]!) });
    else if (decideStop(state, persona, mem[p.id]!).stop) r = applyAction(state, { type: "stop" });
    else r = applyAction(state, { type: "roll", dice: rollDice() });
    for (const e of r.events) {
      if (e.type === "busted") { s.busts++; mem[p.id] = updateMemory(mem[p.id]!, "bust"); }
      if (e.type === "banked") { s.banks++; mem[p.id] = updateMemory(mem[p.id]!, "bank"); }
    }
    state = r.state;
  }
  if (!state.winner) throw new Error("game did not finish");
  totalTurns += state.turn;
  for (const p of state.players) {
    stats[p.personality!]!.played++;
    if (p.id === state.winner) stats[p.personality!]!.wins++;
  }
}
console.log(`games=${games} avg turns=${(totalTurns / games).toFixed(1)}`);
for (const [id, s] of Object.entries(stats))
  console.log(id.padEnd(10), `win ${((100 * s.wins) / s.played).toFixed(0).padStart(3)}%`, `bust rate ${((100 * s.busts) / (s.busts + s.banks)).toFixed(0)}%`);
