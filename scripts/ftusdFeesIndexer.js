import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "public", "data", "ftusd-fees.json");
const API_URL = "https://api.flyingtulip.com/status/ftusd/dashboard?days=360&include_series=true&include_events=true";

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sumBigInt(items, key) {
  return items.reduce((acc, item) => acc + BigInt(item?.[key] || "0"), 0n);
}

function formatUnits6(v, frac = 6) {
  const n = BigInt(v || 0n);
  const base = 1_000_000n;
  const whole = n / base;
  const rest = n % base;
  const restStr = rest.toString().padStart(6, "0").slice(0, frac).replace(/0+$/, "");
  return restStr ? `${whole.toString()}.${restStr}` : whole.toString();
}

function toNumber6(v) {
  return Number(v) / 1e6;
}

function feePct(fee, amount) {
  if (amount <= 0n) return "0";
  const pct = Number((fee * 1_000_000n) / amount) / 10_000;
  return pct.toFixed(4);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: { "content-type": "application/json" }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ftusd_fees_fetch_failed status=${res.status} body=${body.slice(0, 160)}`);
  }
  return res.json();
}

function buildOutput(payload) {
  const chains = [];
  let totalMintAmount = 0n;
  let totalMintFee = 0n;
  let totalRedeemAmount = 0n;
  let totalRedeemFee = 0n;
  let minTs = null;
  let maxTs = null;
  const dailyMap = new Map();

  for (const chain of payload.chains || []) {
    const events = Array.isArray(chain.events) ? chain.events : [];
    const mintEvents = events.filter((e) => e?.eventType === "mint");
    const redeemEvents = events.filter((e) => e?.eventType === "redeem");

    const mintAmount = sumBigInt(mintEvents, "amount");
    const mintFee = sumBigInt(mintEvents, "feeAmount");
    const redeemAmount = sumBigInt(redeemEvents, "amount");
    const redeemFee = sumBigInt(redeemEvents, "feeAmount");

    totalMintAmount += mintAmount;
    totalMintFee += mintFee;
    totalRedeemAmount += redeemAmount;
    totalRedeemFee += redeemFee;

    const tsValues = events.map((e) => Number(e?.timestamp || 0)).filter(Boolean);
    const chainMinTs = tsValues.length ? Math.min(...tsValues) : null;
    const chainMaxTs = tsValues.length ? Math.max(...tsValues) : null;
    if (chainMinTs && (!minTs || chainMinTs < minTs)) minTs = chainMinTs;
    if (chainMaxTs && (!maxTs || chainMaxTs > maxTs)) maxTs = chainMaxTs;

    for (const ev of [...mintEvents, ...redeemEvents]) {
      const ts = Number(ev?.timestamp || 0);
      if (!ts) continue;
      const day = new Date(ts * 1000).toISOString().slice(0, 10);
      if (!dailyMap.has(day)) dailyMap.set(day, { day, mintFeeWei6: 0n, redeemFeeWei6: 0n });
      const item = dailyMap.get(day);
      const fee = BigInt(ev?.feeAmount || "0");
      if (ev.eventType === "mint") item.mintFeeWei6 += fee;
      if (ev.eventType === "redeem") item.redeemFeeWei6 += fee;
    }

    chains.push({
      chainId: chain.chainId,
      chainName: chain.chainName,
      collateralSymbols: (chain.collaterals || []).map((c) => c?.symbol).filter(Boolean),
      mintTxCount: mintEvents.length,
      redeemTxCount: redeemEvents.length,
      mintAmountWei6: mintAmount.toString(),
      mintFeeWei6: mintFee.toString(),
      redeemAmountWei6: redeemAmount.toString(),
      redeemFeeWei6: redeemFee.toString(),
      mintAmountFtUsd: formatUnits6(mintAmount, 6),
      mintFeeFtUsd: formatUnits6(mintFee, 6),
      redeemAmountFtUsd: formatUnits6(redeemAmount, 6),
      redeemFeeFtUsd: formatUnits6(redeemFee, 6),
      mintFeePct: feePct(mintFee, mintAmount),
      redeemFeePct: feePct(redeemFee, redeemAmount),
      totalFeeFtUsd: formatUnits6(mintFee + redeemFee, 6),
      windowStart: chainMinTs ? new Date(chainMinTs * 1000).toISOString() : null,
      windowEnd: chainMaxTs ? new Date(chainMaxTs * 1000).toISOString() : null
    });
  }

  const totalFee = totalMintFee + totalRedeemFee;

  return {
    updatedAt: new Date().toISOString(),
    source: "api.flyingtulip.com/status/ftusd/dashboard?include_events=true",
    note: "Event amounts are 6-decimal ftUSD units. 1 ftUSD ~= 1 USD for fee USD estimate.",
    windowStart: minTs ? new Date(minTs * 1000).toISOString() : null,
    windowEnd: maxTs ? new Date(maxTs * 1000).toISOString() : null,
    summary: {
      totalMintAmountFtUsd: formatUnits6(totalMintAmount, 6),
      totalRedeemAmountFtUsd: formatUnits6(totalRedeemAmount, 6),
      totalMintFeeFtUsd: formatUnits6(totalMintFee, 6),
      totalRedeemFeeFtUsd: formatUnits6(totalRedeemFee, 6),
      totalFeeFtUsd: formatUnits6(totalFee, 6),
      totalFeeUsdEstimate: toNumber6(totalFee).toFixed(2),
      totalMintFeePct: feePct(totalMintFee, totalMintAmount),
      totalRedeemFeePct: feePct(totalRedeemFee, totalRedeemAmount)
    },
    chains,
    daily: Array.from(dailyMap.values())
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => {
        const total = d.mintFeeWei6 + d.redeemFeeWei6;
        return {
          day: d.day,
          mintFeeFtUsd: formatUnits6(d.mintFeeWei6, 6),
          redeemFeeFtUsd: formatUnits6(d.redeemFeeWei6, 6),
          totalFeeFtUsd: formatUnits6(total, 6)
        };
      })
  };
}

async function main() {
  const payload = await fetchJson(API_URL);
  if (!payload?.success || !Array.isArray(payload?.chains)) {
    throw new Error("invalid ftusd dashboard payload");
  }
  const out = buildOutput(payload);
  writeJson(OUT_PATH, out);
  console.log(
    `[ftusd-fees-index] done totalFeeUsd=${out.summary.totalFeeUsdEstimate} chains=${out.chains.length}`
  );
}

main().catch((err) => {
  console.error(`[ftusd-fees-index] failed: ${err?.message || err}`);
  process.exit(1);
});
