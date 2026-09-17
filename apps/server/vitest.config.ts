import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@swarm/schema": path.resolve(__dirname, "../../packages/schema/src/index.ts"),
      "@swarm/kernel": path.resolve(__dirname, "../../packages/kernel/src/index.ts"),
      "@swarm/playbooks": path.resolve(__dirname, "../../packages/playbooks/src/index.ts"),
      "@swarm/runtime": path.resolve(__dirname, "../../packages/runtime/src/index.ts"),
    },
  },
});
