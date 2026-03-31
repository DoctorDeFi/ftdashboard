import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "public", "data", "nav.json");
const STATE_PATH = path.join(ROOT, "data", "nav-state.json");
const PUT_STATUS_API = "https://api.flyingtulip.com/status/put/dashboard";

const PUT_MANAGER = "0xba49d0ac42f4fba4e24a8677a22218a4df75ebaa";
const CHAINLINK_ETH_USD = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

const DEFAULT_FROM_BLOCK = 23941089n;
const CHUNK = 3000n;
const ONE_E18 = 10n ** 18n;
const ONE_E8 = 10n ** 8n;

const RPC_URL =
  process.env.ETH_RPC_URL ||
  process.env.ALCHEMY_ETH_RPC_URL ||
  "https://ethereum-rpc.publicnode.com";

const putManagerIface = new ethers.Interface([
  "event WithdrawDivestedCapital(address msig, address token, uint256 amount)"
]);
const chainlinkIface = new ethers.Interface([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"
]);

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
    lastBlock: "-1",
    stableUsd1e8: "0",
    wethUsd1e8: "0",
    usdcAmount6: "0",
    usdtAmount6: "0",
    wethAmount18: "0"
  };
}

function weiToNumber(wei, decimals = 18, precision = 8) {
  const n = BigInt(wei || "0");
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, precision);
  return Number(`${whole.toString()}.${fracStr}`);
}

function formatWithDecimals(v, decimals, fracDigits = 6) {
  const n = BigInt(v || 0n);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, fracDigits)
    .replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

function pickEthChain(payload) {
  const chains = Array.isArray(payload?.chains) ? payload.chains : [];
  return chains.find((x) => Number(x?.chainId) === 1) || chains[0] || null;
}

async function fetchPutDashboard() {
  const res = await fetch(PUT_STATUS_API);
  if (!res.ok) throw new Error(`put status fetch failed (${res.status})`);
  return res.json();
}

async function withRetry(label, fn, retries = 3) {
  let lastError;
  for (let i = 1; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries) await new Promise((r) => setTimeout(r, i * 600));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function getEthUsd1e8AtBlock(provider, blockTag) {
  const callData = chainlinkIface.encodeFunctionData("latestRoundData", []);
  const raw = await withRetry(
    `chainlink latestRoundData at ${blockTag}`,
    () => provider.call({ to: CHAINLINK_ETH_USD, data: callData }, blockTag),
    3
  );
  const decoded = chainlinkIface.decodeFunctionResult("latestRoundData", raw);
  const answer = BigInt(decoded[1]);
  return answer > 0n ? answer : 0n;
}

async function scanWithdrawDivestedCapital(provider, fromBlock, toBlock, state) {
  if (toBlock < fromBlock) return state;

  const topic0 = putManagerIface.getEvent("WithdrawDivestedCapital").topicHash.toLowerCase();
  const priceAtBlockCache = new Map();

  let stableUsd1e8 = BigInt(state.stableUsd1e8 || "0");
  let wethUsd1e8 = BigInt(state.wethUsd1e8 || "0");
  let usdcAmount6 = BigInt(state.usdcAmount6 || "0");
  let usdtAmount6 = BigInt(state.usdtAmount6 || "0");
  let wethAmount18 = BigInt(state.wethAmount18 || "0");

  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + CHUNK - 1n < toBlock ? start + CHUNK - 1n : toBlock;
    const logs = await withRetry(
      `eth_getLogs ${start}-${end}`,
      () =>
        provider.send("eth_getLogs", [
          {
            address: PUT_MANAGER,
            topics: [topic0],
            fromBlock: ethers.toQuantity(start),
            toBlock: ethers.toQuantity(end)
          }
        ]),
      3
    );

    for (const log of logs) {
      const parsed = putManagerIface.parseLog(log);
      const token = String(parsed.args.token || "").toLowerCase();
      const amount = BigInt(parsed.args.amount || 0n);
      const blockNumber = BigInt(log.blockNumber);

      if (token === USDC) {
        usdcAmount6 += amount;
        stableUsd1e8 += amount * 100n; // 6d -> 8d
      } else if (token === USDT) {
        usdtAmount6 += amount;
        stableUsd1e8 += amount * 100n; // 6d -> 8d
      } else if (token === WETH) {
        wethAmount18 += amount;
        const cacheKey = blockNumber.toString();
        let ethUsd1e8 = priceAtBlockCache.get(cacheKey);
        if (ethUsd1e8 === undefined) {
          ethUsd1e8 = await getEthUsd1e8AtBlock(provider, blockNumber);
          priceAtBlockCache.set(cacheKey, ethUsd1e8);
        }
        wethUsd1e8 += (amount * ethUsd1e8) / ONE_E18;
      }
    }

    start = end + 1n;
  }

  return {
    lastBlock: toBlock.toString(),
    stableUsd1e8: stableUsd1e8.toString(),
    wethUsd1e8: wethUsd1e8.toString(),
    usdcAmount6: usdcAmount6.toString(),
    usdtAmount6: usdtAmount6.toString(),
    wethAmount18: wethAmount18.toString()
  };
}

