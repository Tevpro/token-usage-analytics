# GitHub Actions and Cloudflare Deployment

## TL;DR

This repo uses two GitHub Actions workflows:

1. `CI` runs `typecheck`, `lint`, and `build` on pull requests and pushes to `main`.
2. `Deploy to Cloudflare` runs on pushes to `main` and manual dispatch. It applies remote D1 migrations, then deploys the Worker.

## Workflow files

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`

## Required GitHub repository secrets

Add these in **GitHub → Repo → Settings → Secrets and variables → Actions**:

### `CLOUDFLARE_API_TOKEN`
Use a Cloudflare API token with permission to:
- deploy Workers
- manage D1 migrations for this app

At minimum, the token should be able to operate on the target account's Workers and D1 resources.

### `CLOUDFLARE_ACCOUNT_ID`
The Cloudflare account ID that owns the Worker and D1 database.

## Required repo config before deploy works

### 1. Real D1 database ID in `wrangler.jsonc`
This repo still ships with a placeholder:

```json
"database_id": "YOUR_D1_DATABASE_ID"
```

Replace it with the real ID from:

```bash
npx wrangler d1 create token-usage-analytics
```

### 2. Wrangler auth must work with the token
The deploy workflow uses environment-based auth through GitHub secrets. If the token is wrong or underscoped, deployment will fail before or during migration apply.

## Deploy behavior

On every push to `main`, the deploy workflow will:

1. install dependencies
2. build the app
3. run remote D1 migrations
4. deploy the Worker

That order is deliberate. Schema drift first, code second.

## Recommended operating pattern

- open PRs for changes
- let `CI` validate them
- merge to `main`
- let `Deploy to Cloudflare` publish automatically

## Common failure modes

### `CLOUDFLARE_API_TOKEN` missing or invalid
The workflow will fail when `wrangler` tries to apply migrations or deploy.

### `CLOUDFLARE_ACCOUNT_ID` missing
Wrangler may fail to resolve the target account.

### placeholder `database_id`
Remote D1 migration apply will fail immediately.

### token lacks D1 or Workers permissions
Deploy may partially fail or fail at the migration step.

## Recommendation

Do not treat this as finished until:
- the real D1 database exists
- the real `database_id` is committed
- both GitHub secrets are present
- one successful deployment has run on `main`
