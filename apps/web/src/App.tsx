import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { playbooks } from "@swarm/playbooks";
import type { RunSnapshot } from "@swarm/schema";
import { OfficeCanvas } from "./OfficeCanvas";
import { Hud, ResultsPanel, pickLiveAgent } from "./Hud";
import { useSwarmSocket } from "./useSwarmSocket";

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TEXT_LIMIT = 8_000;
const ACCEPT_FILES = ".pdf,.txt,.md,.png,.jpg,.jpeg,.webp";
const DEFAULT_PLAYBOOK_ID = playbooks[0]?.id ?? "feature-dev";
const WEBSITE_BRIEF_RE = /website|html|landing|invitation/i;

type UploadKind = "pdf" | "text" | "image";

interface Attachment {
  id: string;
  name: string;
  kind: UploadKind;
  text: string;
}

export function App() {
  const { snapshot, connected, liveModel, error, start, stop } = useSwarmSocket();
  const [playbookId, setPlaybookId] = useState(playbooks[0].id);
  const [goal, setGoal] = useState("");
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const running = snapshot.status === "running";
  const playbook = playbooks.find((item) => item.id === playbookId) ?? playbooks[0];
  const canStart = connected && !running && Boolean(goal.trim()) && !uploading;
  const banner = error || uploadError;

  const liveAgent = useMemo(() => pickLiveAgent(snapshot), [snapshot]);
  const selected = useMemo(() => {
    if (pinnedId) {
      return snapshot.agents.find((agent) => agent.id === pinnedId) ?? liveAgent;
    }
    return liveAgent;
  }, [snapshot.agents, pinnedId, liveAgent]);

  async function onStart() {
    const brief = goal.trim();
    if (running || !brief || uploading) return;
    setPinnedId(null);
    setUploadError(null);
    const routedId = routePlaybookId(playbookId, brief);
    if (routedId !== playbookId) setPlaybookId(routedId);
    try {
      await start(routedId, appendAttachments(brief, attachments));
    } catch (err) {
      console.error(err);
    }
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void onStart();
    }
  }

  async function onPickFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || running) return;

    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setUploadError("You can attach up to 5 files.");
      return;
    }

    const oversized = files.filter((file) => file.size > MAX_FILE_BYTES);
    const sizedOk = files.filter((file) => file.size <= MAX_FILE_BYTES);
    const accepted = sizedOk.slice(0, room);
    const messages: string[] = [];
    if (oversized.length) {
      messages.push(`${oversized.map((file) => file.name).join(", ")} exceeded 10MB.`);
    }
    if (sizedOk.length > room) {
      messages.push("You can attach up to 5 files.");
    }
    if (!accepted.length) {
      setUploadError(messages.join(" "));
      return;
    }

    setUploading(true);
    const uploaded: Attachment[] = [];
    for (const file of accepted) {
      try {
        uploaded.push(await postUpload(file));
      } catch (err) {
        const detail = err instanceof Error ? err.message : `Failed to upload ${file.name}`;
        messages.push(detail);
      }
    }
    if (uploaded.length) setAttachments((prev) => [...prev, ...uploaded]);
    setUploadError(messages.length ? messages.join(" ") : null);
    setUploading(false);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">SWARM GENESIS</div>
          <div className="sub">Multi-orchestrator OS · pixel office</div>
        </div>
        <label className="picker">
          Playbook
          <select
            value={playbookId}
            disabled={running}
            onChange={(event) => {
              const nextId = event.target.value;
              const prev = playbooks.find((item) => item.id === playbookId);
              const next = playbooks.find((item) => item.id === nextId);
              setPlaybookId(nextId);
              if (next && goal === prev?.trigger) setGoal(next.trigger);
            }}
          >
            {playbooks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="chips">
          <div className={`chip ${connected ? "ok" : "failed"}`}>{connected ? "gateway" : "offline"}</div>
          <div className={`chip ${liveModel ? "running" : ""}`}>
            {liveModel ? "ollama" : liveModel === false ? "simulated" : "runtime"}
          </div>
          <StatusChip snapshot={snapshot} />
        </div>
        {banner ? <div className="banner bad">{banner}</div> : null}
      </header>
      <section className="composer">
        <div className="composer-main">
          <label className="composer-field">
            What should the swarm do?
            <textarea
              value={goal}
              disabled={running}
              placeholder={playbook.trigger}
              onChange={(event) => setGoal(event.target.value)}
              onKeyDown={onComposerKey}
              aria-label="Run brief"
              rows={3}
            />
          </label>
          {attachments.length ? (
            <ul className="file-chips">
              {attachments.map((file) => (
                <li key={file.id} className="file-chip">
                  <span>{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(file.id)}
                    disabled={running}
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="composer-side">
          <div className="actions">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_FILES}
              hidden
              disabled={running || uploading}
              onChange={(event) => void onPickFiles(event)}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="Attach files"
              disabled={running || uploading || attachments.length >= MAX_ATTACHMENTS}
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon />
            </button>
            <button
              type="button"
              className="primary icon-btn"
              onClick={() => void onStart()}
              disabled={!canStart}
              aria-label="Start run"
            >
              <PlayIcon />
            </button>
            <button type="button" className="icon-btn" onClick={() => void stop()} disabled={!running} aria-label="Stop">
              <StopIcon />
            </button>
          </div>
          {!connected ? <p className="hint">Gateway offline — reconnect before starting.</p> : null}
          {connected && uploadError ? <p className="hint bad">{uploadError}</p> : null}
          {connected && uploading ? <p className="hint">Uploading…</p> : null}
          {connected && !running && !uploading && !uploadError ? (
            <p className="hint">Ctrl/Cmd + Enter to start</p>
          ) : null}
        </div>
      </section>
      <div className="stage">
        <OfficeCanvas
          snapshot={snapshot}
          layoutId={snapshot.layoutId || playbook.layoutId}
          selectedId={pinnedId ?? selected?.id ?? null}
          pinned={Boolean(pinnedId)}
          onSelect={setPinnedId}
        />
        <Hud snapshot={snapshot} />
      </div>
      <ResultsPanel
        snapshot={snapshot}
        selected={selected}
        pinned={Boolean(pinnedId)}
        onFollowLive={() => setPinnedId(null)}
      />
    </div>
  );
}

function StatusChip({ snapshot }: { snapshot: RunSnapshot }) {
  return <div className={`chip ${snapshot.status}`}>{snapshot.status || "idle"}</div>;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M21.44 11.05l-8.49 8.49a5.25 5.25 0 01-7.43-7.43l8.49-8.49a3.5 3.5 0 014.95 4.95l-8.49 8.49a1.75 1.75 0 01-2.47-2.47l7.78-7.78"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function routePlaybookId(currentId: string, brief: string): string {
  if (currentId === DEFAULT_PLAYBOOK_ID && WEBSITE_BRIEF_RE.test(brief)) {
    return "build-website";
  }
  return currentId;
}

function appendAttachments(brief: string, files: Attachment[]): string {
  if (!files.length) return brief;
  const parts = [brief];
  for (const file of files) {
    const clipped =
      file.text.length > ATTACHMENT_TEXT_LIMIT ? `${file.text.slice(0, ATTACHMENT_TEXT_LIMIT)}\n…` : file.text;
    parts.push(`\n\nAttached file: ${file.name}\n${clipped}`);
  }
  return parts.join("");
}

async function postUpload(file: File): Promise<Attachment> {
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch("/api/uploads", { method: "POST", body });
  } catch {
    throw new Error(`Could not upload ${file.name}`);
  }
  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    kind?: string;
    text?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? `Failed to upload ${file.name}`);
  }
  const kind: UploadKind = data.kind === "pdf" || data.kind === "image" || data.kind === "text" ? data.kind : "text";
  return {
    id: data.id ?? `${file.name}-${file.size}-${file.lastModified}`,
    name: data.name ?? file.name,
    kind,
    text: typeof data.text === "string" ? data.text : "",
  };
}
