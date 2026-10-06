// The 2.5D diorama. Owns all Three.js objects; the game talks to it through
// `sync` (snap to a state) and the animation methods (play one event).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { COLUMN_HEIGHT, COLUMNS, type GameState, type MoveOption, type PlayerInfo, type Progress } from "../engine/rules";
import { STEP_DEPTH, SLOPE, Z0, colX, stepPoint, terrainHeight } from "./layout";
import {
  makeBadge,
  makeCairn,
  makeClimber,
  makeCloud,
  makeStone,
  makeSummitFlag,
  makeTent,
  makeTree,
  seeded,
  waveFlag,
  type Climber,
  type Flag,
} from "./models";

const ease = {
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t: number) => 1 - (1 - t) ** 3,
  in: (t: number) => t * t * t,
  elastic: (t: number) =>
    t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  linear: (t: number) => t,
};

interface Tween {
  start: number;
  dur: number;
  fn: (t: number) => void;
  ease: (t: number) => number;
  done: () => void;
}

/** Tent spots around a stepping stone, one per seat. */
const TENT_SLOTS: [number, number][] = [
  [-0.5, 0.14],
  [0.5, 0.14],
  [-0.5, -0.22],
  [0.5, -0.22],
];

class Particles {
  readonly mesh: THREE.InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private gravity: Float32Array;
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.spin = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    const white = new THREE.Color("#fff");
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, white);
    }
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, opts: { color?: THREE.ColorRepresentation; size?: number; life?: number; gravity?: number; spin?: number }) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    const sp = opts.spin ?? 4;
    this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.spin.set([(Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp], i * 3);
    this.life[i] = this.maxLife[i] = opts.life ?? 1.5;
    this.size[i] = opts.size ?? 0.1;
    this.gravity[i] = opts.gravity ?? 9;
    this.mesh.setColorAt(i, new THREE.Color(opts.color ?? "#ffffff"));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      this.life[i]! -= dt;
      const k = i * 3;
      this.vel[k + 1]! -= this.gravity[i]! * dt;
      for (let a = 0; a < 3; a++) {
        this.pos[k + a]! += this.vel[k + a]! * dt;
        this.rot[k + a]! += this.spin[k + a]! * dt;
      }
      const t = Math.max(0, this.life[i]! / this.maxLife[i]!);
      const sc = this.size[i]! * Math.min(1, t * 3);
      this.e.set(this.rot[k]!, this.rot[k + 1]!, this.rot[k + 2]!);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(this.pos[k]!, this.pos[k + 1]!, this.pos[k + 2]!), this.q, this.s.setScalar(sc));
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class MountainScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private world = new THREE.Group();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private tweens: Tween[] = [];
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private insets = { right: 0, bottom: 0 };

  private players: PlayerInfo[] = [];
  private tents = new Map<string, THREE.Group>();
  private climbers = new Map<number, Climber>();
  private climberOwner: string | null = null;
  private ghosts: THREE.Object3D[] = [];
  private flags = new Map<number, Flag>();
  private badges = new Map<number, THREE.Sprite>();
  private stones = new Map<number, THREE.Mesh[]>();
  private clouds: THREE.Group[] = [];
  private shake = 0;
  private snow: Particles;
  private confetti: Particles;
  private celebrating = false;
  private attract = false;
  /** Multiplier on animation durations (lower = faster). */
  timeScale = 1;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog("#cfe3f7", 34, 80);
    this.scene.add(this.world);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.75;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minAzimuthAngle = -0.7;
    this.controls.maxAzimuthAngle = 0.7;
    this.controls.rotateSpeed = 0.5;

    this.buildLights();
    this.buildTerrain();
    this.buildBackdrop();
    this.buildTrails();

    this.snow = new Particles(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }),
      700,
    );
    this.confetti = new Particles(
      new THREE.PlaneGeometry(1, 0.6),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 }),
      500,
    );
    this.world.add(this.snow.mesh, this.confetti.mesh);

    document.addEventListener("visibilitychange", this.flushTweens);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  // --- setup ----------------------------------------------------------------

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight("#dff1ff", "#7a6a8a", 1.5));
    const sun = new THREE.DirectionalLight("#fff1d6", 2.6);
    sun.position.set(-9, 18, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 14;
    sc.bottom = -10;
    sc.far = 60;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
  }

  private buildTerrain() {
    const W = 34;
    const D = 26;
    const geo = new THREE.PlaneGeometry(W, D, 96, 74);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -3);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, terrainHeight(p.getX(i), p.getZ(i)));
    const flat = geo.toNonIndexed();
    flat.computeVertexNormals();

    const pos = flat.attributes.position as THREE.BufferAttribute;
    const nrm = flat.attributes.normal as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grass = [new THREE.Color("#8fd16a"), new THREE.Color("#6fbf5e"), new THREE.Color("#a5d96f")];
    const rock = [new THREE.Color("#a59bb4"), new THREE.Color("#8f86a3"), new THREE.Color("#b6a99e")];
    const snow = new THREE.Color("#f7fbff");
    const snowShade = new THREE.Color("#dde8f6");
    const rand = seeded(7);
    for (let f = 0; f < pos.count; f += 3) {
      const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
      const steep = 1 - nrm.getY(f);
      const jitter = (rand() - 0.5) * 0.9;
      if (y > 6.4 + jitter) c.copy(steep > 0.45 ? snowShade : snow);
      else if (y > 1.4 + jitter * 0.6 || steep > 0.55) c.copy(rock[Math.floor(rand() * rock.length)]!);
      else c.copy(grass[Math.floor(rand() * grass.length)]!);
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (f + k) * 3);
    }
    flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(
      flat,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
    );
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.world.add(mesh);

    // Endless meadow beyond the terrain tile, fading into the fog.
    const meadow = new THREE.Mesh(
      new THREE.CircleGeometry(160, 48),
      new THREE.MeshStandardMaterial({ color: "#86c866", roughness: 1 }),
    );
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.y = -0.35;
    meadow.receiveShadow = true;
    this.world.add(meadow);
  }

  private buildBackdrop() {
    const rand = seeded(42);
    // Distant hazy peaks for depth.
    const peaks: [number, number, number, number][] = [
      [-18, -20, 9, 9],
      [-8, -27, 9, 11],
      [7, -28, 10, 10.5],
      [19, -21, 8, 8.5],
      [28, -25, 9, 7],
      [-28, -24, 9, 7],
    ];
    for (const [x, z, r, h] of peaks) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(r, h, 6 + Math.floor(rand() * 3), 1),
        new THREE.MeshStandardMaterial({ color: "#b4c3e3", flatShading: true, roughness: 1 }),
      );
      body.position.y = h / 2;
      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(r * 0.32, h * 0.32, body.geometry.parameters.radialSegments, 1),
        new THREE.MeshStandardMaterial({ color: "#f3f7ff", flatShading: true, roughness: 1 }),
      );
      cap.position.y = h - h * 0.16 + 0.02;
      g.add(body, cap);
      g.position.set(x, -0.5, z);
      g.rotation.y = rand() * Math.PI;
      this.world.add(g);
    }

    // Forest around the foot of the mountain, kept clear of trails.
    for (let i = 0; i < 140; i++) {
      const x = (rand() - 0.5) * 32;
      const z = 9 - rand() * 18;
      const u = Z0 - z;
      const nearTrail = COLUMNS.some((c) => Math.abs(x - colX(c)) < 0.85) && u > -1.4;
      const h = terrainHeight(x, z);
      if (nearTrail || h > 3.2 || (u > -1.2 && Math.abs(x) < 9.6 && h > 0.6)) continue;
      const tree = makeTree(rand, h > 2);
      tree.position.set(x, h - 0.05, z);
      this.world.add(tree);
    }

    for (let i = 0; i < 7; i++) {
      const cloud = makeCloud(rand);
      cloud.position.set((rand() - 0.5) * 50, 10 + rand() * 5, -8 - rand() * 12);
      cloud.userData.speed = 0.25 + rand() * 0.35;
      this.clouds.push(cloud);
      this.world.add(cloud);
    }
  }

  private buildTrails() {
    const rand = seeded(3);
    const pathMat = new THREE.MeshStandardMaterial({ color: "#b8957a", flatShading: true, roughness: 1 });
    for (const c of COLUMNS) {
      const stones: THREE.Mesh[] = [];
      // Packed-dirt path linking the stepping stones.
      for (let k = 0; k < COLUMN_HEIGHT[c]!; k++) {
        const a = stepPoint(c, k);
        const b = stepPoint(c, k + 1);
        const from = new THREE.Vector3(a.x, a.y - 0.07, a.z);
        const to = new THREE.Vector3(b.x, b.y - 0.07, b.z);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, from.distanceTo(to)), pathMat);
        seg.position.copy(from).lerp(to, 0.5);
        seg.lookAt(to);
        seg.receiveShadow = true;
        this.world.add(seg);
      }
      for (let k = 0; k <= COLUMN_HEIGHT[c]!; k++) {
        const p = stepPoint(c, k);
        const s = makeStone(rand);
        if (k === 0) s.scale.set(1.25, 1, 1.25);
        s.position.set(p.x, p.y - 0.05, p.z);
        this.world.add(s);
        stones.push(s);
      }
      this.stones.set(c, stones);

      const top = stepPoint(c, COLUMN_HEIGHT[c]!);
      const cairn = makeCairn();
      cairn.position.set(top.x + 0.42, top.y, top.z - 0.15);
      this.world.add(cairn);
      const flag = makeSummitFlag();
      flag.position.set(top.x - 0.05, top.y, top.z - 0.18);
      flag.visible = false;
      this.world.add(flag);
      this.flags.set(c, flag);

      const base = stepPoint(c, 0);
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.05, 0.5, 5),
        new THREE.MeshStandardMaterial({ color: "#7a5236", flatShading: true }),
      );
      post.position.set(base.x, base.y + 0.25, base.z + 0.55);
      post.castShadow = true;
      this.world.add(post);
      const badge = makeBadge(String(c), "#fff7e6", "#2b2140");
      badge.position.set(base.x, base.y + 0.68, base.z + 0.55);
      this.world.add(badge);
      this.badges.set(c, badge);
    }
  }

  // --- framing --------------------------------------------------------------

  setInsets(insets: { right?: number; bottom?: number }) {
    this.insets = { right: insets.right ?? 0, bottom: insets.bottom ?? 0 };
    this.resize();
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const vw = Math.max(1, w - this.insets.right);
    const vh = Math.max(1, h - this.insets.bottom);
    this.camera.aspect = w / h;
    // Shift the projection so the mountain centres in the visible area.
    this.camera.setViewOffset(w, h, this.insets.right / 2, this.insets.bottom / 2, w, h);

    const target = new THREE.Vector3(0, 4.1, 0.6);
    // Fit ~13 x 23 world units into the visible (un-inset) pixel area.
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const dist = Math.max((6.6 * h) / (vh * tan), (11.6 * h) / (vw * tan));
    const dir = new THREE.Vector3(0, Math.sin(0.36), Math.cos(0.36));
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    // Keep fog relative to the camera so narrow screens don't fog out the board.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist + 8;
    fog.far = dist + 50;
    this.camera.far = dist + 120;
    this.controls.minDistance = dist * 0.55;
    this.controls.maxDistance = dist * 1.25;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  // --- loop -----------------------------------------------------------------

  private loop = (now?: number) => {
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update(now);
    const dt = Math.min(0.05, this.timer.getDelta());
    const t = this.timer.getElapsed();

    for (const tw of [...this.tweens]) {
      const k = Math.min(1, (t - tw.start) / tw.dur);
      tw.fn(tw.ease(k));
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.done();
      }
    }

    for (const flag of this.flags.values()) if (flag.visible) waveFlag(flag, t);
    for (const cl of this.clouds) {
      cl.position.x += cl.userData.speed * dt;
      if (cl.position.x > 28) cl.position.x = -28;
    }
    for (const [i, g] of this.ghosts.entries()) {
      const ring = (g as Climber).userData.ring;
      if (ring) ring.scale.setScalar(1 + 0.25 * Math.sin(t * 6 + i));
      g.position.y = (g.userData.baseY ?? 0) + 0.08 + 0.06 * Math.sin(t * 4 + i);
    }
    for (const cl of this.climbers.values()) {
      if (!cl.userData.busy) cl.userData.body.position.y = Math.abs(Math.sin(t * 3 + cl.position.x)) * 0.03;
    }

    this.snow.update(dt);
    this.confetti.update(dt);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.8);
      const s = this.shake * this.shake * 0.5;
      this.world.position.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5);
    } else this.world.position.set(0, 0, 0);

    if (this.celebrating && Math.random() < dt * 2.5) this.firework();
    // Gentle diorama sway on the menu and during the victory lap.
    const swayTarget = this.celebrating || this.attract ? Math.sin(t * 0.25) * 0.22 : 0;
    this.world.rotation.y += (swayTarget - this.world.rotation.y) * Math.min(1, dt * 1.5);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private tween(dur: number, fn: (t: number) => void, e: (t: number) => number = ease.inOut): Promise<void> {
    // Hidden tabs get no animation frames; skip straight to the end state.
    if (document.hidden) {
      fn(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.push({ start: this.timer.getElapsed(), dur: Math.max(0.01, dur * this.timeScale), fn, ease: e, done: resolve });
    });
  }

  private flushTweens = () => {
    if (!document.hidden) return;
    for (const tw of this.tweens.splice(0)) {
      tw.fn(1);
      tw.done();
    }
  };

  private wait(sec: number) {
    return this.tween(sec, () => {});
  }

  // --- state sync -----------------------------------------------------------

  setPlayers(players: PlayerInfo[]) {
    this.players = players;
  }

  private color(playerId: string) {
    return this.players.find((p) => p.id === playerId)?.color ?? "#ffffff";
  }

  private tentPos(playerId: string, column: number, step: number): THREE.Vector3 {
    const seat = Math.max(0, this.players.findIndex((p) => p.id === playerId));
    const p = stepPoint(column, step);
    const [dx, dz] = TENT_SLOTS[seat]!;
    return new THREE.Vector3(p.x + dx, terrainHeight(p.x + dx, p.z + dz), p.z + dz);
  }

  private climberPos(column: number, step: number): THREE.Vector3 {
    const p = stepPoint(column, step);
    return new THREE.Vector3(p.x, p.y + 0.06, p.z + 0.04);
  }

  /** Snap every piece to match `state`. Idempotent. */
  sync(state: GameState) {
    const wanted = new Set<string>();
    for (const [pid, prog] of Object.entries(state.camps)) {
      for (const [col, step] of Object.entries(prog)) {
        const key = `${pid}:${col}`;
        wanted.add(key);
        let tent = this.tents.get(key);
        if (!tent) {
          tent = makeTent(this.color(pid));
          tent.scale.setScalar(1);
          this.world.add(tent);
          this.tents.set(key, tent);
        }
        tent.position.copy(this.tentPos(pid, Number(col), step));
        tent.rotation.y = 0;
      }
    }
    for (const [key, tent] of this.tents) {
      if (!wanted.has(key)) {
        this.world.remove(tent);
        this.tents.delete(key);
      }
    }

    const owner = state.players[state.current]?.id ?? null;
    if (owner !== this.climberOwner) this.clearClimbers();
    this.climberOwner = owner;
    for (const [col, step] of Object.entries(state.runners)) {
      const c = Number(col);
      let cl = this.climbers.get(c);
      if (!cl) {
        cl = makeClimber(this.color(owner!));
        this.world.add(cl);
        this.climbers.set(c, cl);
      }
      cl.position.copy(this.climberPos(c, step));
      cl.scale.setScalar(1);
      cl.rotation.set(0, Math.PI, 0);
    }
    for (const [c, cl] of this.climbers) {
      if (state.runners[c] === undefined) {
        this.world.remove(cl);
        this.climbers.delete(c);
      }
    }

    for (const c of COLUMNS) {
      const by = state.claimed[c];
      const flag = this.flags.get(c)!;
      flag.visible = !!by;
      if (by) {
        (flag.userData.cloth.material as THREE.MeshStandardMaterial).color.set(this.color(by));
        flag.userData.mast.scale.set(1, 1, 1);
      }
      this.badges.get(c)!.userData.redraw(by ? this.color(by) : "#fff7e6", by ? "#ffffff" : "#2b2140");
      for (const s of this.stones.get(c)!) {
        const m = s.material as THREE.MeshStandardMaterial;
        if (!m.userData.base) m.userData.base = m.color.clone();
        m.color.copy(m.userData.base);
        if (by) m.color.lerp(new THREE.Color(this.color(by)), 0.45);
      }
    }
  }

  private clearClimbers() {
    for (const cl of this.climbers.values()) this.world.remove(cl);
    this.climbers.clear();
  }

  // --- previews -------------------------------------------------------------

  preview(option: MoveOption | null, state?: GameState) {
    for (const g of this.ghosts) this.world.remove(g);
    this.ghosts = [];
    if (!option || !state) return;
    const player = state.players[state.current]!;
    const reached = new Map<number, number>();
    for (const c of option.moves) {
      const from = reached.get(c) ?? state.runners[c] ?? state.camps[player.id]?.[c] ?? 0;
      reached.set(c, from + 1);
    }
    for (const [c, step] of reached) {
      const g = makeClimber(player.color, true);
      const p = this.climberPos(c, step);
      g.position.copy(p);
      g.rotation.y = Math.PI;
      g.userData.baseY = p.y;
      this.world.add(g);
      this.ghosts.push(g);
    }
  }

  // --- event animations -----------------------------------------------------

  async advance(e: { player: string; column: number; from: number; to: number; newRunner: boolean }) {
    let cl = this.climbers.get(e.column);
    if (!cl || e.newRunner) {
      if (cl) this.world.remove(cl);
      cl = makeClimber(this.color(e.player));
      cl.position.copy(this.climberPos(e.column, e.from));
      cl.rotation.y = Math.PI;
      cl.scale.setScalar(0.01);
      this.world.add(cl);
      this.climbers.set(e.column, cl);
      this.climberOwner = e.player;
      const c = cl;
      // Pop out of the trailhead (or out of the player's tent).
      await this.tween(0.28, (t) => c.scale.setScalar(Math.max(0.01, t)), ease.elastic);
    }
    const climber = cl;
    climber.userData.busy = true;
    const a = this.climberPos(e.column, e.from);
    const b = this.climberPos(e.column, e.to);
    const body = climber.userData.body;
    await this.tween(
      0.34,
      (t) => {
        climber.position.lerpVectors(a, b, t);
        climber.position.y += Math.sin(Math.PI * t) * 0.45;
        body.rotation.x = -Math.sin(Math.PI * t) * 0.35;
      },
      ease.inOut,
    );
    await this.tween(0.12, (t) => body.scale.set(1 + 0.15 * Math.sin(Math.PI * t), 1 - 0.18 * Math.sin(Math.PI * t), 1), ease.linear);
    climber.userData.busy = false;
  }

  async bust(_player: string, runners: Progress) {
    this.preview(null);
    this.shake = 1.6;
    const cols = Object.keys(runners).map(Number);
    const focus = cols.length ? cols : [7];

    // Avalanche: snow and boulders pour down the face above the climbers.
    const downhill = new THREE.Vector3(0, -SLOPE, 1).normalize();
    const spawnWave = (count: number) => {
      for (let i = 0; i < count; i++) {
        const c = focus[Math.floor(Math.random() * focus.length)]!;
        const x = colX(c) + (Math.random() - 0.5) * 3.2;
        const topU = COLUMN_HEIGHT[c]! * STEP_DEPTH + Math.random() * 0.8;
        const z = Z0 - topU;
        const pos = new THREE.Vector3(x, terrainHeight(x, z) + 0.25 + Math.random() * 0.4, z);
        const speed = 5 + Math.random() * 4;
        const vel = downhill.clone().multiplyScalar(speed).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6, 0));
        const boulder = Math.random() < 0.06;
        this.snow.spawn(pos, vel, {
          color: boulder ? "#7d7290" : Math.random() < 0.3 ? "#dfe9f7" : "#ffffff",
          size: boulder ? 0.22 + Math.random() * 0.15 : 0.06 + Math.random() * 0.12,
          life: 1.4 + Math.random() * 0.6,
          gravity: 1.5,
          spin: boulder ? 10 : 5,
        });
      }
    };
    let spawned = 0;
    const snowTween = this.tween(
      0.9,
      (t) => {
        const target = Math.floor(t * 520);
        spawnWave(target - spawned);
        spawned = target;
      },
      ease.linear,
    );

    // Climbers get swept off their feet and tumble back down to the trailhead.
    const tumbles = [...this.climbers.entries()].map(async ([c, cl]) => {
      cl.userData.busy = true;
      const startStep = runners[c] ?? 0;
      await this.wait(0.15 + Math.random() * 0.2);
      const spinX = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6);
      const spinZ = (Math.random() - 0.5) * 8;
      await this.tween(
        1.3,
        (t) => {
          const k = startStep * (1 - t);
          const lo = Math.floor(k);
          const p0 = this.climberPos(c, lo);
          const p1 = this.climberPos(c, Math.min(startStep, lo + 1));
          cl.position.lerpVectors(p0, p1, k - lo);
          cl.position.y += Math.abs(Math.sin(t * Math.PI * 4)) * 0.6 * (1 - t) + 0.1;
          cl.position.x += Math.sin(t * 9 + c) * 0.25 * (1 - t);
          cl.rotation.x = spinX * t;
          cl.rotation.z = spinZ * t;
        },
        ease.in,
      );
      this.puff(cl.position, "#ffffff", 16);
      await this.tween(0.2, (t) => cl.scale.setScalar(Math.max(0.01, 1 - t)));
      this.world.remove(cl);
    });

    await Promise.all([snowTween, ...tumbles]);
    this.climbers.clear();
    await this.wait(0.4);
  }

  async bank(player: string, runners: Progress, previous: Progress) {
    this.preview(null);
    const jobs = Object.entries(runners).map(async ([col, step], i) => {
      const c = Number(col);
      await this.wait(i * 0.15);
      const cl = this.climbers.get(c);
      const key = `${player}:${c}`;
      const old = this.tents.get(key);
      if (old && previous[c] !== undefined) {
        this.tents.delete(key);
        const o = old;
        void this.tween(0.25, (t) => o.scale.setScalar(Math.max(0.01, (1 - t)))).then(() => this.world.remove(o));
      }
      if (cl) {
        cl.userData.busy = true;
        const y0 = cl.position.y;
        await this.tween(0.4, (t) => {
          cl.position.y = y0 + Math.sin(Math.PI * t) * 0.6;
          cl.rotation.y = Math.PI + t * Math.PI * 2;
        });
      }
      const tent = makeTent(this.color(player));
      tent.position.copy(this.tentPos(player, c, step));
      tent.scale.setScalar(0.01);
      this.world.add(tent);
      this.tents.set(key, tent);
      this.puff(tent.position, "#f3e7cf", 8);
      if (cl) {
        void this.tween(0.25, (t) => cl.scale.setScalar(Math.max(0.01, 1 - t))).then(() => {
          this.world.remove(cl);
          this.climbers.delete(c);
        });
      }
      await this.tween(0.5, (t) => tent.scale.setScalar(Math.max(0.01, t)), ease.elastic);
    });
    await Promise.all(jobs);
  }

  async claim(player: string, column: number, evicted: string[]) {
    const flag = this.flags.get(column)!;
    (flag.userData.cloth.material as THREE.MeshStandardMaterial).color.set(this.color(player));
    flag.visible = true;
    flag.userData.mast.scale.set(1, 0.01, 1);
    for (const pid of evicted) {
      const key = `${pid}:${column}`;
      const tent = this.tents.get(key);
      if (!tent) continue;
      this.tents.delete(key);
      this.puff(tent.position, "#bbb3c9", 14);
      void this.tween(0.3, (t) => tent.scale.setScalar(Math.max(0.01, (1 - t)))).then(() => this.world.remove(tent));
    }
    const top = stepPoint(column, COLUMN_HEIGHT[column]!);
    const origin = new THREE.Vector3(top.x, top.y + 1, top.z);
    for (let i = 0; i < 90; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, 3 + Math.random() * 4, (Math.random() - 0.5) * 3);
      this.confetti.spawn(origin, v, {
        color: i % 3 === 0 ? "#ffd23f" : i % 3 === 1 ? this.color(player) : "#ffffff",
        size: 0.12,
        life: 1.8 + Math.random(),
        gravity: 5,
        spin: 12,
      });
    }
    await this.tween(0.8, (t) => flag.userData.mast.scale.set(1, Math.max(0.01, t), 1), ease.elastic);
    for (const s of this.stones.get(column)!) {
      const m = s.material as THREE.MeshStandardMaterial;
      if (!m.userData.base) m.userData.base = m.color.clone();
      const from = m.color.clone();
      const to = (m.userData.base as THREE.Color).clone().lerp(new THREE.Color(this.color(player)), 0.45);
      void this.tween(0.6, (t) => m.color.lerpColors(from, to, t));
    }
    await this.wait(0.3);
  }

  celebrate(on: boolean) {
    this.celebrating = on;
  }

  /** Idle menu mode: slow sway, nothing on the board. */
  setAttract(on: boolean) {
    this.attract = on;
  }

  private firework() {
    const origin = new THREE.Vector3((Math.random() - 0.5) * 16, 7 + Math.random() * 4, -2 + Math.random() * 4);
    const palette = this.players.map((p) => p.color).concat("#ffd23f", "#ffffff");
    const color = palette[Math.floor(Math.random() * palette.length)]!;
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 1.5);
      this.confetti.spawn(origin, v, { color, size: 0.1, life: 1.4, gravity: 2.5, spin: 10 });
    }
  }

  private puff(at: THREE.Vector3, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.8 + Math.random(), (Math.random() - 0.5) * 1.6);
      this.snow.spawn(at.clone().add(new THREE.Vector3(0, 0.15, 0)), v, { color, size: 0.08 + Math.random() * 0.06, life: 0.6, gravity: 2 });
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.flushTweens);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function skyTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#5aa7e8");
  g.addColorStop(0.55, "#a9d4f5");
  g.addColorStop(0.85, "#ffe4c9");
  g.addColorStop(1, "#ffd1b0");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
