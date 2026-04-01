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
npm run index:puts
npm run index:nav
npm run index:buys
```

## PUTs Marketplace Dashboard

- On-chain indexer: `npm run index:puts`
- Output snapshot: `public/data/puts-marketplace.json`
- Incremental state: `data/puts-state.json`
- Frontend page: `/puts-marketplace.html`

## NAV snapshot (System NAV + Withdrawal NAV)

- Generator: `npm run index:nav`
- Output snapshot: `public/data/nav.json`
- Incremental state: `data/nav-state.json`
- Source: `https://api.flyingtulip.com/status/put/dashboard`
- Withdrawal NAV WETH leg uses historical event-time ETH/USD marks.

## Protocol FT buys snapshot

- Generator: `npm run index:buys`
- Output snapshot: `public/data/protocol-ft-buys.json`
- Incremental state: `data/protocol-buys-state.json`
- Tracked wallets:
  - ETH ftUSD: `0xbae14f050fb8cda4d16ab47dbec67793c7c0b566`
  - Sonic ftUSD: `0xed0077a9e26329327722a81df2db3450f100226f`
  - Sonic Margin: `0x5cd6abe67f8af1c0c699df36d90a6469eaf1958a`

Suggested local flow:

1. Run `npm run index:puts`
2. Run `npm run dev`
3. Open `http://localhost:3000/puts-marketplace.html`

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
- Executes `npm run index`, `npm run index:puts`, `npm run index:nav`, and `npm run index:buys`.
- Commits `public/data/metrics.json` and `data/state.json` when changed.

### Ethereum RPC (paid endpoint)

Set repository secret:

- `ETH_RPC_URL` (recommended: your paid Alchemy mainnet URL)

The indexers will use this endpoint first for Ethereum RPC calls.

If your Vercel project is connected to this GitHub repo, each metrics commit auto-deploys.

## Notes

- Public RPC endpoints can still be rate-limited/pruned.
- Indexer uses incremental state and fallback logic for pruned ranges.
- Dashboard is community-made, not official.
