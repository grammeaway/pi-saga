# Saga template

Skeletons for a saga directory, used when there is no style reference. Replace every `<...>`. The example content is made up.

## README.md

```markdown
# <Round name> (<date>)

**Goal:** <what the saga is for, and what must not regress>.

**Inputs:** <source documents, with commit or date>. Each item was checked against the code; verdicts below.

**Baseline:** `<commit>`.

## Verdicts

| # | Source item | Verdict | Plan |
|---|---|---|---|
| 1 | Upload handler reads the whole file into memory | **Confirmed** (`upload.py:88`) | p2 |
| 2 | Retry loop has no backoff | **Dropped:** the client library already backs off | — |

## Decisions

| # | Decision | Taken |
|---|---|---|
| D1 | <owner call> | <date> |

## Plans

| Order | Plan | What | Gate |
|---|---|---|---|
| 1 | [`p1_<name>.md`](p1_<name>.md) | <one line> | none |
| 2 | [`p2_<name>.md`](p2_<name>.md) | <one line> | <benchmark, decision, ...> |

**Why this order:** <dependencies, fix before move, risk>.

## Shared rules

- Each plan is its own commit. Keep plans out of each other's diffs.
- <tests, docs, compatibility rules every pass follows>
```

## progress.md

```markdown
# <Round name>: progress

Live log for `README.md`'s plans. One row per plan; details under Deviations and Found.

## Status

| Plan | Status | Base | Notes |
|---|---|---|---|
| p1 <name> | planned | | |
| p2 <name> | planned | | |

## Decisions

Decisions taken during passes, with who took them (owner or agent) and when.

## Deviations

Per plan: where the work differed from the plan, and why.

## Found

Bugs or debts found during a pass and kept out of its diff.
```

## Plan file

```markdown
# P2: Stream uploads

## Finding

<what is wrong or missing, with file:line evidence>

## Change

<what this plan does>

## Steps

1. <step>
2. <step>

## Completion

- [ ] <command and expected result, or a test that fails without the change>
- [ ] Tests and lint green

## Non-goals

- <what a pass might be tempted to pull in>
```

## prompt.md

```markdown
Your task is to implement the next plan in ./<dir>/. Keep a high degree of engineering rigor, and keep progress.md up to date, including any deviations from the plan.

<Ask when in doubt. | Decide on your own and log each decision in progress.md.>

<Environment facts a pass can't see.> The end goal is <goal>.
```
