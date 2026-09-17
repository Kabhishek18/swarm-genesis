import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@swarm/schema": path.resolve(__dirname, "../schema/src/index.ts"),
      "@swarm/playbooks": path.resolve(__dirname, "../playbooks/src/index.ts"),
    },
  },
});

