import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { decide, NOOP_LIMIT, STATUSES, type Ended, type Pass, type Status } from "../logic.ts";

// One pass as the loop sees it once the session is idle; null report = the agent is waiting on the user.
const passArb = fc.record({
  status: fc.option(fc.constantFrom<Status>(...STATUSES), { nil: undefined }),
  ended: fc.constantFrom<Ended>("ok", "ok", "ok", "aborted", "error"),
  committed: fc.boolean(),
  stopAsked: fc.boolean(),
});

test("the loop only waits on a quiet pass, and only goes on after a clean next", () => {
  fc.assert(
    fc.property(passArb, fc.nat(5), fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 30 }), (p, noops, pass, max) => {
      const report = p.status && { status: p.status, reason: "r" };
      const step = decide({ report, ended: p.ended }, p.committed, { pass, max, noops: Math.min(noops, NOOP_LIMIT - 1), stop: p.stopAsked });
      if (step.kind === "wait") return assert.ok(!report && p.ended === "ok" && !p.stopAsked);
      if (step.kind === "next") assert.ok(report?.status === "next" && p.ended === "ok" && !p.stopAsked && pass < max);
    }),
  );
});

test("a saga run always ends: within max passes, and never after NOOP_LIMIT empty passes in a row", () => {
  fc.assert(
    fc.property(fc.array(passArb, { minLength: 1, maxLength: 60 }), fc.integer({ min: 1, max: 25 }), (passes, max) => {
      const loop = { pass: 1, max, noops: 0, stop: false };
      let emptyRun = 0;
      for (const p of passes) {
        // Waiting on the user: they eventually answer and the agent reports.
        const status: Status = p.status ?? "next";
        const outcome: Pass = { report: { status }, ended: p.ended };
        const step = decide(outcome, p.committed, loop);
        emptyRun = p.committed ? 0 : emptyRun + 1;
        assert.ok(step.kind !== "wait");
        if (step.kind === "stop") return;
        assert.ok(emptyRun < NOOP_LIMIT, "ran on after too many empty passes");
        assert.ok(loop.pass < max, "ran past max");
        loop.noops = step.noops;
        loop.pass += 1;
      }
    }),
    { numRuns: 2000 },
  );
});
