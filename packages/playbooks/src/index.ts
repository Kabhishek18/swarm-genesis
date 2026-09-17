import { featureDevPlaybook } from "./feature-dev.js";
import { marketIntelPlaybook } from "./market-intel.js";
import type { Playbook } from "@swarm/schema";

export { featureDevPlaybook } from "./feature-dev.js";
export { marketIntelPlaybook } from "./market-intel.js";
export { simulatedAdapter } from "./adapters.js";

export const playbooks: Playbook[] = [featureDevPlaybook, marketIntelPlaybook];

export function getPlaybook(id: string): Playbook {
  const playbook = playbooks.find((item) => item.id === id);
  if (!playbook) throw new Error(`Unknown playbook ${id}`);
  return playbook;
}
