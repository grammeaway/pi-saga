// Pure parts of pi-saga: no Pi imports, so the tests run in plain Node.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const TOOL = "saga_pass";
export const MARKER = "saga";
export const DEFAULT_MAX = 20;
export const NOOP_LIMIT = 2;
export const STATUSES = ["next", "complete", "blocked"] as const;

export type Status = (typeof STATUSES)[number];
export type Report = { status: Status; commit_message: string; reason?: string };
export type Ended = "ok" | "aborted" | "error";
export type Pass = { report?: Report; ended: Ended };
export type Loop = { pass: number; max: number; noops: number; stop: boolean };
export type Step =
  | { kind: "wait" }
  | { kind: "next"; commit: boolean; noops: number }
  | { kind: "stop"; commit: boolean; why: string; done?: boolean };

export type Args = { stop: true } | { stop: false; dir?: string; max: number };

export function parseArgs(raw: string): Args | undefined {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0] === "stop") return { stop: true };
  let max = DEFAULT_MAX;
  if (words.length > 0 && /^\d+$/.test(words[words.length - 1])) {
    max = Number(words.pop());
    if (max < 1) return undefined;
  }
  if (words.length > 1) return undefined;
  return { stop: false, dir: words[0] && normalizeDir(words[0]), max };
}

export const normalizeDir = (dir: string) => dir.replace(/^\.\//, "").replace(/\/+$/, "") || ".";

// The latest saga_pass report in this session, and how its last model response ended.
export function readPass(branch: readonly any[]): Pass {
  let report: Report | undefined;
  let ended: Ended = "ok";
  for (const e of branch) {
    if (e?.type !== "message") continue;
    const m = e.message;
    if (m?.role === "toolResult" && m.toolName === TOOL && !m.isError && STATUSES.includes(m.details?.status)) report = m.details;
    if (m?.role === "assistant") ended = m.stopReason === "aborted" ? "aborted" : m.stopReason === "error" ? "error" : "ok";
  }
  return { report, ended };
}

export function lastMarker(branch: readonly any[]): { dir: string; pass: number } | undefined {
  let marker;
  for (const e of branch)
    if (e?.type === "custom" && e.customType === MARKER && typeof e.data?.dir === "string") marker = e.data;
  return marker;
}

// What the loop does once the pass session is idle. `staged`: the index holds changes.
export function decide(p: Pass, staged: boolean, loop: Loop): Step {
  if (p.ended === "aborted") return { kind: "stop", commit: false, why: "the pass was interrupted" };
  if (p.ended === "error") return { kind: "stop", commit: false, why: "the pass ended in an error" };
  if (!p.report) return loop.stop ? { kind: "stop", commit: false, why: "stopped by /saga stop" } : { kind: "wait" };

  const commit = staged;
  if (p.report.status === "complete") return { kind: "stop", commit, why: "complete", done: true };
  if (p.report.status === "blocked") return { kind: "stop", commit, why: `blocked: ${p.report.reason ?? "no reason given"}` };
  const noops = staged ? 0 : loop.noops + 1;
  if (noops >= NOOP_LIMIT) return { kind: "stop", commit, why: `${noops} passes in a row staged nothing` };
  if (loop.stop) return { kind: "stop", commit, why: "stopped by /saga stop" };
  if (loop.pass >= loop.max) return { kind: "stop", commit, why: `reached the limit of ${loop.max} passes` };
  return { kind: "next", commit, noops };
}

const CONTRACT = "\n\n---\nThis is one pass of a saga over";

export function passPrompt(prompt: string, dir: string): string {
  return `${prompt.trimEnd()}${CONTRACT} \`${dir}/\`. Each pass runs in a fresh session; the next starts after you report. When this pass's work is done:
1. Stage exactly the changes that belong in this pass's commit (\`git add <paths>\`), and leave unrelated files unstaged. Don't commit: the loop commits what is staged.
2. Call \`${TOOL}\` with a commit message in this repository's style (see \`git log\`).
To ask the user something, ask and end your turn without calling \`${TOOL}\`. The loop waits for the answer.`;
}

export const templatePrompt = (dir: string) => `Your task is to implement the next plan in ./${dir}/. Its README.md lists the plans, their order and the shared rules; progress.md says what is done. Keep progress.md up to date, including any deviations from the plan.

Ask when in doubt.
`;

// First prompt of the most recent session that mentions the directory, to seed prompt.md.
// A saga pass's first prompt is prompt.md plus the contract, so the contract is cut off.
export function latestPromptFor(dir: string, sessions: readonly { firstMessage: string; modified: Date }[]): string | undefined {
  const name = dir.split("/").pop()!;
  return [...sessions]
    .filter((s) => s.firstMessage.includes(name))
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())[0]
    ?.firstMessage.split(CONTRACT)[0];
}

// shortcut: only looks one level down from cwd; recurse if sagas ever live deeper.
export function sagaDirs(cwd: string): string[] {
  const has = (d: string, f: string) => existsSync(join(cwd, d, f));
  return readdirSync(cwd, { withFileTypes: true })
    .filter((d) => d.isDirectory() && has(d.name, "progress.md"))
    .map((d) => d.name)
    .sort((a, b) => Number(has(b, "prompt.md")) - Number(has(a, "prompt.md")) || a.localeCompare(b));
}
