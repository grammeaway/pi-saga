/**
 * pi-saga: /saga works through a plan directory, one fresh session per pass.
 *
 *   /saga [dir] [max]   start, or resume; without a dir, pick a folder that has a progress.md
 *   /saga stop          let the current pass finish, then stop
 *
 * The directory is the saga: README.md (the plans, in order), progress.md (what is
 * done) and prompt.md (the pass prompt, re-read every pass). A pass ends with the
 * agent committing its work and calling saga_pass.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decide, lastMarker, latestPromptFor, MARKER, nextPass, parseArgs, passPrompt, readPass, sagaDirs,
  sessionName, STATUSES, templatePrompt, TOOL, type Loop, type Marker, type Report,
} from "./logic.ts";

// head: HEAD when the pass started, to tell whether the pass committed.
type Run = Loop & { dir: string; cwd: string; ctx: any; head: string };

// Each session loads its own copy of this extension, so the running loop lives on globalThis.
const shared = (): { run?: Run } => ((globalThis as any).__piSaga ??= {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function git(cwd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = execFile("git", args, { cwd }, (err: any, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, out: `${stdout}${stderr}`.trim() }),
    );
    child.stdin?.end();
  });
}

const head = async (cwd: string) => {
  const res = await git(cwd, ["rev-parse", "HEAD"]);
  return res.code === 0 ? res.out : ""; // no commits yet
};

const STATUS_KEY = "saga";

export default function saga(pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL,
    label: "Saga pass",
    description:
      "End this saga pass. Commit the pass's changes first; the loop then starts the next pass in a fresh session. status: next = plans remain; complete = every plan is done; blocked = the next plan can't go ahead without the user or an outside event (say why in reason).",
    parameters: Type.Object({
      status: StringEnum(STATUSES),
      reason: Type.Optional(Type.String({ description: "Why the saga is blocked" })),
    }),
    defaultActive: false,
    async execute(_id, params) {
      if (params.status === "blocked" && !params.reason?.trim()) throw new Error("blocked needs a reason");
      const details: Report = params;
      return { content: [{ type: "text", text: "Reported. End your turn; the loop takes it from here." }], details };
    },
  });

  const activateTool = () => pi.setActiveTools([...new Set([...pi.getActiveTools(), TOOL])]);

  pi.on("session_start", () => {
    if (shared().run) activateTool();
  });

  const finish = (run: Run, why: string, level: "info" | "warning" | "error") => {
    if (shared().run === run) shared().run = undefined;
    try {
      run.ctx.ui.setStatus(STATUS_KEY, undefined);
      run.ctx.ui.notify(`Saga ${run.dir} stopped after pass ${run.pass}: ${why}`, level);
    } catch {
      // The pass session was replaced by hand (/new, /resume): its ctx is stale, and the saga just ends.
    }
  };

  // Waits for this pass to report, then chains the next pass from the fresh session.
  async function runPass(run: Run, ctx: any, send: boolean): Promise<void> {
    run.ctx = ctx;
    ctx.ui.setStatus(STATUS_KEY, `saga ${run.dir} #${run.pass}`);
    if (send) await ctx.sendUserMessage(passPrompt(readFileSync(join(run.cwd, run.dir, "prompt.md"), "utf8"), run.dir));

    for (;;) {
      await ctx.waitForIdle();
      const pass = readPass(ctx.sessionManager.getBranch());
      const now = pass.report ? await head(run.cwd) : run.head;
      const committed = now !== run.head;
      const step = decide(pass, committed, run);
      if (step.kind === "wait") {
        await sleep(1000);
        continue;
      }

      if (committed) {
        const left = (await git(run.cwd, ["status", "--porcelain"])).out.split("\n").filter(Boolean).length;
        ctx.ui.notify(`Saga ${run.dir} #${run.pass}: committed up to ${now.slice(0, 7)}${left ? `, ${left} paths left uncommitted` : ""}`, "info");
      }
      if (step.kind === "stop") return finish(run, step.why, step.done ? "info" : "warning");

      run.noops = step.noops;
      run.pass += 1;
      return newPass(run, ctx); // ctx is stale once the session is replaced
    }
  }

  async function newPass(run: Run, ctx: any): Promise<void> {
    run.head = await head(run.cwd);
    const name = sessionName(run.dir, run.pass);
    const marker: Marker = { dir: run.dir, pass: run.pass, head: run.head };
    const res = await ctx.newSession({
      setup: async (sm: any) => {
        sm.appendSessionInfo(name);
        sm.appendCustomEntry(MARKER, marker);
      },
      // Pi treats an error escaping withSession as fatal, so a failing pass only ends the saga.
      withSession: (next: any) => runPass(run, next, true).catch((err) => finish(run, `error: ${err?.message ?? err}`, "error")),
    });
    if (res.cancelled) finish(run, "the new session was cancelled", "warning");
  }

  const start = (run: Run, launch: () => Promise<unknown>) => {
    shared().run = run;
    launch().catch((err) => finish(run, `error: ${err?.message ?? err}`, "error"));
  };

  pi.registerCommand("saga", {
    description: "Work through a plan directory, one fresh session per pass. /saga [dir] [max] | /saga stop",
    handler: async (raw, ctx) => {
      const args = parseArgs(raw);
      if (!args) return ctx.ui.notify("Usage: /saga [dir] [max-passes] | /saga stop", "warning");
      const running = shared().run;

      if (args.stop) {
        if (!running) return ctx.ui.notify("No saga is running.", "warning");
        running.stop = true;
        return ctx.ui.notify(`Saga ${running.dir} stops after this pass.`, "info");
      }
      if (running) return ctx.ui.notify(`Saga ${running.dir} is already running.`, "warning");
      if ((await git(ctx.cwd, ["rev-parse", "--git-dir"])).code !== 0) return ctx.ui.notify("/saga needs a git repository.", "error");

      // In a pass session (e.g. after a restart), resume right here instead of starting a new pass.
      const marker = lastMarker(ctx.sessionManager.getBranch());
      if (marker && (!args.dir || args.dir === marker.dir)) {
        // Markers from before 1.1 carry no head: count from now.
        const run: Run = {
          dir: marker.dir, cwd: ctx.cwd, ctx, pass: marker.pass, max: marker.pass - 1 + args.max, noops: 0, stop: false,
          head: marker.head ?? (await head(ctx.cwd)),
        };
        activateTool();
        ctx.ui.notify(`Resuming saga ${run.dir} at pass ${run.pass}.`, "info");
        // Not awaited: holding the command would block Pi's input loop, and passes may need replies.
        return start(run, () => runPass(run, ctx, false));
      }

      let dir = args.dir;
      if (!dir) {
        const dirs = sagaDirs(ctx.cwd);
        if (dirs.length === 0) return ctx.ui.notify("No folder here has a progress.md. Use /saga <dir>.", "warning");
        dir = await ctx.ui.select("Saga", dirs);
        if (!dir) return;
      }
      if (!existsSync(join(ctx.cwd, dir)) || !statSync(join(ctx.cwd, dir)).isDirectory())
        return ctx.ui.notify(`No directory ${dir}.`, "error");

      const sessions = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir()).catch(() => []);
      const promptPath = join(ctx.cwd, dir, "prompt.md");
      if (!existsSync(promptPath)) {
        const draft = latestPromptFor(dir, sessions) ?? templatePrompt(dir);
        const text = await ctx.ui.editor(`Pass prompt for ${dir} (saved to ${dir}/prompt.md)`, draft);
        if (!text?.trim()) return ctx.ui.notify("No prompt, no saga.", "warning");
        writeFileSync(promptPath, text.endsWith("\n") ? text : `${text}\n`);
        ctx.ui.notify(`Saved ${dir}/prompt.md. It isn't part of any pass's commit, so commit it yourself.`, "info");
      }

      const pass = nextPass(dir, sessions);
      const run: Run = { dir, cwd: ctx.cwd, ctx, pass, max: pass - 1 + args.max, noops: 0, stop: false, head: "" };
      start(run, () => newPass(run, ctx));
    },
  });
}
