import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// TEMPORARY verification harness — renders real pages against the LIVE database.
export default defineConfig({
  plugins: [react()],
  cacheDir: path.resolve(__dirname, "./.vite-cache-live"),
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/live-render.setup.ts"],
    include: ["src/**/*.livecheck.tsx"],
    testTimeout: 180000,
    hookTimeout: 180000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
