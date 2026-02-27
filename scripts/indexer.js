import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, "data", "state.json");
const METRICS_PATH = path.join(ROOT, "public", "data", "metrics.json");

const FT_TOKEN = "0x5dd1a7a369e8273371d2dbf9d83356057088082c";
const PUT_MANAGER = "0xba49d0ac42f4fba4e24a8677a22218a4df75ebaa";
const FT_PUT = "0xa4215daaf3745e14e96e169e0e7706c479ce04f2";
const MSIG_WALLET = "0x22246a9183ce2ce6e2c2a9973f94aea91435017c";
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_SUPPLY_WEI = 10_000_000_000n * 10n ** 18n;

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const CALL_DATA = {
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  ftAllocated: "0x70d8da31"
};

const CHAINS = [
  {
    key: "ethereum",
    label: "Ethereum",
    lookback: 220_000n,
    chunk: 40_000n,
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"]
  },
  {
    key: "sonic",
    label: "Sonic",
    lookback: 900_000n,
    chunk: 45_000n,
    rpcs: ["https://rpc.soniclabs.com"]
  },
  {
    key: "base",
    label: "Base",
    lookback: 900_000n,
    chunk: 40_000n,
    rpcs: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"]
  },
  {
    key: "bnb",
    label: "BNB",
    lookback: 80_000n,
    chunk: 8_000n,
    rpcs: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"]
  },
  {
    key: "avalanche",
    label: "Avalanche",
    lookback: 700_000n,
    chunk: 40_000n,
    rpcs: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"]
  }
];

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
    vc: { lastBlock: "-1", addresses: [] },
    ftAlloc: { lastBlock: "-1", investedWei: "0", divestedWei: "0", withdrawnWei: "0" }
  };
}

function toHex(n) {
  return `0x${n.toString(16)}`;
}

