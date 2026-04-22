import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, "data", "protocol-buys-state.json");
const OUT_PATH = path.join(ROOT, "public", "data", "protocol-ft-buys.json");

const FT_TOKEN = "0x5dd1a7a369e8273371d2dbf9d83356057088082c";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const ETH_RPC_URL = process.env.ETH_RPC_URL || process.env.ALCHEMY_ETH_RPC_URL || "";
const SONIC_RPC_URL = process.env.SONIC_RPC_URL || process.env.ALCHEMY_SONIC_RPC_URL || "";

const CHAINS = [
  {
    key: "ethereum",
    label: "Ethereum",
    lookback: 1_500_000n,
    chunk: 9_000n,
    rpcs: [
      ...(ETH_RPC_URL ? [ETH_RPC_URL] : []),
      "https://ethereum-rpc.publicnode.com",
      "https://cloudflare-eth.com"
    ],
    wallets: [
      {
        address: "0xbae14f050fb8cda4d16ab47dbec67793c7c0b566",
        module: "ftUSD ETH"
      }
    ]
  },
  {
    key: "sonic",
    label: "Sonic",
    lookback: 3_000_000n,
    chunk: 9_000n,
    rpcs: [...(SONIC_RPC_URL ? [SONIC_RPC_URL] : []), "https://rpc.soniclabs.com"],
    wallets: [
      {
        address: "0xed0077a9e26329327722a81df2db3450f100226f",
        module: "ftUSD Sonic"
      },
      {
        address: "0x5cd6abe67f8af1c0c699df36d90a6469eaf1958a",
        module: "Margin Sonic"
      }
    ]
  }
];

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "USDS", "USDE", "USDTB", "DAI", "USDC.E"]);
const SELECTORS = {
  symbol: "0x95d89b41",
  decimals: "0x313ce567"
};

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function defaultState() {
  return {
    chains: {},
    txs: {}
  };
}

function toHex(n) {
  return `0x${n.toString(16)}`;
}

function hexToBigInt(v) {
  if (!v || v === "0x") return 0n;
  return BigInt(v);
}

function topicAddress(address) {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function fromTopic(topic) {
  return `0x${String(topic || "").slice(-40).toLowerCase()}`;
}

function wordAt(hexValue, index) {
  const body = String(hexValue || "0x").slice(2);
  const start = index * 64;
  const part = body.slice(start, start + 64);
  if (part.length < 64) return null;
  return `0x${part}`;
}

function decodeString(hexValue) {
  const body = String(hexValue || "").slice(2);
  if (!body || body.length < 128) return null;
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  const start = offset * 2;
  const len = Number(BigInt(`0x${body.slice(start, start + 64)}`));
  const dataHex = body.slice(start + 64, start + 64 + len * 2);
  if (!dataHex) return null;
  try {
    return Buffer.from(dataHex, "hex").toString("utf8").replace(/\0+$/, "").trim() || null;
  } catch {
    return null;
  }
}

function formatUnits(value, decimals, frac = 6) {
  const n = BigInt(value || 0n);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const rest = n % base;
  const restStr = rest
    .toString()
    .padStart(decimals, "0")
    .slice(0, frac)
    .replace(/0+$/, "");
  return restStr ? `${whole.toString()}.${restStr}` : whole.toString();
}

function isStableAToken(symbol) {
  const s = String(symbol || "").toUpperCase();
  if (!s.startsWith("A")) return false;
  for (const stable of STABLE_SYMBOLS) {
    if (s.includes(stable)) return true;
  }
  return false;
}

async function rpcWithFallback(chain, method, params = []) {
  const payload = { jsonrpc: "2.0", id: 1, method, params };
  let lastError = null;
  for (const endpoint of chain.rpcs) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || `${res.status} ${res.statusText}`);
      }
      return json.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("rpc_failed");
}

async function getErc20Meta(chain, token, cache) {
  const key = token.toLowerCase();
  if (cache[key]) return cache[key];
  let symbol = key.slice(0, 6);
  let decimals = 18;
  try {
    const raw = await rpcWithFallback(chain, "eth_call", [{ to: key, data: SELECTORS.symbol }, "latest"]);
    symbol = decodeString(raw) || symbol;
  } catch {}
  try {
    const raw = await rpcWithFallback(chain, "eth_call", [{ to: key, data: SELECTORS.decimals }, "latest"]);
    const d = hexToBigInt(wordAt(raw, 0));
    if (d >= 0n && d <= 255n) decimals = Number(d);
  } catch {}
  cache[key] = { symbol, decimals };
  return cache[key];
}

async function getLogs(chain, fromBlock, toBlock, topic2) {
  return rpcWithFallback(chain, "eth_getLogs", [
    {
      address: FT_TOKEN,
      topics: [TRANSFER_TOPIC, null, topic2],
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock)
    }
  ]);
}

async function getReceipt(chain, txHash) {
  return rpcWithFallback(chain, "eth_getTransactionReceipt", [txHash]);
}

