import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: { port: 5199 },
  // three.js alone is ~600 kB; one chunk is fine for a game.
  build: { chunkSizeWarningLimit: 1200 },
});
