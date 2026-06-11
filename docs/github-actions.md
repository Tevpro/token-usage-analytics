# GitHub Actions and Cloudflare deployment

## TL;DR

This monorepo uses path-aware GitHub Actions:

1. `CI` detects what changed.
2. Dashboard changes run Node validation from `apps/dashboard/`.
3. Hermes plugin changes run Python validation from `plugins/hermes-token-analytics/`.
4. Cloudflare preview and production deploys only run when dashboard/deploy paths change.

## Workflow files

- `.github/workflows/ci.yml`
- `.github/workflows/preview-deploy.yml`
- `.github/workflows/deploy.yml`

## Dashboard app location

The Cloudflare app now lives under:

- `apps/dashboard/`

That means Actions commands run there, not from repo root.

## CI behavior

### Dashboard validation

Runs when files under these paths change:

- `apps/dashboard/**`
- `.github/workflows/ci.yml`

Validation steps:

1. `npm ci`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`

### Hermes plugin validation

Runs when files under these paths change:

- `plugins/hermes-token-analytics/**`
- `.github/workflows/ci.yml`

Validation steps:

1. install `pytest`
2. run plugin tests from `plugins/hermes-token-analytics/tests/`

## Preview deploy behavior

`preview-deploy.yml` only runs for dashboard/deploy-path pull request changes.

It:

1. installs dashboard dependencies in `apps/dashboard/`
2. builds the app
3. deploys a PR-specific Cloudflare Worker preview
4. writes the preview URL into the GitHub Actions job summary
5. posts or updates a PR comment with the current preview URL

## Production deploy behavior

`deploy.yml` runs on pushes to `main` for dashboard/deploy-path changes and on manual dispatch.

It:

1. installs dashboard dependencies in `apps/dashboard/`
2. builds the app
3. applies remote D1 migrations
4. deploys the Worker

Schema first, code second.

## Required GitHub repository secrets

Add these in GitHub repo settings:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Required repo config before deploy works

### 1. Correct D1 database binding in `apps/dashboard/wrangler.jsonc`

The deploy workflows use the Wrangler config under `apps/dashboard/`.
Make sure the committed D1 binding points at the real target database for this environment.

### 2. Wrangler auth must work with the token

If the token is missing, invalid, or underscoped, preview and production deploys will fail during migration or deploy.

## Common failure modes

### Preview or deploy ran on the wrong changes

Check the workflow path filters first.

### `CLOUDFLARE_API_TOKEN` missing or invalid

Wrangler will fail during migration apply or deploy.

### `CLOUDFLARE_ACCOUNT_ID` missing

Wrangler may fail to resolve the target account.

### Wrong `database_id` in `apps/dashboard/wrangler.jsonc`

Remote D1 migration apply will fail or target the wrong database.

### Token lacks D1 or Workers permissions

Deploy may partially fail or fail at the migration step.

## Important GitHub auth pitfall

If a push updates `.github/workflows/*`, GitHub may reject it unless the token has workflow-update permission.
That is an auth scope problem, not a YAML problem.
