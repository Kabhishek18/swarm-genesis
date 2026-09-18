import { useEffect, useState } from "react";
import type { AgentSnapshot, RunSnapshot } from "@swarm/schema";

type ProducedFile = { path: string; bytes: number };

export function mergeProducedFiles(
  snapshotFiles: ProducedFile[] | undefined,
  diskFiles: ProducedFile[],
): ProducedFile[] {
  const merged = new Map<string, ProducedFile>();
  for (const file of snapshotFiles ?? []) merged.set(file.path, file);
  for (const file of diskFiles) merged.set(file.path, file);
  return [...merged.values()];
}

interface OpsProps {
  snapshot: RunSnapshot;
}

export function pickLiveAgent(snapshot: RunSnapshot): AgentSnapshot | null {
  if (!snapshot.agents.length) return null;
  let latest: AgentSnapshot | null = null;
  let latestAt = -1;
  for (const agent of snapshot.agents) {
    const thought = agent.thoughts?.[agent.thoughts.length - 1];
    if (thought && thought.at >= latestAt) {
      latestAt = thought.at;
      latest = agent;
    }
  }
  if (latest) return latest;
  const busy = snapshot.agents.find((agent) => agent.activity !== "idling");
  if (busy) return busy;
  return snapshot.agents.find((agent) => agent.kind === "meta") ?? snapshot.agents[0];
}