function toTopicAddress(address) {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function parseAddressFromTopic(topic) {
  return `0x${String(topic).slice(-40).toLowerCase()}`;
}

async function rpc(endpoint, method, params = []) {
  const payload = {
    jsonrpc: "2.0",
    method,
    params,
    id: 1
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    const detail = json.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(detail);
  }
  return json.result;
}

async function rpcWithFallback(endpoints, method, params = []) {
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      return await rpc(endpoint, method, params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("rpc_failed");
}

async function getBlockNumber(chain) {
  const blockHex = await rpcWithFallback(chain.rpcs, "eth_blockNumber", []);
  return BigInt(blockHex);
}

async function ethCall(chain, to, data) {
  return rpcWithFallback(chain.rpcs, "eth_call", [{ to, data }, "latest"]);
}

async function tryCallUint(chain, to, selector) {
  try {
    const result = await ethCall(chain, to, selector);
    if (!result || result === "0x") return null;
    return BigInt(result);
  } catch {
    return null;
  }
}

async function balanceOf(chain, wallet) {
  const data = `0x70a08231${wallet.slice(2).padStart(64, "0")}`;
  const result = await ethCall(chain, FT_TOKEN, data);
  return BigInt(result);
}

async function getLogs(chain, filter) {
  return rpcWithFallback(chain.rpcs, "eth_getLogs", [filter]);
}

async function getTxReceipt(chain, txHash) {
  return rpcWithFallback(chain.rpcs, "eth_getTransactionReceipt", [txHash]);
}

function asciiToHex(input) {
  return `0x${Buffer.from(input, "utf8").toString("hex")}`;
}

async function topicForEvent(chain, signature) {
  return rpcWithFallback(chain.rpcs, "web3_sha3", [asciiToHex(signature)]);
}

async function sumPutManagerEventAmounts(chain, topic0, fromBlock, toBlock) {
  if (toBlock < fromBlock) return 0n;
  let total = 0n;
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + chain.chunk < toBlock ? start + chain.chunk : toBlock;
    const logs = await getLogs(chain, {
      address: PUT_MANAGER,
      topics: [topic0],
      fromBlock: toHex(start),
      toBlock: toHex(end)
    });
    for (const log of logs) {
      total += BigInt(log.data || "0x0");
    }
    start = end + 1n;
  }
  return total;
}

async function updateFtAllocatedFromEvents(ethChain, latestBlock, state) {
  const prev = state.ftAlloc || defaultState().ftAlloc;
  const prevBlock = BigInt(prev.lastBlock);
  const fromBlock =
    prevBlock >= 0n
      ? prevBlock + 1n
      : latestBlock > ethChain.lookback
        ? latestBlock - ethChain.lookback
        : 0n;

  let invested = BigInt(prev.investedWei || "0");
  let divested = BigInt(prev.divestedWei || "0");
  let withdrawn = BigInt(prev.withdrawnWei || "0");

  if (fromBlock <= latestBlock) {
    const investedTopic = await topicForEvent(ethChain, "Invested(uint256)");
    const divestedTopic = await topicForEvent(ethChain, "Divested(uint256)");
    const withdrawnTopic = await topicForEvent(ethChain, "Withdraw(uint256)");

    invested += await sumPutManagerEventAmounts(ethChain, investedTopic, fromBlock, latestBlock);
    divested += await sumPutManagerEventAmounts(ethChain, divestedTopic, fromBlock, latestBlock);
    withdrawn += await sumPutManagerEventAmounts(ethChain, withdrawnTopic, fromBlock, latestBlock);
  }

  state.ftAlloc = {
    lastBlock: latestBlock.toString(),
    investedWei: invested.toString(),
    divestedWei: divested.toString(),
    withdrawnWei: withdrawn.toString()
  };

  const allocated = invested - divested - withdrawn;
  return allocated > 0n ? allocated : 0n;
}

async function updateBurnedForChain(chain, latestBlock, state) {
  const prev = state.chains[chain.key] || { lastBurnBlock: "-1", burnedWei: "0" };
  const prevBlock = BigInt(prev.lastBurnBlock);
  const fromBlock =
    prevBlock >= 0n
      ? prevBlock + 1n
      : latestBlock > chain.lookback
        ? latestBlock - chain.lookback
        : 0n;

  if (fromBlock > latestBlock) {
    return { burnedWei: BigInt(prev.burnedWei), lastBurnBlock: prevBlock };
  }

  let burnedDelta = 0n;
  let start = fromBlock;
  while (start <= latestBlock) {
    const end = start + chain.chunk < latestBlock ? start + chain.chunk : latestBlock;
    try {
      const logs = await getLogs(chain, {
        address: FT_TOKEN,
        topics: [TRANSFER_TOPIC, null, toTopicAddress(ZERO)],
        fromBlock: toHex(start),
        toBlock: toHex(end)
      });

      // Exclude OFT bridge burns by dropping txs that emit any non-Transfer FT log.
      const byTx = new Map();
      for (const log of logs) {
        const txHash = String(log.transactionHash || "").toLowerCase();
        if (!txHash) continue;
        if (!byTx.has(txHash)) byTx.set(txHash, []);
        byTx.get(txHash).push(log);
      }

      for (const [txHash, txLogs] of byTx.entries()) {
        const receipt = await getTxReceipt(chain, txHash);
        const hasNonTransferFtLog = (receipt?.logs || []).some((l) => {
          if (String(l.address || "").toLowerCase() !== FT_TOKEN) return false;
          const topic0 = String(l.topics?.[0] || "").toLowerCase();
          return topic0 && topic0 !== TRANSFER_TOPIC;
        });
        if (hasNonTransferFtLog) continue;

        for (const log of txLogs) {
          burnedDelta += BigInt(log.data || "0x0");
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (msg.includes("pruned") && prevBlock < 0n) {
        // Skip old pruned range on first run and continue near latest.
        start = latestBlock > chain.chunk ? latestBlock - chain.chunk : 0n;
        continue;
      }
      throw error;
    }
    start = end + 1n;
  }

  const nextBurned = BigInt(prev.burnedWei) + burnedDelta;
  state.chains[chain.key] = {
    ...prev,
    burnedWei: nextBurned.toString(),
    lastBurnBlock: latestBlock.toString()
  };
  return { burnedWei: nextBurned, lastBurnBlock: latestBlock };
}

async function updateVcAddresses(ethChain, latestBlock, state) {
  const prev = state.vc || { lastBlock: "-1", addresses: [] };
  const prevBlock = BigInt(prev.lastBlock);
  const fromBlock =
    prevBlock >= 0n
      ? prevBlock + 1n
      : latestBlock > ethChain.lookback
        ? latestBlock - ethChain.lookback
        : 0n;

  const known = new Set((prev.addresses || []).map((x) => String(x).toLowerCase()));
  const excluded = new Set([ZERO, PUT_MANAGER, MSIG_WALLET]);

  if (fromBlock <= latestBlock) {
    let start = fromBlock;
    while (start <= latestBlock) {
      const end = start + ethChain.chunk < latestBlock ? start + ethChain.chunk : latestBlock;
      const logs = await getLogs(ethChain, {
        address: FT_TOKEN,
        topics: [TRANSFER_TOPIC, toTopicAddress(MSIG_WALLET)],
        fromBlock: toHex(start),
        toBlock: toHex(end)
      });
      for (const log of logs) {
        const topic = log.topics?.[2];
        if (!topic) continue;
        const to = parseAddressFromTopic(topic);
        if (!excluded.has(to)) known.add(to);
      }
      start = end + 1n;
    }
  }

  const addresses = [...known];
  state.vc = {
    lastBlock: latestBlock.toString(),
    addresses
  };
  return addresses;
}

function sum(values) {
  return values.reduce((a, b) => a + b, 0n);
}

async function main() {
  const state = readJson(STATE_PATH, defaultState());

  const chainRuntime = [];
  for (const chain of CHAINS) {
    const latestBlock = await getBlockNumber(chain);
    const [totalSupply, msigBalance] = await Promise.all([
      ethCall(chain, FT_TOKEN, CALL_DATA.totalSupply).then((x) => BigInt(x)),
      balanceOf(chain, MSIG_WALLET)
    ]);

    const { burnedWei } = await updateBurnedForChain(chain, latestBlock, state);

    chainRuntime.push({
      ...chain,
      latestBlock,
      totalSupply,
      msigBalance,
      burnedWei
    });
  }

  const eth = chainRuntime.find((x) => x.key === "ethereum");
  if (!eth) throw new Error("ethereum_unavailable");

  const decimals = Number(await ethCall(eth, FT_TOKEN, CALL_DATA.decimals).then((x) => BigInt(x)));

  let inPuts = 0n;
  let allocatedSource = "events-unavailable";
  try {
    inPuts = await updateFtAllocatedFromEvents(eth, eth.latestBlock, state);
    allocatedSource = "events-invested-divested-withdraw";
  } catch {
    allocatedSource = "events-unavailable";
  }

  // If event-derived value is zero/unavailable, try direct state read with dynamic selector.
  if (inPuts === 0n) {
    const dynamicSelector = await rpcWithFallback(eth.rpcs, "web3_sha3", [asciiToHex("ftAllocated()")])
      .then((x) => String(x).slice(0, 10))
      .catch(() => null);
    const selectors = [CALL_DATA.ftAllocated, dynamicSelector].filter(Boolean);
    for (const sel of selectors) {
      const v = await tryCallUint(eth, PUT_MANAGER, sel);
      if (v !== null && v > 0n) {
        inPuts = v;
        allocatedSource = "putmanager-ftAllocated-fallback";
        break;
      }
    }
  }

  // Final fallback: ftPUT balance on Ethereum.
  if (inPuts === 0n) {
    try {
      const ftPutBalance = await balanceOf(eth, FT_PUT);
      if (ftPutBalance > 0n) {
        inPuts = ftPutBalance;
        allocatedSource = "ftput-balance-fallback";
      } else if (allocatedSource === "events-unavailable") {
        allocatedSource = "unavailable";
      }
    } catch {
      if (allocatedSource === "events-unavailable") allocatedSource = "unavailable";
    }
  }

  const vcAddresses = await updateVcAddresses(eth, eth.latestBlock, state);
  const vcBalances = await Promise.all(vcAddresses.map((addr) => balanceOf(eth, addr)));
  const institutional = sum(vcBalances);

  const putManagerBalance = await balanceOf(eth, PUT_MANAGER);
  const msigByChain = Object.fromEntries(chainRuntime.map((x) => [x.key, x.msigBalance]));
  const msig = sum(Object.values(msigByChain));

  const onEthereumRaw = eth.totalSupply - putManagerBalance - (msigByChain.ethereum || 0n) - institutional;
  const onEthereum = onEthereumRaw > 0n ? onEthereumRaw : 0n;

  const onSonicRaw = (chainRuntime.find((x) => x.key === "sonic")?.totalSupply || 0n) - (msigByChain.sonic || 0n);
  const onBaseRaw = (chainRuntime.find((x) => x.key === "base")?.totalSupply || 0n) - (msigByChain.base || 0n);
  const onBnbRaw = (chainRuntime.find((x) => x.key === "bnb")?.totalSupply || 0n) - (msigByChain.bnb || 0n);
  const onAvaxRaw = (chainRuntime.find((x) => x.key === "avalanche")?.totalSupply || 0n) - (msigByChain.avalanche || 0n);

  const onSonic = onSonicRaw > 0n ? onSonicRaw : 0n;
  const onBase = onBaseRaw > 0n ? onBaseRaw : 0n;
  const onBnb = onBnbRaw > 0n ? onBnbRaw : 0n;
  const onAvalanche = onAvaxRaw > 0n ? onAvaxRaw : 0n;

  const tradable = onEthereum + onSonic + onBase + onBnb + onAvalanche;
  const unallocatedRaw = putManagerBalance - inPuts;
  const unallocated = unallocatedRaw > 0n ? unallocatedRaw : 0n;
  const nonCirculating = unallocated + msig + institutional;
  const circulating = inPuts + tradable;
  const burned = sum(chainRuntime.map((x) => x.burnedWei));
  const finalSum = burned + circulating + nonCirculating;

  const payload = {
    updatedAt: new Date().toISOString(),
    decimals,
    meta: {
      allocatedSource,
      invariantTargetWei: MAX_SUPPLY_WEI.toString(),
      burnedSource: "event-indexed"
    },
    latestBlocks: Object.fromEntries(chainRuntime.map((x) => [x.key, x.latestBlock.toString()])),
    valuesWei: {
      burned: burned.toString(),
      circulating: circulating.toString(),
      nonCirculating: nonCirculating.toString(),
      inPuts: inPuts.toString(),
      tradable: tradable.toString(),
      unallocated: unallocated.toString(),
      vcMsig: msig.toString(),
      institutional: institutional.toString(),
      onEthereum: onEthereum.toString(),
      onSonic: onSonic.toString(),
      onBnb: onBnb.toString(),
      onAvalanche: onAvalanche.toString(),
      onBase: onBase.toString(),
      finalSum: finalSum.toString()
    }
  };

  writeJson(STATE_PATH, state);
  writeJson(METRICS_PATH, payload);

  // eslint-disable-next-line no-console
  console.log(`Indexed metrics at ${payload.updatedAt}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
