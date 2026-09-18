import { bugFixPlaybook } from "./bug-fix.js";
import { buildWebsitePlaybook } from "./build-website.js";
import { codeReviewPlaybook } from "./code-review.js";
import { draftReplyPlaybook } from "./draft-reply.js";
import { featureDevPlaybook } from "./feature-dev.js";
import { marketIntelPlaybook } from "./market-intel.js";
import { writeDocPlaybook } from "./write-doc.js";
import type { Playbook } from "@swarm/schema";

export { bugFixPlaybook } from "./bug-fix.js";
export { buildWebsitePlaybook } from "./build-website.js";
export { codeReviewPlaybook } from "./code-review.js";
export { draftReplyPlaybook } from "./draft-reply.js";
export { featureDevPlaybook } from "./feature-dev.js";
export { marketIntelPlaybook } from "./market-intel.js";
export { writeDocPlaybook } from "./write-doc.js";
export { simulatedAdapter } from "./adapters.js";

export const playbooks: Playbook[] = [
  featureDevPlaybook,
  marketIntelPlaybook,
  buildWebsitePlaybook,
  bugFixPlaybook,
  writeDocPlaybook,
  codeReviewPlaybook,
  draftReplyPlaybook,
];

export function getPlaybook(id: string): Playbook {
  const playbook = playbooks.find((item) => item.id === id);
  if (!playbook) throw new Error(`Unknown playbook ${id}`);
  return playbook;
}