async function getBlock(chain, blockHex) {
  return rpcWithFallback(chain, "eth_getBlockByNumber", [blockHex, false]);
}

async function scanChain(chain, state) {
  const blockNow = hexToBigInt(await rpcWithFallback(chain, "eth_blockNumber", []));
  const prev = state.chains?.[chain.key] || { lastBlock: "-1" };
  const prevBlock = BigInt(prev.lastBlock || "-1");
  const fromBlock =
    prevBlock >= 0n ? prevBlock + 1n : blockNow > chain.lookback ? blockNow - chain.lookback : 0n;

  const ftLogs = [];
  if (fromBlock <= blockNow) {
    for (const wallet of chain.wallets) {
      const toTopic = topicAddress(wallet.address);
      let start = fromBlock;
      while (start <= blockNow) {
        const end = start + chain.chunk < blockNow ? start + chain.chunk : blockNow;
        const logs = await getLogs(chain, start, end, toTopic);
        for (const log of logs) ftLogs.push({ ...log, wallet: wallet.address, module: wallet.module });
        start = end + 1n;
      }
    }
  }

  const grouped = new Map();
  for (const log of ftLogs) {
    const txHash = String(log.transactionHash || "").toLowerCase();
    const wallet = String(log.wallet || "").toLowerCase();
    if (!txHash || !wallet) continue;
    const key = `${chain.key}:${wallet}:${txHash}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        chain: chain.label,
        chainKey: chain.key,
        wallet,
        module: log.module,
        txHash,
        blockNumber: Number(hexToBigInt(log.blockNumber)),
        ftBoughtWei: 0n
      });
    }
    grouped.get(key).ftBoughtWei += hexToBigInt(log.data || "0x0");
  }

  const blockCache = new Map();
  const tokenMetaCache = {};

  for (const row of grouped.values()) {
    const stateKey = `${row.chainKey}:${row.wallet}:${row.txHash}`;
    if (state.txs[stateKey]) continue;

    const receipt = await getReceipt(chain, row.txHash);
    const fromWalletTopic = topicAddress(row.wallet);

    let stableSpentUsd1e6 = 0n;
    const tokenBreakdown = [];
    let stableOut1e6 = 0n;
    let stableIn1e6 = 0n;
    let aTokenStableOut1e6 = 0n;

    for (const lg of receipt.logs || []) {
      const topic0 = String(lg.topics?.[0] || "").toLowerCase();
      if (topic0 !== TRANSFER_TOPIC) continue;
      const token = String(lg.address || "").toLowerCase();
      if (token === FT_TOKEN) continue;
      const amount = hexToBigInt(lg.data || "0x0");
      if (amount <= 0n) continue;

      const meta = await getErc20Meta(chain, token, tokenMetaCache);
      const symbol = String(meta.symbol || "").toUpperCase();
      const fromTopicValue = String(lg.topics?.[1] || "").toLowerCase();
      const toTopicValue = String(lg.topics?.[2] || "").toLowerCase();
      const isOut = fromTopicValue === fromWalletTopic;
      const isIn = toTopicValue === fromWalletTopic;
      if (!isOut && !isIn) continue;

      if (isOut) {
        const amountDisplay = formatUnits(amount, meta.decimals, 6);
        tokenBreakdown.push({ token, symbol, amount: amountDisplay });
      }

      if (STABLE_SYMBOLS.has(symbol) || isStableAToken(symbol)) {
        let amount1e6 = 0n;
        if (meta.decimals >= 6) {
          const scaleDown = 10n ** BigInt(meta.decimals - 6);
          amount1e6 = amount / scaleDown;
        } else {
          const scaleUp = 10n ** BigInt(6 - meta.decimals);
          amount1e6 = amount * scaleUp;
        }

        if (isStableAToken(symbol) && isOut) {
          aTokenStableOut1e6 += amount1e6;
        } else if (STABLE_SYMBOLS.has(symbol)) {
          if (isOut) stableOut1e6 += amount1e6;
          if (isIn) stableIn1e6 += amount1e6;
        }
      }
    }
    const netStableOut1e6 = stableOut1e6 > stableIn1e6 ? stableOut1e6 - stableIn1e6 : 0n;
    stableSpentUsd1e6 = aTokenStableOut1e6 + netStableOut1e6;

    const blockHex = toHex(BigInt(row.blockNumber));
    if (!blockCache.has(blockHex)) blockCache.set(blockHex, await getBlock(chain, blockHex));
    const blk = blockCache.get(blockHex);
    const ts = Number(hexToBigInt(blk?.timestamp || "0x0"));

    state.txs[stateKey] = {
      chain: row.chain,
      chainKey: row.chainKey,
      module: row.module,
      wallet: row.wallet,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
      timestamp: ts,
      ftBoughtWei: row.ftBoughtWei.toString(),
      stableSpentUsd1e6: stableSpentUsd1e6.toString(),
      tokenOutflows: tokenBreakdown
    };
  }

  state.chains[chain.key] = { lastBlock: blockNow.toString() };
}

function buildOutput(state) {
  const rows = Object.values(state.txs || {}).sort((a, b) => {
    if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
    return b.timestamp - a.timestamp;
  });

  let ftTotalWei = 0n;
  let usdSpent1e6 = 0n;
  const moduleTotals = {};
  const chainTotals = {};
  const dayMap = new Map();

  for (const r of rows) {
    const ft = BigInt(r.ftBoughtWei || "0");
    const usd = BigInt(r.stableSpentUsd1e6 || "0");
    ftTotalWei += ft;
    usdSpent1e6 += usd;

    const m = r.module || "Unknown";
    if (!moduleTotals[m]) moduleTotals[m] = { ftWei: 0n, usd1e6: 0n, txCount: 0 };
    moduleTotals[m].ftWei += ft;
    moduleTotals[m].usd1e6 += usd;
    moduleTotals[m].txCount += 1;

    const c = r.chain || "Unknown";
    if (!chainTotals[c]) chainTotals[c] = { ftWei: 0n, usd1e6: 0n, txCount: 0 };
    chainTotals[c].ftWei += ft;
    chainTotals[c].usd1e6 += usd;
    chainTotals[c].txCount += 1;

    if (r.timestamp) {
      const day = new Date(r.timestamp * 1000).toISOString().slice(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, { day, ftWei: 0n, usd1e6: 0n });
      const d = dayMap.get(day);
      d.ftWei += ft;
      d.usd1e6 += usd;
    }
  }

  const avgBuyPrice = ftTotalWei > 0n ? Number(usdSpent1e6 * 10n ** 18n / ftTotalWei) / 1e6 : 0;
  const now = Date.now();
  const t24 = now - 24 * 60 * 60 * 1000;
  const t7d = now - 7 * 24 * 60 * 60 * 1000;
  let ft24Wei = 0n;
  let ft7dWei = 0n;
  for (const r of rows) {
    const tsMs = Number(r.timestamp || 0) * 1000;
    const ft = BigInt(r.ftBoughtWei || "0");
    if (tsMs >= t24) ft24Wei += ft;
    if (tsMs >= t7d) ft7dWei += ft;
  }

  return {
    updatedAt: new Date().toISOString(),
    source: "onchain_transfer_inflow",
    wallets: CHAINS.flatMap((c) =>
      c.wallets.map((w) => ({ chain: c.label, chainKey: c.key, address: w.address, module: w.module }))
    ),
    summary: {
      totalFtBought: formatUnits(ftTotalWei, 18, 4),
      totalUsdSpentStableEstimate: formatUnits(usdSpent1e6, 6, 2),
      avgBuyPriceUsd: avgBuyPrice ? avgBuyPrice.toFixed(5) : "0",
      ftBought24h: formatUnits(ft24Wei, 18, 4),
      ftBought7d: formatUnits(ft7dWei, 18, 4),
      txCount: rows.length
    },
    moduleTotals: Object.entries(moduleTotals).map(([module, v]) => ({
      module,
      ftBought: formatUnits(v.ftWei, 18, 4),
      usdSpentStableEstimate: formatUnits(v.usd1e6, 6, 2),
      txCount: v.txCount
    })),
    chainTotals: Object.entries(chainTotals).map(([chain, v]) => ({
      chain,
      ftBought: formatUnits(v.ftWei, 18, 4),
      usdSpentStableEstimate: formatUnits(v.usd1e6, 6, 2),
      txCount: v.txCount
    })),
    daily: Array.from(dayMap.values())
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({
        day: d.day,
        ftBought: formatUnits(d.ftWei, 18, 4),
        usdSpentStableEstimate: formatUnits(d.usd1e6, 6, 2)
      })),
    recentBuys: rows.slice(0, 100).map((r) => ({
      chain: r.chain,
      module: r.module,
      wallet: r.wallet,
      txHash: r.txHash,
      blockNumber: r.blockNumber,
      time: r.timestamp ? new Date(r.timestamp * 1000).toISOString() : null,
      ftBought: formatUnits(BigInt(r.ftBoughtWei || "0"), 18, 4),
      usdSpentStableEstimate: formatUnits(BigInt(r.stableSpentUsd1e6 || "0"), 6, 2),
      tokenOutflows: r.tokenOutflows || []
    }))
  };
}

async function main() {
  const rebuild = process.argv.includes("--rebuild");
  const state = readJson(STATE_PATH, defaultState());
  state.chains ||= {};
  state.txs ||= {};

  if (rebuild) {
    state.chains = {};
    state.txs = {};
  }

  for (const chain of CHAINS) {
    await scanChain(chain, state);
  }

  const out = buildOutput(state);
  writeJson(STATE_PATH, state);
  writeJson(OUT_PATH, out);
  console.log(
    `[buys-index] done txs=${out.summary.txCount} totalFT=${out.summary.totalFtBought} totalUSD=${out.summary.totalUsdSpentStableEstimate}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
