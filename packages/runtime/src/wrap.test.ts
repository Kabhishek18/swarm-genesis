import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { simulatedAdapter } from "@swarm/playbooks";
import { assemblePrompt } from "./loop.js";
import { OllamaChat } from "./ollama.js";
import {
  buildInvitationHtml,
  buildSiteDesignMarkdown,
  isCompleteSiteHtml,
  isThinSiteDesign,
} from "./site-html.js";
import { childLoopAdapter, ensureWebsiteDeliverables, withSimulatedThoughts } from "./wrap.js";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "swarm-sim-"));
  temps.push(dir);
  return dir;
}

const envelope = { originalGoal: "Build a landing page", qualityBar: "ok", constraints: [] };
const weddingGoal = "Build a Website for wedding invitation";
const weddingEnvelope = { originalGoal: weddingGoal, qualityBar: "ok", constraints: [] };

function expectCompleteSiteHtml(html: string, originalGoal: string): void {
  expect(html).toMatch(/<html[\s>]/i);
  expect(html).toMatch(/<body[\s>]/i);
  expect(html).toMatch(/<style[\s>]/i);
  expect(html).toContain(originalGoal);
  expect(html.trim().startsWith("<!")).toBe(true);
  expect(html.length).toBeGreaterThan(500);
}

