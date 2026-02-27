# Flying Tulip FT Community Dashboard

Community-made dashboard for FT allocation metrics.

## Architecture

- Frontend reads precomputed metrics from `public/data/metrics.json`.
- Indexer script computes metrics from onchain data and updates:
  - `data/state.json` (incremental cursors/state)
  - `public/data/metrics.json` (served to users)
- Static server (`src/server.js`) serves app and files.

This setup is Vercel-friendly because the browser no longer runs heavy onchain indexing.

## Commands

```bash
npm run dev
npm run index
```

## Publish flow (no paid RPC)

1. Run indexer before deploy:

```bash
npm run index
```

2. Deploy to Vercel.

3. Re-run `npm run index` on a schedule (GitHub Actions/cron) and commit updated `public/data/metrics.json`.

## Automated updates (GitHub Actions)

Workflow added: `.github/workflows/update-metrics.yml`

- Runs every 30 minutes.
- Executes `npm run index`.
- Commits `public/data/metrics.json` and `data/state.json` when changed.

If your Vercel project is connected to this GitHub repo, each metrics commit auto-deploys.

## Notes

- Public RPC endpoints can still be rate-limited/pruned.
- Indexer uses incremental state and fallback logic for pruned ranges.
- Dashboard is community-made, not official.
