# Cloudflare Deployment

## TL;DR

This app targets Cloudflare Workers with D1 as the analytics store. The only manual blocker is creating the real D1 database and pasting its `database_id` into `wrangler.jsonc`.

## 1. Install dependencies

```bash
npm install
```

## 2. Authenticate Wrangler

```bash
npx wrangler login
npx wrangler whoami
```

## 3. Create the D1 database

```bash
npx wrangler d1 create token-usage-analytics
```

Copy the emitted `database_id` into `wrangler.jsonc` under `d1_databases[0].database_id`.

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

## 8. Deploy

```bash
npm run deploy
```

## Notes

- The dashboard currently uses mock data for the UI shell.
- The schema and migration structure are ready for live rollups.
- When the ingestion path is implemented, prefer pre-aggregated daily tables for dashboard reads.
