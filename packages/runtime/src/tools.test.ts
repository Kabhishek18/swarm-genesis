import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeCappedTool, resolveWorkspaceFile } from "./tools.js";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "swarm-write-"));
  temps.push(dir);
  return dir;
}

describe("write_file capped tool", () => {
  it("rejects path traversal, absolute paths, and an empty workspace", async () => {
    const workspaceDir = await tempDir();
    const signal = new AbortController().signal;
    const ctx = { agentId: "writer", workspaceDir };

    await expect(
      executeCappedTool("write_file", { path: "../secret.txt", content: "nope" }, ctx, signal),
    ).rejects.toThrow(/traversal|absolute/i);
    await expect(
      executeCappedTool("write_file", { path: "..\\secret.txt", content: "nope" }, ctx, signal),
    ).rejects.toThrow(/traversal|absolute/i);
    await expect(
      executeCappedTool("write_file", { path: "/etc/passwd.txt", content: "nope" }, ctx, signal),
    ).rejects.toThrow(/absolute|traversal/i);
    await expect(
      executeCappedTool(
        "write_file",
        { path: path.join(workspaceDir, "out.txt"), content: "nope" },
        ctx,
        signal,
      ),
    ).rejects.toThrow(/absolute|traversal/i);
    await expect(
      executeCappedTool(
        "write_file",
        { path: "ok.txt", content: "x" },
        { agentId: "writer", workspaceDir: "" },
        signal,
      ),
    ).rejects.toThrow(/workspace directory/i);
    await expect(
      executeCappedTool("write_file", { path: "ok.exe", content: "x" }, ctx, signal),
    ).rejects.toThrow(/allows only/i);

    expect(() => resolveWorkspaceFile(workspaceDir, "../../outside.txt")).toThrow(/traversal/i);
  });

  it("writes utf-8 txt under the workspace and reports bytes", async () => {
    const workspaceDir = await tempDir();
    const written: { path: string; bytes: number }[] = [];
    const result = await executeCappedTool(
      "write_file",
      { path: "notes.txt", content: "hello workspace" },
      {
        agentId: "writer",
        workspaceDir,
        onFileWritten: (filePath, bytes) => written.push({ path: filePath, bytes }),
      },
      new AbortController().signal,
    );
    expect(result).toEqual({
      written: true,
      path: "notes.txt",
      bytes: Buffer.byteLength("hello workspace", "utf8"),
    });
    expect(written).toEqual([{ path: "notes.txt", bytes: Buffer.byteLength("hello workspace", "utf8") }]);
    expect(await readFile(path.join(workspaceDir, "notes.txt"), "utf8")).toBe("hello workspace");
  });

  it("creates nested dirs for allowed relative paths", async () => {
    const workspaceDir = await tempDir();
    await executeCappedTool(
      "write_file",
      { path: "css/style.css", content: "body{}" },
      { agentId: "writer", workspaceDir },
      new AbortController().signal,
    );
    expect(await readFile(path.join(workspaceDir, "css", "style.css"), "utf8")).toBe("body{}");
  });

  it("rejects empty or whitespace-only content so a fallback can fill", async () => {
    const workspaceDir = await tempDir();
    const ctx = { agentId: "writer", workspaceDir };
    const signal = new AbortController().signal;
    await expect(
      executeCappedTool("write_file", { path: "site-design.md", content: "" }, ctx, signal),
    ).rejects.toThrow(/empty content/i);
    await expect(
      executeCappedTool("write_file", { path: "index.html", content: "   \n\t" }, ctx, signal),
    ).rejects.toThrow(/empty content/i);
    await expect(
      executeCappedTool("write_file", { path: "index.html", content: null }, ctx, signal),
    ).rejects.toThrow(/empty content/i);
  });
});