export function formatArtifact(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "summary" in value) {
    const record = value as { summary?: unknown } & Record<string, unknown>;
    if (typeof record.summary === "string" && record.summary.trim()) {
      const rest = { ...record };
      delete rest.summary;
      const extra = Object.keys(rest).length ? `\n${JSON.stringify(rest, null, 2)}` : "";
      return record.summary + extra;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function joinThoughts(thoughts: { delta: string }[] | undefined): string {
  if (!thoughts?.length) return "";
  return thoughts
    .map((thought) => thought.delta)
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isNoiseArtifact(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if ("terminated" in record) return true;
  const keys = Object.keys(record);
  return keys.includes("ttl") && !keys.includes("summary");
}

function readableArtifact(value: unknown): string {
  if (isNoiseArtifact(value)) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value !== null && "summary" in value) {
    const summary = (value as { summary?: unknown }).summary;
    if (typeof summary === "string" && summary.trim()) return summary.trim();
  }
  return "";
}

function plainActivity(activity: AgentSnapshot["activity"]): string {
  switch (activity) {
    case "thinking":
      return "thinking";
    case "fetching":
      return "fetching information";
    case "idling":
      return "waiting";
    case "reviewing":
      return "reviewing";
    case "spawning":
      return "spawning a helper";
    default:
      return activity;
  }
}

function collectDeliverables(snapshot: RunSnapshot): { title: string; body: string }[] {
  const items: { title: string; body: string }[] = [];
  const seen = new Set<string>();
  for (const task of snapshot.tasks) {
    if (task.status !== "completed" && task.status !== "failed") continue;
    const agent = snapshot.agents.find((item) => item.id === task.assignee);
    const body = task.error || readableArtifact(agent?.lastArtifact);
    if (!body) continue;
    seen.add(task.assignee);
    items.push({ title: task.title, body });
  }
  for (const agent of snapshot.agents) {
    if (seen.has(agent.id) || agent.lastArtifact === undefined) continue;
    const body = readableArtifact(agent.lastArtifact);
    if (!body) continue;
    items.push({ title: agent.name, body });
  }
  return items;
}

function AnswerText({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    <div className="answer">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

function failureMessage(snapshot: RunSnapshot): string | null {
  const failedTask = snapshot.tasks.find((task) => task.status === "failed" && task.error);
  if (failedTask?.error) return failedTask.error;
  const alert = [...snapshot.alerts].reverse().find((item) => item.level === "critical" || item.level === "warn");
  return alert?.message ?? null;
}

export function Hud({ snapshot }: OpsProps) {
  const tokenPct = snapshot.budget.tokensLimit
    ? Math.min(100, (snapshot.budget.tokensUsed / snapshot.budget.tokensLimit) * 100)
    : 0;
  const timePct = snapshot.budget.wallClockLimitMs
    ? Math.min(100, (snapshot.budget.wallClockMs / snapshot.budget.wallClockLimitMs) * 100)
    : 0;

  return (
    <aside className="hud">
      <section>
        <h2>Ops</h2>
        <p className="goal">{snapshot.goal || "Idle — no run yet."}</p>
        <div className="meters">
          <Meter
            label="Tokens"
            value={`${snapshot.budget.tokensUsed} / ${snapshot.budget.tokensLimit || 0}`}
            pct={tokenPct}
          />
          <Meter
            label="Wall clock"
            value={`${(snapshot.budget.wallClockMs / 1000).toFixed(1)}s / ${(snapshot.budget.wallClockLimitMs / 1000).toFixed(0)}s`}
            pct={timePct}
          />
          <div className="stat-row">
            <span>Live agents</span>
            <strong>
              {snapshot.budget.liveAgents} / {snapshot.budget.maxLiveAgents || 0}
            </strong>
          </div>
          <div className="stat-row">
            <span>Sub-agents</span>
            <strong>
              {snapshot.budget.liveSubagents} / {snapshot.budget.maxVisibleSubagents || 0}
            </strong>
          </div>
        </div>
        <div className="domains">
          {snapshot.domains.map((domain) => (
            <article key={domain.id} className={domain.open ? "open" : ""}>
              <header>
                <strong>{domain.name}</strong>
                <span>{domain.open ? "open" : "closed"}</span>
              </header>
              <p>
                queue {domain.queued} · locked {domain.locked} · running {domain.running} · done {domain.completed}
              </p>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2>Tasks</h2>
        {snapshot.tasks.length === 0 ? (
          <p className="muted">No tasks yet.</p>
        ) : (
          <ul className="log tasks">
            {snapshot.tasks.map((task) => (
              <li key={task.id} className={task.status}>
                <span className="tag">{task.status}</span> {task.title}
                {task.lastVote ? ` · ${task.lastVote.vote}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>Alerts</h2>
        {snapshot.alerts.length === 0 ? (
          <p className="muted">Quiet.</p>
        ) : (
          <ul className="log">
            {snapshot.alerts.slice(-5).map((alert) => (
              <li key={alert.id} className={alert.level}>
                [{alert.code}] {alert.message}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>Handoffs</h2>
        {snapshot.handoffs.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <ul className="log">
            {snapshot.handoffs.slice(-4).map((handoff) => (
              <li key={handoff.id} className={handoff.rejected ? "bad" : ""}>
                {handoff.from} → {handoff.to}
                {handoff.rejected ? " rejected" : ""} · {handoff.reason}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>Votes</h2>
        {(snapshot.votes ?? []).length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <ul className="log">
            {(snapshot.votes ?? []).slice(-4).map((vote, index) => (
              <li key={`${vote.taskId}-${index}`} className={vote.vote === "reject" ? "bad" : ""}>
                {vote.voterId} {vote.vote} · {vote.reason}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

export function ResultsPanel({
  snapshot,
  selected,
  pinned,
  onFollowLive,
}: {
  snapshot: RunSnapshot;
  selected: AgentSnapshot | null;
  pinned: boolean;
  onFollowLive: () => void;
}) {
  const children = (selected?.children ?? [])
    .map((id) => snapshot.agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentSnapshot => Boolean(agent));
  const votes = selected
    ? (snapshot.votes ?? []).filter(
        (vote) =>
          vote.voterId === selected.id ||
          snapshot.tasks.some((task) => task.id === vote.taskId && task.assignee === selected.id),
      )
    : [];
  const ended = snapshot.status === "completed" || snapshot.status === "failed";
  const deliverables = ended ? collectDeliverables(snapshot) : [];
  const failText = snapshot.status === "failed" ? failureMessage(snapshot) : null;
  const idle = snapshot.status === "idle" && !snapshot.agents.length;
  const answerText = selected
    ? readableArtifact(selected.lastArtifact) || joinThoughts(selected.thoughts)
    : "";
  const snapshotFiles = snapshot.files ?? [];
  const [diskFiles, setDiskFiles] = useState<ProducedFile[]>([]);
  const runId = snapshot.runId;
  useEffect(() => {
    setDiskFiles([]);
    if (!runId) return;
    const shouldFetch = ended || snapshotFiles.length === 0;
    if (!shouldFetch) return;
    let cancelled = false;
    void fetch(`/api/runs/${runId}/files`)
      .then((res) => (res.ok ? (res.json() as Promise<{ files?: ProducedFile[] }>) : null))
      .then((data) => {
        if (cancelled || !data?.files) return;
        setDiskFiles(data.files);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId, ended, snapshot.status, snapshotFiles.length]);
  const files = mergeProducedFiles(snapshotFiles, diskFiles);
  const showProduced = ended || files.length > 0;

  return (
    <aside className="drawer results">
      <header className="drawer-head">
        <div>
          <h2>Results</h2>
          <div className="stat-row">
            {selected ? (
              <strong>{selected.name}</strong>
            ) : (
              <span className="muted">{idle ? "Waiting for a brief" : "No agent output yet"}</span>
            )}
          </div>
        </div>
        {pinned ? (
          <button type="button" onClick={onFollowLive}>
            Follow live
          </button>
        ) : (
          <span className="muted follow-tag">Following live</span>
        )}
      </header>

      {idle ? (
        <p className="muted">Type what the swarm should do, then press Start. Output appears here.</p>
      ) : null}

      {selected ? (
        <section>
          <h2>Now</h2>
          <p className="goal">
            {selected.name} is {plainActivity(selected.activity)}
          </p>
          {selected.currentStep ? <p className="step">{selected.currentStep}</p> : null}
        </section>
      ) : null}

      {!idle ? (
        <section>
          <h2>Answer</h2>
          {answerText ? (
            <AnswerText text={answerText} />
          ) : (
            <p className="muted">
              {snapshot.status === "running" ? "Waiting for the swarm to write." : "No answer yet."}
            </p>
          )}
        </section>
      ) : null}

      {showProduced ? (
        <section>
          <h2>What we produced</h2>
          {ended ? (
            <p className={snapshot.status === "failed" ? "bad" : "goal"}>
              {snapshot.status === "failed" ? "The run failed." : "The run finished."}
            </p>
          ) : null}
          {failText ? <p className="banner bad">{failText}</p> : null}
          {files.length > 0 ? (
            <>
              {snapshot.runId ? (
                <a className="download-zip" href={`/api/runs/${snapshot.runId}/files.zip`}>
                  Download zip
                </a>
              ) : null}
              <ul className="produced-files">
                {files.map((file) => (
                  <li key={file.path}>
                    <span>{file.path}</span>
                    <span className="muted">{file.bytes} bytes</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {ended && deliverables.length === 0 && files.length === 0 ? (
            <p className="muted">Nothing readable was produced.</p>
          ) : (
            deliverables.map((item) => (
              <article key={item.title} className="deliverable">
                <h3>{item.title}</h3>
                <AnswerText text={item.body} />
              </article>
            ))
          )}
        </section>
      ) : null}

      {!idle ? (
        <section>
          <h2>Tasks</h2>
          {snapshot.tasks.length === 0 ? (
            <p className="muted">No tasks yet.</p>
          ) : (
            <ul className="log">
              {snapshot.tasks.map((task) => (
                <li key={task.id} className={task.status}>
                  {task.title}
                  <span className="muted"> · {task.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {selected ? (
        <details className="agent-details">
          <summary>Agent details</summary>
          <h2>Scratchpad</h2>
          {selected.scratchpad ? (
            <pre className="scratchpad">{selected.scratchpad}</pre>
          ) : (
            <p className="muted">Empty.</p>
          )}
          <h2>Child tree</h2>
          {children.length === 0 ? (
            <p className="muted">No live children.</p>
          ) : (
            <ul className="log">
              {children.map((child) => (
                <li key={child.id}>
                  {child.name} · {plainActivity(child.activity)}
                </li>
              ))}
            </ul>
          )}
          <h2>Votes</h2>
          {votes.length === 0 ? (
            <p className="muted">No votes tied to this agent.</p>
          ) : (
            <ul className="log">
              {votes.map((vote, index) => (
                <li key={`${vote.taskId}-${index}`} className={vote.vote === "reject" ? "bad" : ""}>
                  {vote.vote} · {vote.reason}
                </li>
              ))}
            </ul>
          )}
          <h2>Steps</h2>
          {selected.steps.length === 0 ? (
            <p className="muted">No steps yet.</p>
          ) : (
            <ol>
              {selected.steps.slice(-8).map((step, index) => (
                <li key={`${step}-${index}`}>{step}</li>
              ))}
            </ol>
          )}
          <h2>Envelope</h2>
          <p className="envelope">{selected.envelope.originalGoal}</p>
        </details>
      ) : null}
    </aside>
  );
}

function Meter({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="meter">
      <div className="stat-row">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
