import type { AgentSnapshot, RunSnapshot } from "@swarm/schema";

interface Props {
  snapshot: RunSnapshot;
}

export function Hud({ snapshot }: Props) {
  const tokenPct = snapshot.budget.tokensLimit
    ? Math.min(100, (snapshot.budget.tokensUsed / snapshot.budget.tokensLimit) * 100)
    : 0;
  const timePct = snapshot.budget.wallClockLimitMs
    ? Math.min(100, (snapshot.budget.wallClockMs / snapshot.budget.wallClockLimitMs) * 100)
    : 0;

  return (
    <aside className="hud">
        <section>
          <h2>Meta</h2>
          <p className="goal">{snapshot.goal || "Choose a playbook and start a run."}</p>
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
                {snapshot.budget.liveSubagents} visible cap {snapshot.budget.maxVisibleSubagents || 0}
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
                  queue {domain.queued} · locked {domain.locked} · running {domain.running} · done{" "}
                  {domain.completed}
                </p>
              </article>
            ))}
          </div>
        </section>
        <section>
          <h2>Handoffs</h2>
          {snapshot.handoffs.length === 0 ? (
            <p className="muted">No domain hand-offs yet.</p>
          ) : (
            <ul className="log">
              {snapshot.handoffs.slice(-6).map((handoff) => (
                <li key={handoff.id} className={handoff.rejected ? "bad" : ""}>
                  {handoff.from} → {handoff.to} hop {handoff.hop}
                  {handoff.rejected ? " rejected" : ""} · {handoff.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>Votes</h2>
          {(snapshot.votes ?? []).length === 0 ? (
            <p className="muted">No review votes yet.</p>
          ) : (
            <ul className="log">
              {(snapshot.votes ?? []).slice(-6).map((vote, index) => (
                <li key={`${vote.taskId}-${index}`} className={vote.vote === "reject" ? "bad" : ""}>
                  {vote.voterId} {vote.vote} {vote.taskId} · {vote.reason}
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
          <h2>Tasks</h2>
          <ul className="log tasks">
            {snapshot.tasks.map((task) => (
              <li key={task.id} className={task.status}>
                <span className="tag">{task.status}</span> {task.title}
                {task.lastVote ? ` · ${task.lastVote.vote}` : ""}
              </li>
            ))}
          </ul>
        </section>
      </aside>
  );
}

export function InspectionDrawer({
  snapshot,
  selected,
  onClose,
}: {
  snapshot: RunSnapshot;
  selected: AgentSnapshot;
  onClose?: () => void;
}) {
  const children = (selected.children ?? [])
    .map((id) => snapshot.agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentSnapshot => Boolean(agent));
  const votes = (snapshot.votes ?? []).filter(
    (vote) =>
      vote.voterId === selected.id ||
      snapshot.tasks.some((task) => task.id === vote.taskId && task.assignee === selected.id),
  );

  return (
    <aside className="drawer">
      <header className="drawer-head">
        <div>
          <h2>Thought stream</h2>
          <div className="stat-row">
            <strong>{selected.name}</strong>
            <span>{selected.kind}</span>
          </div>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="muted">{selected.role}</p>
      <p>
        {selected.activity} · {selected.currentTool || "no tool"}
      </p>
      <p className="step">{selected.currentStep}</p>
      <p className="envelope">Envelope: {selected.envelope.originalGoal}</p>
      <p className="muted">Quality bar: {selected.envelope.qualityBar}</p>
      <ul className="constraints">
        {selected.envelope.constraints.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2>Scratchpad</h2>
      {selected.scratchpad ? (
        <pre className="scratchpad">{selected.scratchpad}</pre>
      ) : (
        <p className="muted">No prompt assembled yet.</p>
      )}

      <h2>Thoughts</h2>
      {selected.thoughts?.length ? (
        <ol className="thoughts">
          {selected.thoughts.slice(-24).map((thought, index) => (
            <li key={`${thought.at}-${index}`}>{thought.delta}</li>
          ))}
        </ol>
      ) : (
        <p className="muted">Waiting for tokens.</p>
      )}

      <h2>Child tree</h2>
      {children.length === 0 ? (
        <p className="muted">No live children. parentId={selected.parentId ?? "root"}</p>
      ) : (
        <ul className="log">
          {children.map((child) => (
            <li key={child.id}>
              {child.name} · {child.activity} · {child.currentTool || "idle"}
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
      <ol>
        {selected.steps.slice(-8).map((step, index) => (
          <li key={`${step}-${index}`}>{step}</li>
        ))}
      </ol>
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