function computeNavs(putPayload, navState) {
  const chain = pickEthChain(putPayload);
  if (!chain) throw new Error("missing Ethereum chain payload");

  const collaterals = Array.isArray(chain.collaterals) ? chain.collaterals : [];
  const totalCollateralUsd = collaterals.reduce((sum, c) => sum + Number(c?.collateralSupplyUsd || 0), 0);
  const ftAllocated = weiToNumber(chain?.putManager?.ftAllocated || "0", 18, 8);
  const systemNav = ftAllocated > 0 ? totalCollateralUsd / ftAllocated : 0;

  const ftWithdrawn = weiToNumber(chain?.metrics?.ftTotalWithdrawn || "0", 18, 8);
  const stableUsd = Number(formatWithDecimals(BigInt(navState.stableUsd1e8 || "0"), 8, 8));
  const wethUsd = Number(formatWithDecimals(BigInt(navState.wethUsd1e8 || "0"), 8, 8));
  const withdrawalUsd = stableUsd + wethUsd;
  const withdrawalNav = ftWithdrawn > 0 ? withdrawalUsd / ftWithdrawn : 0;

  return {
    systemNav,
    withdrawalNav,
    totalCollateralUsd,
    ftAllocated,
    ftWithdrawn,
    stableUsd,
    wethUsd
  };
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const latestBlock = BigInt(await withRetry("blockNumber", () => provider.getBlockNumber(), 3));

  const prev = readJson(STATE_PATH, defaultState());
  const prevBlock = BigInt(prev.lastBlock || "-1");
  const fromBlock = prevBlock >= 0n ? prevBlock + 1n : DEFAULT_FROM_BLOCK;

  const nextState = await scanWithdrawDivestedCapital(provider, fromBlock, latestBlock, prev);
  writeJson(STATE_PATH, nextState);

  const putPayload = await fetchPutDashboard();
  const nav = computeNavs(putPayload, nextState);

  writeJson(OUT_PATH, {
    source: PUT_STATUS_API,
    updatedAt: new Date().toISOString(),
    upstreamUpdatedAt: putPayload?.lastUpdated || null,
    rpcSource: RPC_URL,
    systemNav: {
      value: nav.systemNav,
      display: `$${nav.systemNav.toFixed(5)}`
    },
    withdrawalNav: {
      value: nav.withdrawalNav,
      display: `$${nav.withdrawalNav.toFixed(5)}`
    },
    inputs: {
      totalCollateralUsd: nav.totalCollateralUsd,
      ftAllocated: nav.ftAllocated,
      ftWithdrawn: nav.ftWithdrawn,
      withdrawalComponentsUsd: {
        stable: nav.stableUsd,
        wethHistoricalMark: nav.wethUsd
      },
      withdrawalComponentsAmount: {
        usdc: formatWithDecimals(BigInt(nextState.usdcAmount6 || "0"), 6, 6),
        usdt: formatWithDecimals(BigInt(nextState.usdtAmount6 || "0"), 6, 6),
        weth: formatWithDecimals(BigInt(nextState.wethAmount18 || "0"), 18, 8)
      },
      withdrawalScanState: {
        fromBlock: fromBlock.toString(),
        toBlock: latestBlock.toString(),
        lastProcessedBlock: nextState.lastBlock
      }
    }
  });

  console.log(
    `[nav-index] updated system=${nav.systemNav.toFixed(5)} withdrawal=${nav.withdrawalNav.toFixed(5)} block=${latestBlock}`
  );
}

main().catch((error) => {
  console.error(`[nav-index] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
