# Cloudflare deployment

## TL;DR

The Cloudflare app now lives in `apps/dashboard/`.
All app, Wrangler, and D1 commands should be run from that directory.

## 1. Install dependencies

```bash
cd apps/dashboard
npm ci
```

## 2. Authenticate Wrangler

```bash
npx wrangler login
npx wrangler whoami
```

## 3. Verify the D1 binding

Check:

- `apps/dashboard/wrangler.jsonc`

Make sure the committed `d1_databases[0].database_id` is the right database for the environment you intend to deploy.

## 4. Generate types

```bash
npm run cf:typegen
```

## 5. Apply migrations locally

```bash
npm run cf:d1:migrate:local
```

## 6. Apply migrations remotely

```bash
npm run cf:d1:migrate:remote
```

## 7. Run the app locally

```bash
npm run dev
```

## 8. Deploy manually

```bash
npm run deploy
```

## 9. GitHub Actions deployment

The repo includes path-aware GitHub Actions workflows.
Dashboard deploy flows only fire when dashboard/deploy paths change.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Deploy workflow behavior:

1. install dependencies in `apps/dashboard/`
2. build the app
3. apply remote D1 migrations
4. deploy the Worker

See `docs/github-actions.md` for the exact GitHub setup.
