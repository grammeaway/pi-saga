---
name: saga-plan
description: Turn a source document (audit, roadmap, measurements, feature list) into a saga plan directory for /saga, or amend an existing saga with new input.
disable-model-invocation: true
---

A **saga** is a plan directory that `/saga` works through one **pass** at a time: each pass is a fresh agent session that implements the next plan and ends in one commit. You write the directory; later passes read nothing but the directory and the code, so every plan has to stand on its own.

The directory:

- `README.md`: the goal, the inputs, a **verdict** per source item, the plans in order with the reason for the order, and the shared rules.
- `progress.md`: the live log. A Status table with one row per plan, then Decisions, Deviations and Found.
- One file per plan.
- `prompt.md`: the pass prompt `/saga` sends to every pass. The loop appends its own instructions for staging and reporting, so `prompt.md` stays about the work.

## Steps

### 1. Gather

Establish four things, asking the user for whatever the conversation doesn't settle:

- **Source**: the document(s) to plan from. Anything goes: an audit, a roadmap, measurements from a live system, a list of missing features, the conversation itself.
- **Mode**: a new saga (target directory name) or an amendment to an existing one (its path).
- **Style reference**: an existing saga directory to match. Look for sibling directories with a `progress.md` and offer them. Without one, use [`TEMPLATE.md`](TEMPLATE.md).
- **Goal**: what the saga is for, and what must not regress on the way.

Done when all four are known. In amend mode, read the existing README and `progress.md` in full before going on.

### 2. Verify every source item against the code

Treat the source as **adversarial**: it may be stale, wrong, pedantic or out of scope, and only what survives becomes a plan. For each item, read the code it points at and give it a verdict:

- **Confirmed**, with file:line evidence.
- **Partly**: what holds, what doesn't, and so what the plan actually changes.
- **Dropped**: why (already fixed, not a real defect, cost exceeds value).
- **Owner**: a call only the user can make (scope, risk, product behaviour). Put these to the user and record the answers as decisions.

When the source has more items than you can check closely in one context, dispatch subagents, one per area of the code, each returning verdicts with evidence. Re-check any verdict that surprises you yourself.

Done when every item has a verdict, every Owner item has an answer, and anything you found beyond the source has a row of its own.

### 3. Shape the plans

Group the surviving items into plans. One plan is one pass and one commit: sized so a fresh session can finish it, and focused enough that a regression points at one plan. Order the plans and write down why: fixes before the code they touch gets moved, dependencies first, cheap and risk-free first when nothing else decides. Name any **gate** a plan needs from the user or the world (a benchmark on an idle machine, a measurement from production, a decision): a pass hitting an unmet gate stops and asks.

Each plan file holds:

- **Finding**: what is wrong or missing, with evidence.
- **Change**: what the plan does.
- **Steps**: in order.
- **Completion**: checkable criteria. Prefer a command and its expected result, or a test that goes red without the change.
- **Non-goals**: whatever a pass might be tempted to pull in.

Plan files are documents for agents: load the `writing-for-agents` skill before writing them, if it is available.

Done when every confirmed or partly-confirmed item lands in exactly one plan, and every plan has completion criteria a pass can check without asking.

### 4. Write the directory

- **New**: write the README, the plan files and `progress.md`, with every plan's row set to `planned`.
- **Amend**: add plans and rows, reopen a row by setting its status to `reopened` with the reason, and add verdicts and decisions. Rows and deviations of finished plans are history; leave their text as it stands.

Done when the README's plan table, the plan files and the Status rows name the same plans in the same order.

### 5. Draft `prompt.md`

Write the pass prompt from what the user said. Keep it about the work, and cover:

- The task: implement the next plan in `./<dir>/`, keeping `progress.md` up to date, deviations included.
- How involved the user wants to be: ask when in doubt, or decide and log the decision.
- Anything about the environment a pass can't see, for example whether the machine is free for benchmarks.
- The goal from step 1.

Show the draft and revise it until the user approves. In amend mode, propose changes to the existing `prompt.md` only if the amendment needs them.

### 6. Hand back

Summarise: plans added or reopened, items dropped and why, decisions taken. Suggest a commit message in the repository's style (check `git log`). The user commits. Then point to `/saga <dir>`.
