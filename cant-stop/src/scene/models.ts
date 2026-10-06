// Low-poly props: climbers, tents, flags, cairns, trees, clouds.

import * as THREE from "three";

const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...extra });

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

export function darker(color: string, amount = 0.35): THREE.Color {
  return new THREE.Color(color).lerp(new THREE.Color("#1a1530"), amount);
}

const CLIMBER_SIZE = 1.45;
const TENT_SIZE = 1.15;

export interface Climber extends THREE.Group {
  userData: { body: THREE.Group; ring: THREE.Mesh; busy?: boolean; baseY?: number };
}

export function makeClimber(color: string, ghost = false): Climber {
  const g = new THREE.Group() as Climber;
  const body = new THREE.Group();
  const jacket = mat(color, ghost ? { transparent: true, opacity: 0.45 } : {});
  const dark = mat(darker(color), ghost ? { transparent: true, opacity: 0.45 } : {});
  const skin = mat("#ffd2a6", ghost ? { transparent: true, opacity: 0.45 } : {});
  const pack = mat("#8a5a3b", ghost ? { transparent: true, opacity: 0.45 } : {});

  const legGeo = new THREE.BoxGeometry(0.09, 0.18, 0.1);
  const legL = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.06, 0.09, 0);
  const legR = legL.clone();
  legR.position.x = 0.06;

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.14, 2, 7), jacket);
  torso.position.y = 0.31;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), skin);
  head.position.y = 0.53;
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.115, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  hat.position.y = 0.55;
  const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), mat("#ffffff"));
  pom.position.y = 0.68;
  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.12), pack);
  backpack.position.set(0, 0.33, -0.14);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), mat("#e8c547"));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 0.47, -0.14);

  body.add(legL, legR, torso, head, hat, pom, backpack, roll);
  if (!ghost) shadowed(body);
  // Inner wrapper carries the model's size so animations can own `g.scale`.
  const inner = new THREE.Group();
  inner.scale.setScalar(CLIMBER_SIZE);
  inner.add(body);
  g.add(inner);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.28, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ghost ? 0.9 : 0.55, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  inner.add(ring);
  g.userData = { body, ring };
  return g;
}

export function makeTent(color: string): THREE.Group {
  const outer = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(TENT_SIZE);
  outer.add(g);
  const tent = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.32, 4), mat(color));
  tent.rotation.y = Math.PI / 4;
  tent.position.y = 0.16;
  tent.scale.z = 0.8;
  const door = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 3), mat(darker(color, 0.6)));
  door.position.set(0, 0.1, 0.13);
  door.rotation.y = Math.PI;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4), mat("#5a4a3a"));
  pole.position.y = 0.4;
  const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 3), mat(darker(color, 0.15)));
  pennant.rotation.z = -Math.PI / 2;
  pennant.position.set(0.06, 0.47, 0);
  g.add(tent, door, pole, pennant);
  shadowed(g);
  return outer;
}

export interface Flag extends THREE.Group {
  userData: { cloth: THREE.Mesh; base: Float32Array; mast: THREE.Group };
}

export function makeSummitFlag(): Flag {
  const g = new THREE.Group() as Flag;
  const mast = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.1, 5), mat("#d9d4cf"));
  pole.position.y = 0.55;
  const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), mat("#ffd23f", { metalness: 0.4, roughness: 0.4 }));
  knob.position.y = 1.12;
  const clothGeo = new THREE.PlaneGeometry(0.62, 0.4, 10, 4);
  clothGeo.translate(0.31, 0, 0);
  const cloth = new THREE.Mesh(clothGeo, mat("#ffffff", { side: THREE.DoubleSide }));
  cloth.position.set(0.02, 0.86, 0);
  mast.add(pole, knob, cloth);
  g.add(shadowed(mast));
  g.userData = { cloth, base: Float32Array.from(clothGeo.attributes.position!.array), mast };
  return g;
}

export function waveFlag(flag: Flag, t: number) {
  const pos = flag.userData.cloth.geometry.attributes.position as THREE.BufferAttribute;
  const base = flag.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3]!;
    pos.setZ(i, Math.sin(x * 9 - t * 6 + base[i * 3 + 1]! * 2) * 0.06 * x * 2.4);
  }
  pos.needsUpdate = true;
  flag.userData.cloth.geometry.computeVertexNormals();
}

export function makeCairn(): THREE.Group {
  const g = new THREE.Group();
  const stone = mat("#9b95a6");
  const sizes = [0.2, 0.15, 0.1];
  let y = 0;
  sizes.forEach((r, i) => {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), stone);
    s.scale.y = 0.6;
    y += r * 0.6 * (i === 0 ? 1 : 1.6);
    s.position.y = y;
    s.rotation.y = i;
    g.add(s);
  });
  return shadowed(g);
}

export function makeStone(rand: () => number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.46, 0.16, 7),
    mat(new THREE.Color("#efe3c8").offsetHSL(0, 0, (rand() - 0.5) * 0.08)),
  );
  m.rotation.y = rand() * Math.PI;
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

export function makeTree(rand: () => number, snowy = false): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 5), mat("#6b4a32"));
  trunk.position.y = 0.15;
  g.add(trunk);
  const greens = ["#2f8f5b", "#3aa167", "#287a52"];
  const tiers = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < tiers; i++) {
    const r = 0.42 - i * 0.1;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 0.5, 6), mat(greens[i % greens.length]!));
    cone.position.y = 0.4 + i * 0.27;
    cone.rotation.y = rand() * Math.PI;
    g.add(cone);
  }
  if (snowy) {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.2, 6), mat("#ffffff"));
    cap.position.y = 0.42 + (tiers - 1) * 0.27 + 0.18;
    g.add(cap);
  }
  const s = 0.7 + rand() * 0.6;
  g.scale.setScalar(s);
  return shadowed(g);
}

export function makeCloud(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const m = mat("#ffffff", { roughness: 1, emissive: "#ffffff", emissiveIntensity: 0.15 });
  const puffs = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < puffs; i++) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + rand() * 0.6, 1), m);
    p.position.set((i - puffs / 2) * 0.75, rand() * 0.35, rand() * 0.4);
    p.scale.y = 0.65;
    g.add(p);
  }
  return g;
}

/** Round number badge drawn to a canvas, used for trail signs. */
export function makeBadge(text: string, fill: string, ink = "#ffffff"): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.userData.redraw = (bg: string, fg: string) => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(30,20,50,0.85)";
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.font = "64px 'Lilita One', 'Nunito', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, size / 2, size / 2 + 4);
    tex.needsUpdate = true;
  };
  sprite.userData.redraw(fill, ink);
  sprite.scale.setScalar(0.62);
  return sprite;
}

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
