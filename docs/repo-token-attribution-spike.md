# Repository-level token attribution spike

Date: 2026-08-20

## Conclusion

Hermes already persists enough **session-level** metadata to support repository token attribution without changing `hermes-agent`:

- `sessions.cwd`
- `sessions.git_repo_root`
- `sessions.git_branch`
- session token and cost totals
- `session_model_usage` for per-model usage within a session

The existing token analytics plugin does not read or publish the repository fields. It currently aggregates every session by time bucket (and optionally model), then emits one workspace-wide rollup.

A plugin-only implementation is therefore feasible, with one important boundary: attribution is exact only when a session has one recorded repository. Hermes does not persist repository identity per provider/API call, so a session that works across multiple repositories cannot be split exactly after the fact.

## Evidence

### Hermes state schema

The current `sessions` table contains repository metadata and usage metrics in the same row. The relevant columns are:

```text
cwd
git_branch
git_repo_root
api_call_count
input_tokens
output_tokens
cache_read_tokens
cache_write_tokens
reasoning_tokens
estimated_cost_usd
actual_cost_usd
```

The current local database inspection found:

```text
sessions:             166
sessions with cwd:      2
sessions with repo:     0
sessions with branch:   0
```

The two sessions with `cwd` were CLI sessions. The 95 Slack sessions and 69 subagent sessions had no recorded repository root in this installation.

This is the main product risk. The schema supports attribution, but repository metadata coverage depends on how a session starts and whether its frontend/runtime assigns a workspace. A Slack session that invokes tools with explicit `workdir` values does not necessarily update the parent session's `cwd` or `git_repo_root`.

### Existing plugin

`plugins/hermes-token-analytics/cli.py::_fetch_session_metrics()` currently selects only:

- timestamp
- model
- API calls
- token classes
- cost

It drops `session id`, `cwd`, `git_repo_root`, and `git_branch` before aggregation. `build_payload()` then emits rollups grouped only by day/hour and model.

### Dashboard ingest model

The dashboard currently treats each publishing Hermes instance/profile as a workspace/agent. D1 stores:

- `workspaces`
- `daily_usage_rollups`
- `model_daily_usage`
- tools/issues

There is no repository dimension. Reusing `workspaces` to represent repositories would lose the existing agent/workspace identity and freshness semantics. Repository should be a separate dimension.

## Recommended design

### Attribution policy

Resolve one repository key per session using this ordered policy:

1. `sessions.git_repo_root`, when present.
2. Resolve `sessions.cwd` to its Git common directory or top-level working tree.
3. Optional configured path aliases for renamed/moved checkouts.
4. Otherwise classify as `unattributed`.

Normalize worktrees to the **common repository identity**, not the individual worktree path. Prefer a sanitized remote identity such as `github.com/Tevpro/punchout`; fall back to a stable local-path hash plus basename when no remote exists. Do not publish raw home-directory paths by default.

Every exported repository rollup should include an attribution status:

```text
exact        git_repo_root was present
cwd-derived  repository was resolved from cwd
unknown      no repository signal
ambiguous    multiple repository signals were found
```

Do not silently discard `unknown`; the dashboard needs an attribution-coverage KPI or the repository totals will look more authoritative than they are.

### Payload contract

Keep the current aggregate rollups for backward compatibility and add repository rollups:

```json
{
  "workspace": {
    "slug": "punchout-backend",
    "name": "PunchOut Backend",
    "provider": "Hermes"
  },
  "rollups": [],
  "repositoryRollups": [
    {
      "usageDate": "2026-08-20",
      "repository": {
        "id": "github.com/Tevpro/punchout",
        "name": "punchout"
      },
      "attribution": "exact",
      "requests": 18,
      "inputTokens": 184220,
      "outputTokens": 12640,
      "cachedTokens": 91100,
      "reasoningTokens": 20350,
      "totalTokens": 308310,
      "estimatedCostUsd": 2.7481,
      "models": []
    }
  ]
}
```

The aggregate rollup remains the source of truth for total usage. Repository rollups are a dimension of that total and must reconcile as:

```text
all repository buckets + unattributed bucket == aggregate rollup
```

### D1 schema

Add:

```text
repositories
  id
  workspace_id
  repository_key
  display_name
  created_at

repository_daily_usage
  id
  workspace_id
  repository_id nullable for unattributed
  usage_date
  environment
  attribution_status
  requests
  token classes
  estimated/actual cost fields
  created_at

repository_model_daily_usage
  repository_rollup_id
  model/provider
  requests/tokens/cost
```

Use a unique key on `(workspace_id, repository_key)` and an index on `(workspace_id, usage_date, repository_id)`.

### UI

Add a repository selector beside the existing agent selector and expose:

- tokens/cost by repository
- repository trend
- unattributed share
- attribution coverage percentage

Keep agent and repository filters orthogonal. An agent can work on several repositories; a repository can be touched by several agents.

## Accuracy boundary without Hermes core changes

### Supported accurately

- CLI/Desktop/ACP sessions launched from a repository workspace.
- Cron jobs with a repository `workdir` that Hermes persists to the session.
- One-repository sessions where `git_repo_root` or `cwd` is populated.
- Worktrees, if normalized to their Git common repository.

### Not exactly recoverable

- A single session moving between repositories.
- Slack/gateway sessions with no persisted session workspace.
- Subagents whose parent and child both lack repository metadata.
- Per-call allocation when only session-level totals are stored.

A plugin can inspect `messages.tool_calls` and infer repository candidates from terminal `workdir` arguments and absolute file paths. That provides a useful **heuristic fallback**, but it still cannot exactly split provider token usage between repositories because token counters are not persisted per tool call or per repository transition. Such rows should be marked `inferred` or `ambiguous`, never `exact`.

## Level of effort

Assumes one engineer familiar with the current plugin/dashboard and includes tests and documentation.

### Phase 1 — plugin-only publisher proof: 1–2 engineering days

- schema-capability detection using `PRAGMA table_info(sessions)`
- session repository resolver
- worktree/common-repo normalization
- unknown bucket and reconciliation tests
- dry-run payload output

This proves the data path but does not add production dashboard support.

### Phase 2 — production ingest and storage: 2–3 engineering days

- versioned payload contract
- D1 migrations and indexes
- idempotent replacement/upsert behavior
- compatibility with publishers that send only aggregate rollups
- ingest and query tests

### Phase 3 — dashboard repository filtering: 2–4 engineering days

- repository selector and URL state
- repository-aware snapshot queries
- charts/table/KPI filtering
- attribution coverage and unknown/ambiguous presentation
- responsive and regression tests

### Phase 4 — heuristic fallback for Slack/subagents: 2–4 engineering days

- parse persisted tool-call JSON
- extract `workdir` and absolute path candidates
- resolve paths to Git repositories
- confidence/ambiguity policy
- privacy-safe path sanitization
- adversarial tests for sessions touching multiple repositories

### Total

- **Useful MVP for sessions with repository metadata:** 5–9 engineering days.
- **Robust plugin-only version covering current Slack/subagent usage heuristically:** 7–13 engineering days.
- **Exact per-call attribution across repository switches:** not available plugin-only with the current persisted data; that would require Hermes to persist repository identity alongside each usage event/API call.

## Recommendation

Implement Phases 1–3 first, but gate the dashboard on a minimum attribution-coverage signal. Before committing to the UI, run the publisher against representative CLI, Desktop, Slack, cron, and delegated sessions.

For this installation, the current `git_repo_root` coverage is zero, so shipping only the straightforward session-column implementation would technically work but produce an impressive dashboard of `Unattributed`. The first acceptance gate should be repository metadata coverage, not chart polish.
