import path from "node:path";
import os from "node:os";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Keep Vite's cache outside node_modules so `npm ci` (e.g. on Railway) does not hit
// EBUSY removing node_modules/.vite when the cache dir is still referenced.
const cacheDir = path.join(os.tmpdir(), "veluma-vite-cache");

export default defineConfig({
  cacheDir,
  plugins: [react()],
  server: {
    port: 5173,
  },
});
