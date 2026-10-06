# Can't Stop — Summit Fever

A 2.5D browser take on Sid Sackson's push-your-luck classic. Columns 2–12 are
trails up a low-poly mountain; temporary runners are climbers, banked progress
is tents, and a claimed column gets a summit flag. Busting sets off an avalanche.

## Run it

```sh
bun install
bun run dev        # http://localhost:5199
bun run test       # rules engine tests
bun run typecheck
bun scripts/simulate.ts 1000   # headless CPU-vs-CPU tournament stats
```

`bun run dev` runs inside the real Workers runtime via `@cloudflare/vite-plugin`,
so `/api/*` hits `worker/index.ts` locally exactly as it will in production.

## Deploy (Cloudflare Workers)

```sh
bunx wrangler whoami          # check which account you're logged in to
bunx wrangler deploy --dry-run   # after `bun run build`: validate without uploading
bun run deploy                # typecheck + build + wrangler deploy
```

- One Worker (`cant-stop`) serves the built game as static assets, with SPA
  fallback. Only `/api/*` runs Worker code (`run_worker_first`).
- Live at https://cantstop.myslop.app (custom domain on the `myslop.app` zone;
  `workers.dev` is disabled).
- After changing bindings in `wrangler.jsonc`, run `bun run cf-typegen` to
  regenerate `worker-configuration.d.ts`.

## Layout

| Path | What |
| --- | --- |
| `src/engine/rules.ts` | Pure, serialisable rules engine. Dice are passed in with the `roll` action, so the same code can run server-side. Emits events for animation. |
| `src/engine/ai.ts` | CPU personalities. One shared evaluator (exact bust odds over all 1,296 rolls + progress value), tuned per personality. |
| `src/game/director.ts` | Applies actions, plays events one at a time through the scene/HUD, drives CPU turns. |
| `src/scene/` | Three.js diorama: terrain, trails, climbers, tents, flags, avalanche/confetti particles. |
| `src/ui/` | React HUD: setup, player cards, CSS 3D dice, move list, risk meter, overlays. |
| `src/audio/sfx.ts` | Synthesised WebAudio sound effects (no assets). |
| `worker/index.ts` | Cloudflare Worker for `/api/*` (health check now; online rooms next). |

## CPU personalities

| | Name | Style |
| --- | --- | --- |
| 🦉 | Professor Hoot | Balanced, odds-driven, looks ahead at the risk each move leaves. |
| 🐢 | Tess the Tortoise | Banks early, prefers middle trails, camps the moment a summit is reached. |
| 🧨 | Dax Daredevil | Huge risk tolerance; busts ~75% of turns but makes giant leaps. |
| 🐐 | Billy the Goat | Strongly prefers edge trails 2, 3, 11, 12. |
| 🌋 | Hothead Hal | Each bust adds tilt (more reckless); banking calms them down. |
| 🦊 | Sly the Fox | Races rivals on the trails they're closest to finishing; reckless when someone's near winning. |
| 🍀 | Lucky Lou | Two random lucky trails per game; stop decisions are gut feel. |

## Next up

- Online play: Cloudflare Worker + one Durable Object per room (authoritative
  `applyAction`, WebSocket fan-out of events), room codes with optional
  password, public lobby list.
