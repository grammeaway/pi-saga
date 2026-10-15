import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decide, lastMarker, latestPromptFor, MARKER, parseArgs, passPrompt, readPass, sagaDirs, TOOL, type Loop,
} from "../logic.ts";

const loop = (over: Partial<Loop> = {}): Loop => ({ pass: 1, max: 20, noops: 0, stop: false, ...over });
const assistant = (stopReason: string) => ({ type: "message", message: { role: "assistant", stopReason } });
const report = (details: unknown, isError = false) => ({ type: "message", message: { role: "toolResult", toolName: TOOL, isError, details } });

test("parseArgs", () => {
  assert.deepEqual(parseArgs(""), { stop: false, dir: undefined, max: 20 });
  assert.deepEqual(parseArgs("stop"), { stop: true });
  assert.deepEqual(parseArgs(" ./plans/ "), { stop: false, dir: "plans", max: 20 });
  assert.deepEqual(parseArgs("plans 5"), { stop: false, dir: "plans", max: 5 });
  assert.deepEqual(parseArgs("3"), { stop: false, dir: undefined, max: 3 });
  assert.equal(parseArgs("plans 0"), undefined);
  assert.equal(parseArgs("a b"), undefined);
});

test("readPass takes the latest valid report and how the last response ended", () => {
  assert.deepEqual(readPass([]), { report: undefined, ended: "ok" });
  const first = { status: "next", commit_message: "a" };
  const second = { status: "complete", commit_message: "b" };
  const p = readPass([report(first), assistant("toolUse"), report(second), report({ status: "bogus" }), report(first, true), assistant("stop")]);
  assert.deepEqual(p, { report: second, ended: "ok" });
  assert.equal(readPass([assistant("error"), assistant("stop")]).ended, "ok", "a retry that succeeded counts");
  assert.equal(readPass([assistant("stop"), assistant("aborted")]).ended, "aborted");
  assert.equal(readPass([assistant("error")]).ended, "error");
});

test("lastMarker", () => {
  const m = (data: unknown) => ({ type: "custom", customType: MARKER, data });
  assert.equal(lastMarker([]), undefined);
  assert.deepEqual(lastMarker([m({ dir: "a", pass: 1 }), m({ dir: "b", pass: 2 }), m(null)]), { dir: "b", pass: 2 });
});

test("decide: the pass outcomes", () => {
  const next = { status: "next" as const, commit_message: "m" };
  assert.deepEqual(decide({ ended: "ok" }, false, loop()), { kind: "wait" });
  assert.equal(decide({ ended: "ok" }, false, loop({ stop: true })).kind, "stop");
  assert.deepEqual(decide({ report: next, ended: "ok" }, true, loop()), { kind: "next", commit: true, noops: 0 });
  assert.deepEqual(decide({ report: next, ended: "ok" }, false, loop()), { kind: "next", commit: false, noops: 1 });
  assert.equal(decide({ report: next, ended: "ok" }, false, loop({ noops: 1 })).kind, "stop");
  assert.deepEqual(decide({ report: next, ended: "aborted" }, true, loop()).kind, "stop");
  assert.deepEqual(decide({ report: { status: "complete", commit_message: "m" }, ended: "ok" }, true, loop()), { kind: "stop", commit: true, why: "complete", done: true });
  const blocked = decide({ report: { status: "blocked", commit_message: "m", reason: "needs a soak" }, ended: "ok" }, false, loop());
  assert.deepEqual(blocked, { kind: "stop", commit: false, why: "blocked: needs a soak" });
  assert.deepEqual(decide({ report: next, ended: "ok" }, true, loop({ pass: 3, max: 3 })), { kind: "stop", commit: true, why: "reached the limit of 3 passes" });
  assert.deepEqual(decide({ report: next, ended: "ok" }, true, loop({ stop: true })), { kind: "stop", commit: true, why: "stopped by /saga stop" });
});

test("passPrompt keeps the prompt and appends the contract", () => {
  const p = passPrompt("Do the next plan.\n\n", "plans");
  assert.ok(p.startsWith("Do the next plan.\n\n---\n"));
  assert.ok(p.includes("`plans/`") && p.includes(TOOL));
});

test("latestPromptFor picks the newest session mentioning the folder", () => {
  const s = (firstMessage: string, t: number) => ({ firstMessage, modified: new Date(t) });
  const sessions = [s("work on ./plans/", 1), s("unrelated", 5), s("next item in ./plans/ please", 3)];
  assert.equal(latestPromptFor("plans", sessions), "next item in ./plans/ please");
  assert.equal(latestPromptFor("other", sessions), undefined);
  const pass = s(passPrompt("Do ./plans/ next.", "plans"), 9);
  assert.equal(latestPromptFor("plans", [...sessions, pass]), "Do ./plans/ next.", "a pass prompt comes back without the contract");
});

test("sagaDirs lists folders with a progress.md, those with a prompt.md first", () => {
  const root = mkdtempSync(join(tmpdir(), "saga-"));
  for (const [d, files] of [["b", ["progress.md"]], ["c", ["progress.md", "prompt.md"]], ["a", ["progress.md"]], ["x", ["README.md"]]] as const) {
    mkdirSync(join(root, d));
    for (const f of files) writeFileSync(join(root, d, f), "");
  }
  writeFileSync(join(root, "progress.md"), "");
  assert.deepEqual(sagaDirs(root), ["c", "a", "b"]);
});
