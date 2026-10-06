import { useState } from "react";
import { PERSONALITIES, personalityFor } from "../engine/ai";
import type { PlayerInfo } from "../engine/rules";

export const SEAT_COLORS = ["#ff5d5d", "#2ab7ca", "#ffb627", "#8e6cf0"];

type SeatKind = "human" | "cpu" | "empty";
interface Seat {
  kind: SeatKind;
  name: string;
  personality: string;
}

const STORAGE_KEY = "cantstop:seats";

function defaultSeats(): Seat[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    // Saved seats may predate renamed personalities; normalise every field.
    if (Array.isArray(saved) && saved.length === 4) {
      return saved.map((seat: Partial<Seat>) => ({
        kind: seat.kind === "human" || seat.kind === "cpu" || seat.kind === "empty" ? seat.kind : "cpu",
        name: typeof seat.name === "string" ? seat.name : "",
        personality: personalityFor(seat.personality).id,
      }));
    }
  } catch {}
  return [
    { kind: "human", name: "You", personality: "professor" },
    { kind: "cpu", name: "", personality: "tortoise" },
    { kind: "cpu", name: "", personality: "daredevil" },
    { kind: "cpu", name: "", personality: "goat" },
  ];
}

export function Setup({ onStart }: { onStart: (players: PlayerInfo[]) => void }) {
  const [seats, setSeats] = useState<Seat[]>(defaultSeats);
  const [tab, setTab] = useState<"local" | "online">("local");
  const active = seats.filter((s) => s.kind !== "empty").length;

  const patch = (i: number, p: Partial<Seat>) => setSeats((all) => all.map((s, j) => (i === j ? { ...s, ...p } : s)));

  const start = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seats));
    const players: PlayerInfo[] = [];
    seats.forEach((s, i) => {
      if (s.kind === "empty") return;
      const persona = personalityFor(s.personality);
      players.push({
        id: `p${i}`,
        color: SEAT_COLORS[i]!,
        kind: s.kind,
        name: s.kind === "cpu" ? persona.name : s.name.trim() || `Climber ${i + 1}`,
        personality: s.kind === "cpu" ? persona.id : undefined,
      });
    });
    onStart(players);
  };

  return (
    <div className="setup panel">
      <header className="title">
        <h1>
          Can't Stop<span>!</span>
        </h1>
        <p>Summit Fever · push your luck up the mountain</p>
      </header>

      <div className="tabs">
        <button className={tab === "local" ? "on" : ""} onClick={() => setTab("local")}>
          Local game
        </button>
        <button className={tab === "online" ? "on" : ""} onClick={() => setTab("online")}>
          Online
        </button>
      </div>

      {tab === "online" ? (
        <div className="coming-soon">
          <div className="big-emoji">🏔️📡</div>
          <p>
            Private rooms with codes, optional passwords, and a public lobby are next on the trail map. For now,
            gather friends around one screen or take on the CPUs.
          </p>
        </div>
      ) : (
        <>
          <div className="seats">
            {seats.map((s, i) => {
              const persona = personalityFor(s.personality);
              const canEmpty = active > 2 || s.kind === "empty";
              return (
                <div key={i} className={`seat ${s.kind}`} style={{ "--seat": SEAT_COLORS[i] } as React.CSSProperties}>
                  <div className="seat-head">
                    <span className="swatch">{s.kind === "cpu" ? persona.emoji : s.kind === "human" ? "🧗" : "·"}</span>
                    <div className="seg">
                      {(["human", "cpu", "empty"] as const).map((k) => (
                        <button
                          key={k}
                          className={s.kind === k ? "on" : ""}
                          disabled={k === "empty" && !canEmpty}
                          onClick={() => patch(i, { kind: k })}
                        >
                          {k === "human" ? "Human" : k === "cpu" ? "CPU" : "Empty"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {s.kind === "human" && (
                    <input
                      className="name-input"
                      value={s.name}
                      maxLength={16}
                      placeholder={`Climber ${i + 1}`}
                      onChange={(e) => patch(i, { name: e.target.value })}
                    />
                  )}
                  {s.kind === "cpu" && (
                    <div className="persona">
                      <select value={s.personality} onChange={(e) => patch(i, { personality: e.target.value })}>
                        {PERSONALITIES.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.emoji} {p.name} — {p.title}
                          </option>
                        ))}
                      </select>
                      <p>{persona.blurb}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button className="btn primary big" disabled={active < 2} onClick={start}>
            Start the climb ⛰️
          </button>
          <details className="rules">
            <summary>How to play</summary>
            <ul>
              <li>Roll four dice and split them into two pairs. Each pair's sum is a trail (2–12) to climb.</li>
              <li>You have three climbers per turn. Once all three are on trails, you can only move those trails.</li>
              <li>Keep rolling to climb higher, or stop to pitch tents and keep your progress.</li>
              <li>If a roll gives no legal move: avalanche! Everything gained this turn is lost.</li>
              <li>Reach a summit and stop to claim the trail. Claim three summits to win.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
