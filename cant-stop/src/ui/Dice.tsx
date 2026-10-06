import { useEffect, useRef, useState } from "react";

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// Cube faces: front 1, top 2, right 3, left 4, bottom 5, back 6.
const FACE_ROT: Record<number, [number, number]> = {
  1: [0, 0],
  2: [-90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [90, 0],
  6: [0, 180],
};

function Face({ value, cls }: { value: number; cls: string }) {
  return (
    <div className={`face ${cls}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={PIPS[value]!.includes(i) ? "pip" : ""} />
      ))}
    </div>
  );
}

export function Die({ value, rollId, index, group }: { value: number | null; rollId: number; index: number; group: "a" | "b" | null }) {
  const spins = useRef({ x: 0, y: 0, z: 0 });
  const [rot, setRot] = useState({ x: -18, y: 22, z: 0 });
  const [tossing, setTossing] = useState(false);

  useEffect(() => {
    if (value === null || rollId === 0) return;
    // Accumulate whole turns so every roll visibly tumbles.
    spins.current.x += 360 * (2 + Math.floor(Math.random() * 2));
    spins.current.y += 360 * (1 + Math.floor(Math.random() * 2));
    const [fx, fy] = FACE_ROT[value]!;
    setRot({ x: spins.current.x + fx, y: spins.current.y + fy, z: (Math.random() - 0.5) * 16 });
    setTossing(true);
    const t = setTimeout(() => setTossing(false), 1000);
    return () => clearTimeout(t);
  }, [rollId]);

  return (
    <div className={`die-slot ${tossing ? "tossing" : ""} ${group ? `group-${group}` : ""} ${value === null ? "idle" : ""}`} style={{ animationDelay: `${index * 40}ms` }}>
      <div className="die" style={{ transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg) rotateZ(${rot.z}deg)`, transitionDelay: `${index * 40}ms` }}>
        <Face value={1} cls="f1" />
        <Face value={2} cls="f2" />
        <Face value={3} cls="f3" />
        <Face value={4} cls="f4" />
        <Face value={5} cls="f5" />
        <Face value={6} cls="f6" />
      </div>
      <div className="die-shadow" />
    </div>
  );
}

export function MiniDie({ value }: { value: number }) {
  return (
    <span className="mini-die">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={PIPS[value]!.includes(i) ? "pip" : ""} />
      ))}
    </span>
  );
}
