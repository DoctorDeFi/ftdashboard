import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, "data", "puts-state.json");
const OUTPUT_PATH = path.join(ROOT, "public", "data", "puts-marketplace.json");

const ETH_RPC_URL = process.env.ETH_RPC_URL || process.env.ALCHEMY_ETH_RPC_URL || "";
const ETH_RPCS = [
  ...(ETH_RPC_URL ? [ETH_RPC_URL] : []),
  "https://ethereum-rpc.publicnode.com",
  "https://cloudflare-eth.com",
  "https://rpc.flashbots.net"
];
const MARKETPLACE = "0x31248663adccdbcad155555b7717697b76cf570c";
const FT_PUT = "0xa4215daaf3745e14e96e169e0e7706c479ce04f2";
const CHAINLINK_ETH_USD = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
const ZERO = "0x0000000000000000000000000000000000000000";
const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const CHUNK = 25_000n;
const LOOKBACK = 1_000_000n;

const SELECTORS = {
  getListing: "getListing(uint256)",
  puts: "puts(uint256)",
  symbol: "symbol()",
  decimals: "decimals()",
  latestRoundData: "latestRoundData()"
};

const EVENT_SIGS = {
  NewListing: "NewListing(uint256,address,address,uint256,uint40)",
  EditListing: "EditListing(uint256,address,address,uint256,uint40)",
  RemoveListing: "RemoveListing(uint256,address)",
  Sold: "Sold(uint256,address,address,address,uint256,uint256,uint256)",
  BuyOfferAccepted:
    "BuyOfferAccepted(address,address,uint256,address,uint256,uint256,uint256,bytes32)",
  BuyOfferCancelled: "BuyOfferCancelled(address,bytes32)",
  TokenAccepted: "TokenAccepted(address)",
  TokenRemoved: "TokenRemoved(address)",
  FeeRecipientUpdated: "FeeRecipientUpdated(address)",
  MakerFeeUpdated: "MakerFeeUpdated(uint16)",
  TakerFeeUpdated: "TakerFeeUpdated(uint16)",
  EmergencyPaused: "EmergencyPaused(bool)"
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
    lastBlock: "-1",
    listings: {},
    sales: [],
    activity: [],
    holders: {
      lastBlock: "-1",
      tokenOwners: {}
    },
    acceptedTokens: [],
    config: {
      makerFeeBps: null,
      takerFeeBps: null,
      feeRecipient: null,
      emergencyPaused: null
    }
  };
}

