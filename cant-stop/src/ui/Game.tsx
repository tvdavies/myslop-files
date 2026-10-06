import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { personalityFor } from "../engine/ai";
import {
  COLUMN_HEIGHT,
  COLUMNS_TO_WIN,
  MAX_RUNNERS,
  bustProbability,
  canStop,
  claimedCount,
  createGame,
  moveContext,
  positionOn,
  type GameState,
  type MoveOption,
  type PlayerInfo,
} from "../engine/rules";
import { Director, type Speed } from "../game/director";
import { isMuted, setMuted } from "../audio/sfx";
import type { MountainScene } from "../scene/MountainScene";
import { Die, MiniDie } from "./Dice";

export function Game(props: { scene: MountainScene; players: PlayerInfo[]; onQuit: () => void; onRematch: () => void }) {
  const { scene, players } = props;
  const [director, setDirector] = useState<Director | null>(null);
  useEffect(() => {
    const d = new Director(createGame(players, Math.floor(Math.random() * players.length)), scene);
    setDirector(d);
    return () => d.dispose();
  }, [scene, players]);
  return director ? <GameView {...props} director={director} /> : null;
}

function GameView({ scene, director, onQuit, onRematch }: { scene: MountainScene; director: Director; onQuit: () => void; onRematch: () => void }) {
  const view = useSyncExternalStore(director.subscribe, () => director.view);
  const s = view.shown;
  const current = s.players[s.current]!;
  const myTurn = current.kind === "human" && !view.busy && s.phase !== "finished";

  const sideRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = sideRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const side = r.left > window.innerWidth / 2;
      scene.setInsets(side ? { right: window.innerWidth - r.left } : { bottom: window.innerHeight - r.top });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [scene]);

  const [speed, setSpeedState] = useState<Speed>(() => (localStorage.getItem("cantstop:speed") as Speed) ?? "normal");
  useEffect(() => {
    director.setSpeed(speed);
    localStorage.setItem("cantstop:speed", speed);
  }, [director, speed]);
  const [muted, setMutedState] = useState(isMuted);

  // Keyboard: R/Space roll, S stop, 1-6 pick a move.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!myTurn || e.target instanceof HTMLInputElement) return;
      if (s.phase === "roll" && (e.key === "r" || e.key === " ")) {
        e.preventDefault();
        director.humanAction({ type: "roll" });
      } else if (s.phase === "roll" && e.key === "s" && canStop(s)) director.humanAction({ type: "stop" });
      else if (s.phase === "choose" && /^[1-6]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (s.options[i]) director.humanAction({ type: "choose", option: i });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [director, myTurn, s]);

  const risk = useMemo(() => (s.phase === "roll" && Object.keys(s.runners).length ? bustProbability(moveContext(s)) : null), [s]);
  const highlighted = view.highlight !== null ? s.options[view.highlight] : undefined;
  const winner = s.winner ? s.players.find((p) => p.id === s.winner) : null;
  const bustPlayer = view.bust ? s.players.find((p) => p.id === view.bust!.player) : null;

  const pairGroup = (i: number): "a" | "b" | null => {
    if (!highlighted) return null;
    const [pa, pb] = highlighted.pairs;
    if (pa?.includes(i)) return "a";
    if (pb?.includes(i)) return "b";
    return null;
  };

  return (
    <div className="game">
      <div className="players">
        {s.players.map((p) => (
          <PlayerCard key={p.id} p={p} state={s} active={p.id === current.id && s.phase !== "finished"} bubble={view.bubbles[p.id]?.text} mood={view.memory[p.id]} />
        ))}
      </div>

      <aside className="side panel" ref={sideRef}>
        <div className="turn-head" style={{ "--pc": current.color } as React.CSSProperties}>
          <div className="turn-name">
            <span className="dot" />
            {s.phase === "finished" ? "Expedition over" : current.kind === "human" ? (current.name.toLowerCase() === "you" ? "Your turn" : `${current.name}'s turn`) : `${current.name} is climbing…`}
          </div>
          <div className="runners" title="Climbers available this turn">
            {Array.from({ length: MAX_RUNNERS }, (_, i) => (
              <span key={i} className={i < Object.keys(s.runners).length ? "used" : ""}>
                🧗
              </span>
            ))}
          </div>
        </div>

        <div className="tray">
          {[0, 1, 2, 3].map((i) => (
            <Die key={i} index={i} value={view.dice.values?.[i] ?? null} rollId={view.dice.rollId} group={pairGroup(i)} />
          ))}
        </div>

        <div className="actions">
          {s.phase === "choose" && (
            <OptionList
              state={s}
              disabled={!myTurn}
              highlight={view.highlight}
              onHover={(i) => current.kind === "human" && director.setHighlight(i)}
              onPick={(i) => director.humanAction({ type: "choose", option: i })}
            />
          )}
          {s.phase === "roll" && (
            <>
              {risk !== null && <RiskMeter risk={risk} />}
              <div className="roll-stop">
                <button className="btn primary big" disabled={!myTurn} onClick={() => director.humanAction({ type: "roll" })}>
                  🎲 {Object.keys(s.runners).length ? "Roll again" : "Roll the dice"}
                </button>
                <button className="btn camp big" disabled={!myTurn || !canStop(s)} onClick={() => director.humanAction({ type: "stop" })}>
                  ⛺ Stop &amp; camp
                </button>
              </div>
              {myTurn && <p className="hint">R / Space to roll · S to stop</p>}
            </>
          )}
          {current.kind === "cpu" && s.phase !== "finished" && <p className="hint thinking">{personalityFor(current.personality).emoji} thinking…</p>}
        </div>

        <ol className="log">
          {[...view.log].reverse().map((l) => (
            <li key={l.id} style={{ "--pc": s.players.find((p) => p.id === l.player)?.color ?? "#999" } as React.CSSProperties}>
              {l.text}
            </li>
          ))}
        </ol>

        <div className="toolbar">
          <button className="btn small" onClick={onQuit}>
            ☰ Menu
          </button>
          <div className="seg small">
            {(["chill", "normal", "fast"] as const).map((sp) => (
              <button key={sp} className={speed === sp ? "on" : ""} onClick={() => setSpeedState(sp)}>
                {sp === "chill" ? "🐢" : sp === "normal" ? "🚶" : "🐇"}
              </button>
            ))}
          </div>
          <button
            className="btn small"
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </aside>

      {bustPlayer && (
        <div className="bust-overlay" key={view.bust!.id} style={{ "--pc": bustPlayer.color } as React.CSSProperties}>
          <div className="bust-text">
            <span>AVALANCHE!</span>
            <small>{bustPlayer.name} went bust</small>
          </div>
        </div>
      )}

      {winner && !view.busy && (
        <div className="win-overlay">
          <div className="panel win-card" style={{ "--pc": winner.color } as React.CSSProperties}>
            <div className="trophy">🏆</div>
            <h2>{winner.name} conquers the mountain!</h2>
            <p>{s.turn} turns of daring, despair and dice.</p>
            <div className="row">
              <button className="btn primary big" onClick={onRematch}>
                Climb again
              </button>
              <button className="btn big" onClick={onQuit}>
                Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerCard({ p, state, active, bubble, mood }: { p: PlayerInfo; state: GameState; active: boolean; bubble?: string; mood?: import("../engine/ai").CpuMemory }) {
  const persona = p.kind === "cpu" ? personalityFor(p.personality) : undefined;
  const claims = claimedCount(state, p.id);
  const moodText = persona?.mood && mood ? persona.mood(mood) : null;
  return (
    <div className={`player-card ${active ? "active" : ""}`} style={{ "--pc": p.color } as React.CSSProperties}>
      <div className="avatar">{persona?.emoji ?? "🧗"}</div>
      <div className="info">
        <div className="pname">{p.name}</div>
        <div className="ptitle">{persona ? persona.title : "Human"}{moodText ? ` · ${moodText}` : ""}</div>
      </div>
      <div className="summits" title={`${claims} of ${COLUMNS_TO_WIN} summits`}>
        {Array.from({ length: COLUMNS_TO_WIN }, (_, i) => (
          <span key={i} className={i < claims ? "got" : ""}>
            ⚑
          </span>
        ))}
      </div>
      {bubble && (
        <div className="bubble" key={bubble}>
          {bubble}
        </div>
      )}
    </div>
  );
}

function describe(option: MoveOption, state: GameState) {
  const player = state.players[state.current]!;
  const runners = { ...state.runners };
  let fresh = 0;
  let summit = false;
  for (const c of option.moves) {
    if (runners[c] === undefined) fresh++;
    runners[c] = positionOn({ runners, camps: state.camps }, player.id, c) + 1;
    if (runners[c]! >= COLUMN_HEIGHT[c]!) summit = true;
  }
  const [a, b] = option.moves;
  const label = b === undefined ? `Climb ${a} only` : a === b ? `Climb ${a} twice` : `Climb ${a} & ${b}`;
  return { label, fresh, summit };
}

function OptionList({ state, disabled, highlight, onHover, onPick }: { state: GameState; disabled: boolean; highlight: number | null; onHover: (i: number | null) => void; onPick: (i: number) => void }) {
  const dice = state.dice!;
  return (
    <div className="options" onMouseLeave={() => onHover(null)}>
      <div className="options-title">Pick your route</div>
      {state.options.map((o, i) => {
        const d = describe(o, state);
        return (
          <button
            key={i}
            className={`option ${highlight === i ? "hl" : ""}`}
            disabled={disabled}
            onMouseEnter={() => onHover(i)}
            onFocus={() => onHover(i)}
            onClick={() => onPick(i)}
          >
            <span className="key">{i + 1}</span>
            <span className="pairs">
              {o.pairs.map((pair, j) => (
                <span key={j} className={`pair ${j === 0 ? "a" : "b"}`}>
                  <MiniDie value={dice[pair[0]]!} />
                  <MiniDie value={dice[pair[1]]!} />
                  <b>{o.moves[j]}</b>
                </span>
              ))}
            </span>
            <span className="olabel">
              {d.label}
              <span className="tags">
                {d.fresh > 0 && <em className="tag new">+{d.fresh} climber{d.fresh > 1 ? "s" : ""}</em>}
                {d.summit && <em className="tag summit">summit!</em>}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RiskMeter({ risk }: { risk: number }) {
  const pct = Math.round(risk * 100);
  const level = pct < 15 ? "low" : pct < 35 ? "mid" : pct < 55 ? "high" : "extreme";
  const word = { low: "Calm skies", mid: "Loose snow", high: "Rumbling…", extreme: "Avalanche country!" }[level];
  return (
    <div className={`risk ${level}`}>
      <div className="risk-label">
        <span>Avalanche risk</span>
        <b>{pct}%</b>
      </div>
      <div className="risk-bar">
        <div style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <div className="risk-word">{word}</div>
    </div>
  );
}
