import { useEffect, useRef, useState } from "react";
import { createGame, type PlayerInfo } from "../engine/rules";
import { MountainScene } from "../scene/MountainScene";
import { Game } from "./Game";
import { Setup } from "./Setup";

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<MountainScene | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[] | null>(null);
  const [gameId, setGameId] = useState(0);

  useEffect(() => {
    const s = new MountainScene(hostRef.current!);
    setScene(s);
    return () => s.dispose();
  }, []);

  // Menu: empty mountain gently swaying behind the setup card.
  useEffect(() => {
    if (!scene || players) return;
    scene.celebrate(false);
    scene.setAttract(true);
    scene.preview(null);
    scene.sync(createGame([
      { id: "x", name: "", color: "#fff", kind: "cpu" },
      { id: "y", name: "", color: "#fff", kind: "cpu" },
    ]));
    scene.setInsets({ right: window.innerWidth > 760 ? 460 : 0 });
    return () => scene.setAttract(false);
  }, [scene, players]);

  return (
    <>
      <div className="scene-host" ref={hostRef} />
      {scene && !players && <Setup onStart={setPlayers} />}
      {scene && players && (
        <Game
          // Remount for a rematch so the director starts fresh.
          key={gameId}
          scene={scene}
          players={players}
          onQuit={() => setPlayers(null)}
          onRematch={() => setGameId((g) => g + 1)}
        />
      )}
    </>
  );
}