describe("simulated deliverable writes", () => {
  it("writes a complete invitation page from originalGoal for site-html", async () => {
    const workspaceDir = await tempDir();
    const adapter = withSimulatedThoughts(
      simulatedAdapter("site-html", 10, 0, { summary: "HTML stub" }),
      workspaceDir,
    );
    await adapter.execute({}, weddingEnvelope, new AbortController().signal, {
      agentId: "html",
      workspaceDir,
    });
    const html = await readFile(path.join(workspaceDir, "index.html"), "utf8");
    const nested = await readFile(path.join(workspaceDir, "site", "index.html"), "utf8");
    const design = await readFile(path.join(workspaceDir, "site-design.md"), "utf8");
    expectCompleteSiteHtml(html, weddingGoal);
    expectCompleteSiteHtml(nested, weddingGoal);
    expect(html).toMatch(/RSVP/i);
    expect(html).toMatch(/venue/i);
    expect(html).not.toMatch(/Site not yet created/i);
    expect(design.trim().length).toBeGreaterThan(80);
    expect(design).toContain(weddingGoal);
    expect(design).toMatch(/^#/m);
  });

  it("writes a birthday invitation page from originalGoal, not wedding-only copy", async () => {
    const workspaceDir = await tempDir();
    const birthdayGoal = "Build a Website for birthday invitation";
    const adapter = withSimulatedThoughts(
      simulatedAdapter("site-html", 10, 0, { summary: "HTML stub" }),
      workspaceDir,
    );
    await adapter.execute({}, { originalGoal: birthdayGoal, qualityBar: "ok", constraints: [] }, new AbortController().signal, {
      agentId: "html",
      workspaceDir,
    });
    const html = await readFile(path.join(workspaceDir, "index.html"), "utf8");
    const nested = await readFile(path.join(workspaceDir, "site", "index.html"), "utf8");
    expectCompleteSiteHtml(html, birthdayGoal);
    expectCompleteSiteHtml(nested, birthdayGoal);
    expect(html).toMatch(/birthday/i);
    expect(html).not.toMatch(/Wedding Invitation/i);
    expect(html).toMatch(/<h1[\s>]/i);
  });

  it("writes index.html even when the signal is already aborted", async () => {
    const workspaceDir = await tempDir();
    const adapter = withSimulatedThoughts(
      simulatedAdapter("site-html", 10, 0, { summary: "HTML stub" }),
      workspaceDir,
    );
    const ac = new AbortController();
    ac.abort();
    await expect(
      adapter.execute({}, weddingEnvelope, ac.signal, { agentId: "html", workspaceDir }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const html = await readFile(path.join(workspaceDir, "index.html"), "utf8");
    expectCompleteSiteHtml(html, weddingGoal);
    expect(html).toMatch(/RSVP/i);
  });

  it("writes a txt stub for non-website adapters when aborted", async () => {
    const workspaceDir = await tempDir();
    const adapter = withSimulatedThoughts(
      simulatedAdapter("doc-draft", 10, 0, { summary: "outline" }),
      workspaceDir,
    );
    const ac = new AbortController();
    ac.abort();
    await expect(
      adapter.execute({}, envelope, ac.signal, { agentId: "writer", workspaceDir }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const text = await readFile(path.join(workspaceDir, "doc-draft.txt"), "utf8");
    expect(text).toContain("simulated:doc-draft");
  });

  it("writes a child-loop stub before honoring abort", async () => {
    const workspaceDir = await tempDir();
    const adapter = childLoopAdapter(new OllamaChat({ host: "http://127.0.0.1:1" }), false, workspaceDir);
    const ac = new AbortController();
    ac.abort();
    await expect(
      adapter.execute(
        { taskDescription: "Draft copy", role: "writer" },
        envelope,
        ac.signal,
        { agentId: "child", workspaceDir },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    const text = await readFile(path.join(workspaceDir, "__child_loop__.txt"), "utf8");
    expect(text).toContain("simulated writer completed");
  });

  it("still writes the invitation page when a copy child loop is aborted on TTL", async () => {
    const workspaceDir = await tempDir();
    const birthdayGoal = "Build a Website for birthday invitation";
    const adapter = childLoopAdapter(new OllamaChat({ host: "http://127.0.0.1:1" }), false, workspaceDir);
    const ac = new AbortController();
    ac.abort();
    await expect(
      adapter.execute(
        { taskDescription: "Copy pass", role: "copy" },
        { originalGoal: birthdayGoal, qualityBar: "ok", constraints: [] },
        ac.signal,
        { agentId: "copy-child", workspaceDir },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    const html = await readFile(path.join(workspaceDir, "index.html"), "utf8");
    const design = await readFile(path.join(workspaceDir, "site-design.md"), "utf8");
    expectCompleteSiteHtml(html, birthdayGoal);
    expect(design.trim().length).toBeGreaterThan(80);
    expect(design).toContain(birthdayGoal);
  });
});

describe("ensureWebsiteDeliverables", () => {
  it("replaces tiny index.html and a 4-byte null design outline", async () => {
    const workspaceDir = await tempDir();
    const birthdayGoal = "Build a Website for birthday invitation";
    await mkdir(path.join(workspaceDir, "site"), { recursive: true });
    await writeFile(
      path.join(workspaceDir, "site", "index.html"),
      "<!DOCTYPE html><html><head><title> Birthday Invitation</title></head><body></body></html>",
      "utf8",
    );
    await writeFile(path.join(workspaceDir, "site-design.md"), "null", "utf8");
    await ensureWebsiteDeliverables(
      { agentId: "copy", workspaceDir },
      birthdayGoal,
      "site-copy",
    );
    const html = await readFile(path.join(workspaceDir, "index.html"), "utf8");
    const nested = await readFile(path.join(workspaceDir, "site", "index.html"), "utf8");
    const design = await readFile(path.join(workspaceDir, "site-design.md"), "utf8");
    expectCompleteSiteHtml(html, birthdayGoal);
    expectCompleteSiteHtml(nested, birthdayGoal);
    expect(nested).not.toMatch(/<body><\/body>/);
    expect(design.trim()).not.toBe("null");
    expect(design).toMatch(/^#/m);
    expect(design).toContain(birthdayGoal);
    expect(Buffer.byteLength(design, "utf8")).toBeGreaterThan(80);
  });
});

describe("buildInvitationHtml", () => {
  it("interpolates the brief and structural tags", () => {
    const html = buildInvitationHtml(weddingGoal);
    expectCompleteSiteHtml(html, weddingGoal);
    expect(html).toMatch(/<h1[\s>]/i);
    expect(html).toMatch(/RSVP/i);
    expect(html).toContain("&amp;");
  });

  it("builds a birthday page from the brief without wedding-only wording", () => {
    const goal = "Build a Website for birthday invitation";
    const html = buildInvitationHtml(goal);
    expectCompleteSiteHtml(html, goal);
    expect(isCompleteSiteHtml(html)).toBe(true);
    expect(html).toMatch(/birthday/i);
    expect(html).not.toMatch(/Wedding Invitation/i);
    expect(Buffer.byteLength(html, "utf8")).toBeGreaterThan(500);
  });

  it("escapes HTML in the original goal", () => {
    const html = buildInvitationHtml('Build a Website for wedding invitation <script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("builds a non-empty markdown outline from the brief", () => {
    const goal = "Build a Website for birthday invitation";
    const md = buildSiteDesignMarkdown(goal);
    expect(isThinSiteDesign(md)).toBe(false);
    expect(isThinSiteDesign("null")).toBe(true);
    expect(isThinSiteDesign("")).toBe(true);
    expect(md).toContain(goal);
    expect(md.trim().length).toBeGreaterThan(80);
  });
});

describe("assemblePrompt website tasks", () => {
  it("tells HTML tasks to write_file full HTML instead of JSON-only", () => {
    const { system } = assemblePrompt({
      role: "Markup the page",
      task: "site-html",
      input: {},
      envelope: weddingEnvelope,
    });
    expect(system).toMatch(/write_file/);
    expect(system).toMatch(/COMPLETE valid HTML/i);
    expect(system).not.toMatch(/compact JSON artifact and no further tool calls/);
  });

  it("keeps compact JSON instructions for non-website tasks", () => {
    const { system } = assemblePrompt({
      role: "researcher",
      task: "aggregate",
      input: {},
      envelope: { originalGoal: "Price the five competitors", qualityBar: "ok", constraints: [] },
    });
    expect(system).toMatch(/compact JSON artifact/);
    expect(system).not.toMatch(/COMPLETE valid HTML/);
  });
});
