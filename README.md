# pi-saga

Sagas for the [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent: work through a directory of implementation plans, one fresh session and one commit per pass, stopping to ask you when a pass needs you.

Made for long-running work that's been planned up front: an audit, a roadmap or a batch of measurements becomes a set of plans, and each plan becomes one well-sized commit. `/saga` takes away the restarts in between: ask for a commit message, commit, open a new session, paste the same prompt again.

## How does this differ from e.g. Ralph loops or Claude Code's /loop?
I honestly couldn't tell you in any meaningful level of detail, since I've never seen the Claude Code loops in action, and only briefly tried my hand at Ralph loops.

`pi-saga` is very opinionated, and built around the semi-to-90%-hands-off way that I like to work with agentic coding tools: I keep the human in the loop, but with the tools and frameworks in place to let the agent do its thing once we agree on what needs doing. 

I've found that a lot of looping frameworks and tools are built around a lot of upfront planning and then zero human intervention until completion - I've never loved working that way, and I find that it often ends up with overly verbose solutions, or solutions that over too many iterations depart from the original vision (despite the high level of upfront planning). 

If that resonates with you, then `pi-saga` might fit your workflow like a glove, and if not, then there's guaranteed to be a better fitting looping setup out there for you (or you can just make your own with `pi`, like I opted for).

## Install

```bash
pi install npm:@grammeaway/pi-saga
```

## The saga directory

A saga is a directory. `/saga` reads nothing else, so a saga can be resumed from any session, and amended by hand or by another agent between passes.

| File | What |
|---|---|
| `README.md` | The plans, in order, and the rules they share |
| `progress.md` | Which plans are done, plus decisions and deviations. The pass agent keeps it up to date |
| `prompt.md` | The prompt every pass starts with, re-read before each pass. Edit it to change course mid-saga, e.g. to say how much you want to be asked |
| one file per plan | What a pass implements |

The bundled `saga-plan` skill writes such a directory from any source document, or amends an existing one: `/skill:saga-plan`.

## Usage

| Command | Effect |
|---|---|
| `/saga` | Pick a folder with a `progress.md` (a saga) and start it. Inside a paused pass session, resume that pass |
| `/saga <dir> [max]` | Start or resume the saga in `<dir>`, at most `max` passes (default 20) |
| `/saga stop` | Let the current pass finish, then stop |

If `<dir>` has no `prompt.md`, an editor opens with the first prompt of your latest session that mentioned the folder, and saves the result.

## A pass

1. A new session (`saga: <dir> #N`) starts with `prompt.md`, plus a short note on how a pass ends. `N` counts on from the saga's earlier passes, across runs.
2. The agent works. When it needs you, it asks and ends its turn; the loop waits until you've answered and the agent carries on.
3. The agent commits its changes, leaving unrelated files out, and calls `saga_pass` with a status: `next`, `complete` or `blocked` (with a reason). Since the agent commits, the work lands even if the loop has already stopped.
4. The loop starts the next pass, or stops.

The loop stops on `complete`, `blocked`, Escape, an error, `/saga stop`, the pass limit, or two passes in a row that committed nothing. It always says why. After a Pi restart, resume the paused pass session and type `/saga`.

## Notes

- One saga at a time per Pi process.
- New sessions use whatever model is active when you start the saga.
- Pairs with [pi-cook](https://www.npmjs.com/package/@grammeaway/pi-cook): its mode carries into each new pass session, so `/cook agent` keeps the screen awake for the whole saga.

## AI Usage Disclaimer 
Extension written fully by Pi itself, with Claude Opus 5.5 as the model.