async function rpc(method, params = []) {
  const payload = { jsonrpc: "2.0", id: 1, method, params };
  let lastError = null;

  for (const endpoint of ETH_RPCS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
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

  throw lastError instanceof Error ? lastError : new Error("all_rpc_endpoints_failed");
}

function asciiToHex(input) {
  return `0x${Buffer.from(input, "utf8").toString("hex")}`;
}

function toHex(n) {
  return `0x${n.toString(16)}`;
}

function hexToBigInt(hexValue) {
  if (!hexValue || hexValue === "0x") return 0n;
  return BigInt(hexValue);
}

function wordAt(hexValue, index) {
  const body = String(hexValue || "0x").slice(2);
  const start = index * 64;
  const part = body.slice(start, start + 64);
  if (part.length < 64) return null;
  return `0x${part}`;
}

function addressFromWord(word) {
  if (!word) return null;
  return `0x${word.slice(-40).toLowerCase()}`;
}

function addressFromTopic(topic) {
  return `0x${String(topic || "").slice(-40).toLowerCase()}`;
}

function uintFromWord(word) {
  if (!word) return null;
  return BigInt(word);
}

function countDataWords(hexValue) {
  const body = String(hexValue || "0x").slice(2);
  if (!body) return 0;
  return Math.floor(body.length / 64);
}

function formatUnits(value, decimals = 18) {
  const n = BigInt(value || 0n);
  const d = BigInt(decimals);
  const base = 10n ** d;
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(Number(d), "0").slice(0, 4).replace(/0+$/, "");
  if (!fracStr) return whole.toString();
  return `${whole.toString()}.${fracStr}`;
}

function pushCapped(list, value, max = 1000) {
  list.push(value);
  if (list.length > max) {
    list.splice(0, list.length - max);
  }
}

async function getBlockNumber() {
  return hexToBigInt(await rpc("eth_blockNumber", []));
}

async function getLogsFor(address, fromBlock, toBlock, topic0 = null) {
  const filter = {
    address,
    fromBlock: toHex(fromBlock),
    toBlock: toHex(toBlock)
  };
  if (topic0) filter.topics = [topic0];
  return rpc("eth_getLogs", [filter]);
}

async function getLogs(fromBlock, toBlock, topic0 = null) {
  return getLogsFor(MARKETPLACE, fromBlock, toBlock, topic0);
}

async function ethCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

async function hashTopic(signature) {
  return rpc("web3_sha3", [asciiToHex(signature)]);
}

function encodeUintCall(selectorHex, tokenId) {
  return `${selectorHex}${BigInt(tokenId).toString(16).padStart(64, "0")}`;
}

function decodeListingCall(hexValue) {
  const seller = addressFromWord(wordAt(hexValue, 0));
  const expires = uintFromWord(wordAt(hexValue, 1));
  const token = addressFromWord(wordAt(hexValue, 2));
  const price = uintFromWord(wordAt(hexValue, 3));

  return {
    seller,
    expires: expires ? Number(expires) : null,
    paymentToken: token,
    priceWei: price ? price.toString() : null
  };
}

function decodePutsCall(hexValue) {
  const token = addressFromWord(wordAt(hexValue, 0));
  const amount = uintFromWord(wordAt(hexValue, 1));
  const ft = uintFromWord(wordAt(hexValue, 2));
  const ftBought = uintFromWord(wordAt(hexValue, 3));
  const withdrawn = uintFromWord(wordAt(hexValue, 4));
  const burned = uintFromWord(wordAt(hexValue, 5));
  const strike = uintFromWord(wordAt(hexValue, 6));
  const amountRemaining = uintFromWord(wordAt(hexValue, 7));
  const ftPerUsd = uintFromWord(wordAt(hexValue, 8));

  return {
    collateralToken: token,
    amountWei: amount?.toString() || null,
    ftWei: ft?.toString() || null,
    ftBoughtWei: ftBought?.toString() || null,
    withdrawnWei: withdrawn?.toString() || null,
    burnedWei: burned?.toString() || null,
    strikeWei: strike?.toString() || null,
    amountRemainingWei: amountRemaining?.toString() || null,
    ftPerUsdWei: ftPerUsd?.toString() || null
  };
}

function decodeLatestRoundData(hexValue) {
  const answer = uintFromWord(wordAt(hexValue, 1));
  const updatedAt = uintFromWord(wordAt(hexValue, 3));
  return {
    answer: answer ? answer.toString() : null,
    updatedAt: updatedAt ? Number(updatedAt) : null
  };
}

function decodeDynamicString(hexValue) {
  const body = String(hexValue || "").slice(2);
  if (!body || body.length < 128) return null;
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  const start = offset * 2;
  const len = Number(BigInt(`0x${body.slice(start, start + 64)}`));
  const dataStart = start + 64;
  const dataHex = body.slice(dataStart, dataStart + len * 2);
  try {
    return Buffer.from(dataHex, "hex").toString("utf8").replace(/\0+$/, "").trim() || null;
  } catch {
    return null;
  }
}

async function getErc20Meta(address, selectorCache, metaCache) {
  const key = String(address || "").toLowerCase();
  if (!key || key === "0x0000000000000000000000000000000000000000") {
    return { symbol: "ETH", decimals: 18 };
  }
  if (metaCache[key]) return metaCache[key];

  const symbolSel = selectorCache.symbol;
  const decimalsSel = selectorCache.decimals;

  let symbol = null;
  let decimals = 18;

  try {
    const rawSymbol = await ethCall(key, symbolSel);
    symbol = decodeDynamicString(rawSymbol);
    if (!symbol && rawSymbol && rawSymbol !== "0x") {
      const w = wordAt(rawSymbol, 0);
      if (w) {
        try {
          symbol = Buffer.from(w.slice(2), "hex").toString("utf8").replace(/\0+$/, "").trim() || null;
        } catch {
          symbol = null;
        }
      }
    }
  } catch {
    symbol = null;
  }

  try {
    const rawDecimals = await ethCall(key, decimalsSel);
    const d = uintFromWord(wordAt(rawDecimals, 0));
    if (d !== null && d <= 255n) decimals = Number(d);
  } catch {
    decimals = 18;
  }

  const meta = { symbol: symbol || key.slice(0, 6), decimals };
  metaCache[key] = meta;
  return meta;
}

function applyLog(state, log, topicsByHash) {
  const topic0 = String(log.topics?.[0] || "").toLowerCase();
  const txHash = String(log.transactionHash || "").toLowerCase();
  const blockNumber = Number(hexToBigInt(log.blockNumber));
  const logIndex = Number(hexToBigInt(log.logIndex));
  const tokenId = log.topics?.[1] ? uintFromWord(log.topics[1]) : null;
  const seller = log.topics?.[2] ? addressFromTopic(log.topics[2]) : null;

  const eventName = topicsByHash[topic0] || "Unknown";
  const dataWords = countDataWords(log.data);

  const activityRow = {
    event: eventName,
    txHash,
    blockNumber,
    logIndex,
    tokenId: tokenId ? tokenId.toString() : null,
    seller,
    atUnix: null,
    details: {
      topic0,
      topicsCount: Array.isArray(log.topics) ? log.topics.length : 0,
      dataWords
    }
  };

  if (eventName === "NewListing" || eventName === "EditListing") {
    const paymentToken = addressFromWord(wordAt(log.data, 0));
    const price = uintFromWord(wordAt(log.data, 1));
    const expires = uintFromWord(wordAt(log.data, 2));

    if (tokenId) {
      const id = tokenId.toString();
      const prev = state.listings[id] || { tokenId: id };
      state.listings[id] = {
        ...prev,
        tokenId: id,
        seller,
        paymentToken,
        priceWei: price ? price.toString() : prev.priceWei || null,
        expires: expires ? Number(expires) : prev.expires || null,
        status: "active",
        lastAction: eventName,
        lastTxHash: txHash,
        lastBlockNumber: blockNumber,
        lastLogIndex: logIndex
      };
    }

    activityRow.details = {
      paymentToken,
      priceWei: price ? price.toString() : null,
      expires: expires ? Number(expires) : null
    };
  } else if (eventName === "RemoveListing") {
    if (tokenId) {
      const id = tokenId.toString();
      if (state.listings[id]) {
        state.listings[id].status = "removed";
        state.listings[id].lastAction = "RemoveListing";
        state.listings[id].lastTxHash = txHash;
        state.listings[id].lastBlockNumber = blockNumber;
        state.listings[id].lastLogIndex = logIndex;
      }
    }
  } else if (eventName === "Sold") {
    const buyer = addressFromWord(wordAt(log.data, 0));
    const paymentToken = addressFromWord(wordAt(log.data, 1));
    const price = uintFromWord(wordAt(log.data, 2));
    const makerFee = uintFromWord(wordAt(log.data, 3));
    const takerFee = uintFromWord(wordAt(log.data, 4));

    if (tokenId) {
      const id = tokenId.toString();
      if (state.listings[id]) {
        state.listings[id].status = "sold";
        state.listings[id].lastAction = "Sold";
        state.listings[id].lastTxHash = txHash;
        state.listings[id].lastBlockNumber = blockNumber;
        state.listings[id].lastLogIndex = logIndex;
      }
    }

    pushCapped(state.sales, {
      type: "sold",
      txHash,
      blockNumber,
      tokenId: tokenId ? tokenId.toString() : null,
      seller,
      buyer,
      paymentToken,
      priceWei: price ? price.toString() : null,
      makerFeeWei: makerFee ? makerFee.toString() : null,
      takerFeeWei: takerFee ? takerFee.toString() : null
    });

    activityRow.details = {
      buyer,
      paymentToken,
      priceWei: price ? price.toString() : null
    };
  } else if (eventName === "BuyOfferAccepted") {
    const buyer = addressFromTopic(log.topics?.[1]);
    const indexedSeller = addressFromTopic(log.topics?.[2]);
    const indexedTokenId = uintFromWord(log.topics?.[3]);
    const paymentToken = addressFromWord(wordAt(log.data, 0));
    const price = uintFromWord(wordAt(log.data, 1));
    const makerFee = uintFromWord(wordAt(log.data, 2));
    const takerFee = uintFromWord(wordAt(log.data, 3));
    const offerHash = wordAt(log.data, 4);

    if (indexedTokenId) {
      const id = indexedTokenId.toString();
      if (state.listings[id]) {
        state.listings[id].status = "offer-accepted";
        state.listings[id].lastAction = "BuyOfferAccepted";
        state.listings[id].lastTxHash = txHash;
        state.listings[id].lastBlockNumber = blockNumber;
        state.listings[id].lastLogIndex = logIndex;
      }
    }

    pushCapped(state.sales, {
      type: "offer-accepted",
      txHash,
      blockNumber,
      tokenId: indexedTokenId ? indexedTokenId.toString() : null,
      seller: indexedSeller,
      buyer,
      paymentToken,
      priceWei: price ? price.toString() : null,
      makerFeeWei: makerFee ? makerFee.toString() : null,
      takerFeeWei: takerFee ? takerFee.toString() : null,
      offerHash
    });

    activityRow.tokenId = indexedTokenId ? indexedTokenId.toString() : null;
    activityRow.seller = indexedSeller;
    activityRow.details = {
      buyer,
      paymentToken,
      priceWei: price ? price.toString() : null,
      offerHash
    };
  } else if (eventName === "BuyOfferCancelled") {
    const buyer = addressFromTopic(log.topics?.[1]);
    const offerHash = String(log.topics?.[2] || "").toLowerCase();
    activityRow.details = { buyer, offerHash };
  } else if (eventName === "TokenAccepted") {
    const token = addressFromTopic(log.topics?.[1]);
    state.acceptedTokens = Array.from(new Set([...state.acceptedTokens, token]));
    activityRow.details = { token };
  } else if (eventName === "TokenRemoved") {
    const token = addressFromTopic(log.topics?.[1]);
    state.acceptedTokens = state.acceptedTokens.filter((x) => x.toLowerCase() !== token);
    activityRow.details = { token };
  } else if (eventName === "FeeRecipientUpdated") {
    const feeRecipient = addressFromWord(wordAt(log.data, 0));
    state.config.feeRecipient = feeRecipient;
    activityRow.details = { feeRecipient };
  } else if (eventName === "MakerFeeUpdated") {
    const fee = uintFromWord(wordAt(log.data, 0));
    state.config.makerFeeBps = fee !== null ? Number(fee) : null;
    activityRow.details = { makerFeeBps: state.config.makerFeeBps };
  } else if (eventName === "TakerFeeUpdated") {
    const fee = uintFromWord(wordAt(log.data, 0));
    state.config.takerFeeBps = fee !== null ? Number(fee) : null;
    activityRow.details = { takerFeeBps: state.config.takerFeeBps };
  } else if (eventName === "EmergencyPaused") {
    const paused = uintFromWord(wordAt(log.data, 0));
    state.config.emergencyPaused = paused === 1n;
    activityRow.details = { emergencyPaused: state.config.emergencyPaused };
  } else if (eventName === "Unknown") {
    // Heuristic fallback for marketplace versions with changed event signatures.
    const paymentToken = addressFromWord(wordAt(log.data, 0));
    const price = uintFromWord(wordAt(log.data, 1));
    const third = uintFromWord(wordAt(log.data, 2));
    const fourth = uintFromWord(wordAt(log.data, 3));
    const maybeBuyer = log.topics?.[3] ? addressFromTopic(log.topics[3]) : null;
    const buyerFromWord0 = addressFromWord(wordAt(log.data, 0));
    const priceFromWord1 = uintFromWord(wordAt(log.data, 1));
    const makerFeeFromWord2 = uintFromWord(wordAt(log.data, 2));
    const takerFeeFromWord3 = uintFromWord(wordAt(log.data, 3));

    const looksLikeListingUpsert =
      tokenId !== null &&
      seller &&
      paymentToken &&
      paymentToken !== "0x0000000000000000000000000000000000000000" &&
      price !== null &&
      price > 0n &&
      third !== null &&
      third > 1_600_000_000n &&
      third < 6_000_000_000n;

    if (looksLikeListingUpsert) {
      const id = tokenId.toString();
      const prev = state.listings[id] || { tokenId: id };
      state.listings[id] = {
        ...prev,
        tokenId: id,
        seller,
        paymentToken,
        priceWei: price.toString(),
        expires: Number(third),
        status: "active",
        lastAction: "ListingUpdate(heuristic)",
        lastTxHash: txHash,
        lastBlockNumber: blockNumber,
        lastLogIndex: logIndex
      };
      activityRow.event = "ListingUpdate(heuristic)";
      activityRow.details = {
        ...activityRow.details,
        paymentToken,
        priceWei: price.toString(),
        expires: Number(third)
      };
    } else {
      // Observed shape on FT marketplace: topics=3 (tokenId, seller), dataWords=4
      // with buyer/payment/price/fee in data.
      const looksLikeSaleV2 =
        tokenId !== null &&
        seller &&
        dataWords === 4 &&
        buyerFromWord0 &&
        priceFromWord1 !== null &&
        priceFromWord1 > 0n;

      if (looksLikeSaleV2) {
        const id = tokenId.toString();
        const listingPaymentToken = String(state.listings[id]?.paymentToken || "").toLowerCase();
        const paymentTokenResolved =
          listingPaymentToken && listingPaymentToken !== ZERO ? listingPaymentToken : null;
        if (state.listings[id]) {
          state.listings[id].status = "sold";
          state.listings[id].lastAction = "Sold(heuristic-v2)";
          state.listings[id].lastTxHash = txHash;
          state.listings[id].lastBlockNumber = blockNumber;
          state.listings[id].lastLogIndex = logIndex;
        }

        pushCapped(state.sales, {
          type: "sold-heuristic-v2",
          txHash,
          blockNumber,
          tokenId: id,
          seller,
          buyer: buyerFromWord0,
          paymentToken: paymentTokenResolved,
          priceWei: priceFromWord1.toString(),
          makerFeeWei: makerFeeFromWord2 ? makerFeeFromWord2.toString() : null,
          takerFeeWei: takerFeeFromWord3 ? takerFeeFromWord3.toString() : null
        });

        activityRow.event = "Sold(heuristic-v2)";
        activityRow.details = {
          ...activityRow.details,
          buyer: buyerFromWord0,
          paymentToken: paymentTokenResolved,
          priceWei: priceFromWord1.toString(),
          makerFeeWei: makerFeeFromWord2 ? makerFeeFromWord2.toString() : null,
          takerFeeWei: takerFeeFromWord3 ? takerFeeFromWord3.toString() : null
        };
      }

      const looksLikeSaleLike =
        tokenId !== null &&
        seller &&
        maybeBuyer &&
        paymentToken &&
        paymentToken !== "0x0000000000000000000000000000000000000000" &&
        price !== null &&
        price > 0n &&
        third !== null &&
        fourth !== null &&
        dataWords >= 4;

      if (!looksLikeSaleV2 && looksLikeSaleLike) {
        const id = tokenId.toString();
        if (state.listings[id]) {
          state.listings[id].status = "sold";
          state.listings[id].lastAction = "Sold(heuristic)";
          state.listings[id].lastTxHash = txHash;
          state.listings[id].lastBlockNumber = blockNumber;
          state.listings[id].lastLogIndex = logIndex;
        }

        pushCapped(state.sales, {
          type: "sold-heuristic",
          txHash,
          blockNumber,
          tokenId: id,
          seller,
          buyer: maybeBuyer,
          paymentToken,
          priceWei: price.toString(),
          makerFeeWei: third.toString(),
          takerFeeWei: fourth.toString()
        });

        activityRow.event = "Sold(heuristic)";
        activityRow.details = {
          ...activityRow.details,
          buyer: maybeBuyer,
          paymentToken,
          priceWei: price.toString()
        };
      }
    }
  }

  pushCapped(state.activity, activityRow, 2500);
}

function sortLogs(logs) {
  return logs.sort((a, b) => {
    const blockA = Number(hexToBigInt(a.blockNumber));
    const blockB = Number(hexToBigInt(b.blockNumber));
    if (blockA !== blockB) return blockA - blockB;
    const idxA = Number(hexToBigInt(a.logIndex));
    const idxB = Number(hexToBigInt(b.logIndex));
    return idxA - idxB;
  });
}

function normalizeHoldersState(state) {
  if (!state.holders || typeof state.holders !== "object") {
    state.holders = { lastBlock: "-1", tokenOwners: {} };
    return;
  }
  if (typeof state.holders.lastBlock !== "string") state.holders.lastBlock = "-1";
  if (!state.holders.tokenOwners || typeof state.holders.tokenOwners !== "object") {
    state.holders.tokenOwners = {};
  }
}

async function updateTokenOwnersFromTransfers(state, latestBlock) {
  normalizeHoldersState(state);
  const prevBlock = BigInt(state.holders.lastBlock || "-1");
  const fromBlock = prevBlock >= 0n ? prevBlock + 1n : 0n;
  if (fromBlock > latestBlock) return;

  let start = fromBlock;
  while (start <= latestBlock) {
    const end = start + CHUNK < latestBlock ? start + CHUNK : latestBlock;
    const logs = await getLogsFor(FT_PUT, start, end, ERC721_TRANSFER_TOPIC);
    const sorted = sortLogs(logs || []);
    for (const log of sorted) {
      const from = addressFromTopic(log.topics?.[1]);
      const to = addressFromTopic(log.topics?.[2]);
      const tokenId = uintFromWord(log.topics?.[3]);
      if (tokenId === null) continue;
      const id = tokenId.toString();
      if (!to || to === ZERO) {
        delete state.holders.tokenOwners[id];
      } else {
        state.holders.tokenOwners[id] = to.toLowerCase();
      }
      if (from && from !== ZERO) {
        // no-op; ownership map is tokenId->owner
      }
    }
    start = end + 1n;
  }
  state.holders.lastBlock = latestBlock.toString();
}

function aggregateOwners(tokenOwners) {
  const byHolder = new Map();
  for (const [tokenId, owner] of Object.entries(tokenOwners || {})) {
    const addr = String(owner || "").toLowerCase();
    if (!addr || addr === ZERO) continue;
    if (!byHolder.has(addr)) byHolder.set(addr, []);
    byHolder.get(addr).push(tokenId);
  }
  return [...byHolder.entries()].map(([address, tokenIds]) => ({
    address,
    tokenIds,
    putCount: tokenIds.length
  }));
}

async function getUnixForBlock(blockNumber, cache) {
  const key = String(blockNumber);
  if (cache[key] !== undefined) return cache[key];
  try {
    const block = await rpc("eth_getBlockByNumber", [toHex(BigInt(blockNumber)), false]);
    const ts = block?.timestamp ? Number(hexToBigInt(block.timestamp)) : null;
    cache[key] = ts;
    return ts;
  } catch {
    cache[key] = null;
    return null;
  }
}

async function main() {
  const reset = process.argv.includes("--reset") || process.env.RESET_PUTS_INDEX === "1";
  const state = reset ? defaultState() : readJson(STATE_PATH, defaultState());
  if (reset) {
    // eslint-disable-next-line no-console
    console.log("[puts-index] reset mode enabled; rebuilding state from scratch");
  }

  const topicPairs = await Promise.all(
    Object.entries(EVENT_SIGS).map(async ([name, sig]) => [name, (await hashTopic(sig)).toLowerCase()])
  );

  const topicsByName = Object.fromEntries(topicPairs);
  const topicsByHash = Object.fromEntries(topicPairs.map(([name, hash]) => [hash, name]));

  const selectorPairs = await Promise.all(
    Object.entries(SELECTORS).map(async ([name, sig]) => [name, String(await hashTopic(sig)).slice(0, 10)])
  );
  const selectors = Object.fromEntries(selectorPairs);
  let oracle = {
    ethUsd: null,
    ethUsdDisplay: null,
    ethUsdDecimals: null,
    updatedAt: null,
    source: CHAINLINK_ETH_USD
  };

  try {
    const rawDec = await ethCall(CHAINLINK_ETH_USD, selectors.decimals);
    const dec = uintFromWord(wordAt(rawDec, 0));
    const rawRound = await ethCall(CHAINLINK_ETH_USD, selectors.latestRoundData);
    const round = decodeLatestRoundData(rawRound);
    const decimals = dec !== null ? Number(dec) : 8;
    oracle = {
      ethUsd: round.answer,
      ethUsdDisplay: round.answer ? formatUnits(round.answer, decimals) : null,
      ethUsdDecimals: decimals,
      updatedAt: round.updatedAt,
      source: CHAINLINK_ETH_USD
    };
    // eslint-disable-next-line no-console
    console.log(`[puts-index] oracle ETH/USD=${oracle.ethUsdDisplay || "n/a"} (chainlink)`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(
      `[puts-index] oracle unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const latestBlock = await getBlockNumber();
  const prevBlock = BigInt(state.lastBlock || "-1");
  const fromBlock =
    prevBlock >= 0n
      ? prevBlock + 1n
      : latestBlock > LOOKBACK
        ? latestBlock - LOOKBACK
        : 0n;

  let scannedLogs = 0;
  // eslint-disable-next-line no-console
  console.log(
    `[puts-index] start from=${fromBlock.toString()} to=${latestBlock.toString()} prev=${prevBlock.toString()}`
  );

  if (fromBlock <= latestBlock) {
    let start = fromBlock;
    let chunkNum = 0;
    while (start <= latestBlock) {
      chunkNum += 1;
      const end = start + CHUNK < latestBlock ? start + CHUNK : latestBlock;
      // eslint-disable-next-line no-console
      console.log(
        `[puts-index] chunk=${chunkNum} range=${start.toString()}-${end.toString()}`
      );
      const logs = await getLogs(start, end, null);
      const sorted = sortLogs(logs || []);
      scannedLogs += sorted.length;
      // eslint-disable-next-line no-console
      console.log(`[puts-index] chunk=${chunkNum} logs=${sorted.length}`);
      for (const log of sorted) {
        applyLog(state, log, topicsByHash);
      }
      start = end + 1n;
    }
  }

  state.lastBlock = latestBlock.toString();
  await updateTokenOwnersFromTransfers(state, latestBlock);
  // eslint-disable-next-line no-console
  console.log("[puts-index] event scan complete; building listing snapshots...");

  const allListings = Object.values(state.listings || {});
  const nowUnix = Math.floor(Date.now() / 1000);

  const activeListings = allListings
    .filter((x) => x.status === "active")
    .map((x) => ({
      ...x,
      derivedStatus: typeof x.expires === "number" && x.expires < nowUnix ? "expired" : "active"
    }));

  const tokenAddresses = new Set();
  for (const row of activeListings) {
    if (row.paymentToken) tokenAddresses.add(row.paymentToken.toLowerCase());
  }
  for (const token of state.acceptedTokens || []) {
    if (token) tokenAddresses.add(token.toLowerCase());
  }

  const blockTimeCache = {};
  const tokenMetaCache = {};

  // Avoid resolving timestamps for full history every run.
  // We only resolve timestamps for rows that are emitted in "recent" views below.

  for (const token of tokenAddresses) {
    await getErc20Meta(token, selectors, tokenMetaCache);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[puts-index] token metadata loaded count=${tokenAddresses.size}; enriching active listings=${activeListings.length}`
  );

  const enrichedActive = [];
  let enrichedCount = 0;
  for (const listing of activeListings) {
    const tokenId = listing.tokenId;
    const getListingData = encodeUintCall(selectors.getListing, tokenId);
    const listingOnchain = decodeListingCall(await ethCall(MARKETPLACE, getListingData));

    const putsData = encodeUintCall(selectors.puts, tokenId);
    const put = decodePutsCall(await ethCall(FT_PUT, putsData));

    const paymentMeta = await getErc20Meta(listingOnchain.paymentToken || listing.paymentToken, selectors, tokenMetaCache);
    const collateralMeta = await getErc20Meta(put.collateralToken, selectors, tokenMetaCache);

    const priceWei = listingOnchain.priceWei || listing.priceWei;
    const liveSeller = String(listingOnchain.seller || listing.seller || "").toLowerCase();
    if (!liveSeller || liveSeller === ZERO) {
      continue;
    }

    enrichedActive.push({
      ...listing,
      seller: liveSeller,
      paymentToken: listingOnchain.paymentToken || listing.paymentToken,
      paymentTokenMeta: paymentMeta,
      priceWei,
      priceDisplay: priceWei ? formatUnits(priceWei, paymentMeta.decimals) : null,
      expires: listingOnchain.expires || listing.expires || null,
      put: {
        ...put,
        collateralMeta,
        amountDisplay: put.amountWei ? formatUnits(put.amountWei, collateralMeta.decimals) : null,
        amountRemainingDisplay: put.amountRemainingWei
          ? formatUnits(put.amountRemainingWei, collateralMeta.decimals)
          : null,
        ftDisplay: put.ftWei ? formatUnits(put.ftWei, 18) : null,
        strikeDisplay: put.strikeWei ? formatUnits(put.strikeWei, 18) : null
      }
    });
    enrichedCount += 1;
    if (enrichedCount % 20 === 0 || enrichedCount === activeListings.length) {
      // eslint-disable-next-line no-console
      console.log(
        `[puts-index] enriched ${enrichedCount}/${activeListings.length} active listings`
      );
    }
  }

  enrichedActive.sort((a, b) => {
    const priceA = a.priceWei ? BigInt(a.priceWei) : 10n ** 40n;
    const priceB = b.priceWei ? BigInt(b.priceWei) : 10n ** 40n;
    if (priceA !== priceB) return priceA < priceB ? -1 : 1;
    const expA = Number(a.expires || Number.MAX_SAFE_INTEGER);
    const expB = Number(b.expires || Number.MAX_SAFE_INTEGER);
    if (expA !== expB) return expA - expB;
    return String(a.tokenId).localeCompare(String(b.tokenId));
  });

  // eslint-disable-next-line no-console
  console.log(`[puts-index] building recent sales from total=${state.sales.length}`);
  const salesRecent = [...state.sales]
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber;
      return String(b.txHash).localeCompare(String(a.txHash));
    })
    .slice(0, 200)
    .map(async (row) => {
      if (row.atUnix === undefined || row.atUnix === null) {
        row.atUnix = await getUnixForBlock(row.blockNumber, blockTimeCache);
      }
      const meta = tokenMetaCache[String(row.paymentToken || "").toLowerCase()] || { symbol: "TOKEN", decimals: 18 };
      return {
        ...row,
        paymentTokenMeta: meta,
        priceDisplay: row.priceWei ? formatUnits(row.priceWei, meta.decimals) : null,
        makerFeeDisplay: row.makerFeeWei ? formatUnits(row.makerFeeWei, meta.decimals) : null,
        takerFeeDisplay: row.takerFeeWei ? formatUnits(row.takerFeeWei, meta.decimals) : null
      };
    });
  const salesRecentResolved = await Promise.all(salesRecent);

  // eslint-disable-next-line no-console
  console.log(`[puts-index] building recent activity from total=${state.activity.length}`);
  const activityRecent = [...state.activity]
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber;
      return b.logIndex - a.logIndex;
    })
    .slice(0, 300)
    .map(async (row) => {
      if (row.atUnix === undefined || row.atUnix === null) {
        row.atUnix = await getUnixForBlock(row.blockNumber, blockTimeCache);
      }
      return row;
    });
  const activityRecentResolved = await Promise.all(activityRecent);

  const holdersAll = aggregateOwners(state.holders?.tokenOwners || {});
  const holdersResolved = [];
  const ethUsdAnswer = oracle.ethUsd ? BigInt(oracle.ethUsd) : null;
  const ethUsdDecimals = Number(oracle.ethUsdDecimals ?? 8);
  const usdScale = 10n ** 18n;

  for (const holder of holdersAll) {
    let usdcWei = 0n;
    let usdtWei = 0n;
    let wethWei = 0n;
    let totalUsdWei = 0n;

    for (const tokenId of holder.tokenIds) {
      try {
        const putsData = encodeUintCall(selectors.puts, tokenId);
        const put = decodePutsCall(await ethCall(FT_PUT, putsData));
        const collateralToken = String(put.collateralToken || "").toLowerCase();
        const collateralMeta = await getErc20Meta(collateralToken, selectors, tokenMetaCache);
        const amountRemainingWei = BigInt(put.amountRemainingWei || "0");
        if (amountRemainingWei <= 0n) continue;

        const symbol = String(collateralMeta.symbol || "").toUpperCase();
        const decimals = Number(collateralMeta.decimals ?? 18);

        if (symbol === "USDC") {
          usdcWei += amountRemainingWei;
          totalUsdWei += (amountRemainingWei * usdScale) / 10n ** BigInt(decimals);
        } else if (symbol === "USDT") {
          usdtWei += amountRemainingWei;
          totalUsdWei += (amountRemainingWei * usdScale) / 10n ** BigInt(decimals);
        } else if (symbol === "WETH" || symbol === "ETH") {
          wethWei += amountRemainingWei;
          if (ethUsdAnswer && ethUsdAnswer > 0n) {
            const usd = (amountRemainingWei * ethUsdAnswer * usdScale) /
              (10n ** BigInt(decimals) * 10n ** BigInt(ethUsdDecimals));
            totalUsdWei += usd;
          }
        }
      } catch {
        // Skip tokens that fail puts() read.
      }
    }

    holdersResolved.push({
      address: holder.address,
      putCount: holder.putCount,
      usdcWei: usdcWei.toString(),
      usdtWei: usdtWei.toString(),
      wethWei: wethWei.toString(),
      usdcDisplay: formatUnits(usdcWei, 6),
      usdtDisplay: formatUnits(usdtWei, 6),
      wethDisplay: formatUnits(wethWei, 18),
      totalUsdWei: totalUsdWei.toString(),
      totalUsdDisplay: formatUnits(totalUsdWei, 18)
    });
  }

  holdersResolved.sort((a, b) => {
    const usdA = BigInt(a.totalUsdWei || "0");
    const usdB = BigInt(b.totalUsdWei || "0");
    if (usdA !== usdB) return usdA > usdB ? -1 : 1;
    if ((a.putCount || 0) !== (b.putCount || 0)) return (b.putCount || 0) - (a.putCount || 0);
    return String(a.address || "").localeCompare(String(b.address || ""));
  });
  const holdersTopResolved = holdersResolved.slice(0, 50);

  const activeCount = enrichedActive.filter((x) => x.derivedStatus === "active").length;
  const expiredCount = enrichedActive.filter((x) => x.derivedStatus === "expired").length;

  const output = {
    source: {
      chain: "ethereum",
      rpc: ETH_RPCS,
      marketplace: MARKETPLACE,
      ftPut: FT_PUT,
      indexedThroughBlock: latestBlock.toString()
    },
    updatedAt: new Date().toISOString(),
    stats: {
      activeListings: activeCount,
      expiredListings: expiredCount,
      totalTrackedListings: allListings.length,
      totalSalesTracked: state.sales.length,
      acceptedTokens: state.acceptedTokens.length,
      scannedLogsInRun: scannedLogs
    },
    config: state.config,
    oracle,
    acceptedTokens: state.acceptedTokens.map((address) => ({
      address,
      ...(tokenMetaCache[address.toLowerCase()] || { symbol: "TOKEN", decimals: 18 })
    })),
    listingsActive: enrichedActive,
    salesRecent: salesRecentResolved,
    activityRecent: activityRecentResolved,
    holdersTop50: holdersTopResolved
  };

  writeJson(STATE_PATH, state);
  // eslint-disable-next-line no-console
  console.log("[puts-index] wrote incremental state");
  writeJson(OUTPUT_PATH, output);

  // eslint-disable-next-line no-console
  console.log(
    `[puts-index] done. block=${latestBlock.toString()} active=${activeCount} sales=${state.sales.length} logs=${scannedLogs}`
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[puts-index] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
