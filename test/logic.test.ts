import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decide, lastMarker, latestPromptFor, MARKER, nextPass, parseArgs, passPrompt, planList, readPass, resumeCommand, sagaDirs, TOOL, type Loop,
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
  assert.deepEqual(parseArgs("ls"), { stop: false, ls: true, dir: undefined });
  assert.deepEqual(parseArgs("ls ./plans/"), { stop: false, ls: true, dir: "plans" });
  assert.equal(parseArgs("ls a b"), undefined);
});

test("readPass takes the latest valid report and how the last response ended", () => {
  assert.deepEqual(readPass([]), { report: undefined, ended: "ok" });
  const first = { status: "next" };
  const second = { status: "complete" };
  const p = readPass([report(first), assistant("toolUse"), report(second), report({ status: "bogus" }), report(first, true), assistant("stop")]);
  assert.deepEqual(p, { report: second, ended: "ok" });
  assert.equal(readPass([assistant("error"), assistant("stop")]).ended, "ok", "a retry that succeeded counts");
  assert.equal(readPass([assistant("stop"), assistant("aborted")]).ended, "aborted");
  assert.equal(readPass([assistant("error")]).ended, "error");
});

test("lastMarker", () => {
  const m = (data: unknown) => ({ type: "custom", customType: MARKER, data });
  assert.equal(lastMarker([]), undefined);
  assert.deepEqual(lastMarker([m({ dir: "a", pass: 1 }), m({ dir: "b", pass: 2, head: "abc" }), m(null)]), { dir: "b", pass: 2, head: "abc" });
});

test("resumeCommand: only an unfinished latest pass picks the loop back up", () => {
  const m = (data: unknown) => ({ type: "custom", customType: MARKER, data });
  const sessions = [{ name: "saga: plans #1" }, { name: "saga: plans #2" }];
  const pass2 = m({ dir: "plans", pass: 2, head: "abc", max: 5 });
  assert.equal(resumeCommand([pass2, assistant("toolUse")], sessions), "/saga 4");
  assert.equal(resumeCommand([m({ dir: "plans", pass: 2 })], sessions), "/saga", "markers from before max was stored");
  assert.equal(resumeCommand([], sessions), undefined);
  assert.equal(resumeCommand([m({ dir: "plans", pass: 1, max: 5 })], sessions), undefined, "an older pass");
  assert.equal(resumeCommand([pass2, report({ status: "next" })], sessions), undefined, "already reported");
  assert.equal(resumeCommand([pass2, assistant("aborted")], sessions), undefined, "stopped with Escape");
  assert.equal(resumeCommand([pass2, assistant("error")], sessions), undefined);
});

test("decide: the pass outcomes", () => {
  const next = { status: "next" as const };
  assert.deepEqual(decide({ ended: "ok" }, false, loop()), { kind: "wait" });
  assert.equal(decide({ ended: "ok" }, false, loop({ stop: true })).kind, "stop");
  assert.deepEqual(decide({ report: next, ended: "ok" }, true, loop()), { kind: "next", noops: 0 });
  assert.deepEqual(decide({ report: next, ended: "ok" }, false, loop()), { kind: "next", noops: 1 });
  assert.equal(decide({ report: next, ended: "ok" }, false, loop({ noops: 1 })).kind, "stop");
  assert.deepEqual(decide({ report: next, ended: "aborted" }, true, loop()).kind, "stop");
  assert.deepEqual(decide({ report: { status: "complete" }, ended: "ok" }, true, loop()), { kind: "stop", why: "complete", done: true });
  const blocked = decide({ report: { status: "blocked", reason: "needs a soak" }, ended: "ok" }, false, loop());
  assert.deepEqual(blocked, { kind: "stop", why: "blocked: needs a soak" });
  assert.deepEqual(decide({ report: next, ended: "ok" }, true, loop({ pass: 3, max: 3 })), { kind: "stop", why: "reached the pass limit (#3)" });
  assert.deepEqual(decide({ report: next, ended: "ok" }, true, loop({ stop: true })), { kind: "stop", why: "stopped by /saga stop" });
});

test("nextPass carries on from the highest pass of the same saga", () => {
  const s = (name?: string) => ({ name });
  assert.equal(nextPass("plans", []), 1);
  assert.equal(nextPass("plans", [s("saga: plans #3"), s("saga: plans #12"), s("saga: plans #1"), s(), s("other")]), 13);
  assert.equal(nextPass("plans", [s("saga: plans/sub #9"), s("saga: other #4"), s("saga: plans #x")]), 1);
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

test("planList orders plans by number and takes each status from progress.md", () => {
  const files = ["p10_ci.md", "README.md", "p2_egress.md", "progress.md", "p01_design.md", "resources.md", "prompt.md", "p3_box.md"];
  const progress = [
    "## Status", "", "| Plan | Status | Base | Notes |", "|---|---|---|---|",
    "| p1 design | done | abc | |", "| [p2](p2_egress.md) egress | in progress | | |", "| P10 ci | planned | | |",
    "", "## Decisions", "", "| # | Decision |", "|---|---|", "| D3 | p3 is gated on DNS |",
  ].join("\n");
  assert.deepEqual(planList(files, progress), [
    "p01_design.md  done",
    "p2_egress.md   in progress",
    "p3_box.md      ?",
    "p10_ci.md      planned",
  ]);
  assert.deepEqual(planList(["README.md"], ""), []);
});
