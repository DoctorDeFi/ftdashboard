const updatedAtEl = document.getElementById("updatedAt");
const heroTotalSupplyEl = document.getElementById("heroTotalSupply");
const summaryEl = document.getElementById("summary");
const stackedBarEl = document.getElementById("stackedBar");
const splitMetaEl = document.getElementById("splitMeta");
const splitLegendEl = document.getElementById("splitLegend");
const circulatingBreakdownEl = document.getElementById("circulatingBreakdown");
const tradableByChainEl = document.getElementById("tradableByChain");
const methodologyBodyEl = document.getElementById("methodologyBody");
const blocksBodyEl = document.getElementById("blocksBody");
const finalNumbersEl = document.getElementById("finalNumbers");

function fmtWei(wei, decimals = 18) {
  const n = BigInt(wei || "0");
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  const asNum = Number(`${whole}.${fracStr}`);
  return asNum.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function pct(part, total) {
  if (total <= 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}

function render(payload) {
  const decimals = Number(payload?.decimals || 18);
  const v = payload?.valuesWei || {};

  const inPuts = BigInt(v.inPuts || "0");
  const tradable = BigInt(v.tradable || "0");
  const burned = BigInt(v.burned || "0");
  const unallocated = BigInt(v.unallocated || "0");
  const vcMsig = BigInt(v.vcMsig || "0");
  const institutional = BigInt(v.institutional || "0");

  const onEthereum = BigInt(v.onEthereum || "0");
  const onSonic = BigInt(v.onSonic || "0");
  const onBnb = BigInt(v.onBnb || "0");
  const onAvalanche = BigInt(v.onAvalanche || "0");
  const onBase = BigInt(v.onBase || "0");

  const allocatedInPutsTotal = inPuts + vcMsig + institutional;
  const circulating = allocatedInPutsTotal + tradable;
  const nonCirculating = unallocated;

  const totalSupply = BigInt(v.maxSupply || "10000000000000000000000000000");
  const currentTotalSupply = totalSupply - burned;

  const burnedPct = pct(burned, totalSupply);
  const circulatingPct = pct(circulating, totalSupply);
  const nonCircPct = Math.max(0, 100 - burnedPct - circulatingPct);

  summaryEl.innerHTML = `
    <article class="summary-card burned">
      <p class="label">Burned</p>
      <p class="value">${fmtWei(burned, decimals)}</p>
    </article>
    <article class="summary-card circulating">
      <p class="label">Circulating</p>
      <p class="value">${fmtWei(circulating, decimals)}</p>
    </article>
    <article class="summary-card noncirc">
      <p class="label">Non-circulating</p>
      <p class="value">${fmtWei(nonCirculating, decimals)}</p>
    </article>
  `;

  stackedBarEl.innerHTML = `
    <div class="seg burned" style="width:${burnedPct}%" title="Burned ${burnedPct.toFixed(2)}%"></div>
    <div class="seg circulating" style="width:${circulatingPct}%" title="Circulating ${circulatingPct.toFixed(2)}%"></div>
    <div class="seg noncirc" style="width:${nonCircPct}%" title="Non-circulating ${nonCircPct.toFixed(2)}%"></div>
  `;

  splitMetaEl.textContent = `Burned ${burnedPct.toFixed(2)}% | Circulating ${circulatingPct.toFixed(2)}% | Non-circulating ${nonCircPct.toFixed(2)}%`;
  splitLegendEl.innerHTML = `
    <span><i class="dot burned"></i>Burned</span>
    <span><i class="dot circulating"></i>Circulating</span>
    <span><i class="dot noncirc"></i>Non-circulating</span>
  `;

  circulatingBreakdownEl.innerHTML = `
    <h2>Circulating Breakdown</h2>
    <div class="breakdown-grid">
      <article class="break-card">
        <p class="label">In PUTs</p>
        <p class="value">${fmtWei(allocatedInPutsTotal, decimals)}</p>
        <p class="puts-sub">
          Direct Put Allocation: ${fmtWei(inPuts, decimals)} FT<br />
          VC multisig: ${fmtWei(vcMsig, decimals)} FT<br />
          Institution via SAFT: ${fmtWei(institutional, decimals)} FT
        </p>
      </article>
      <article class="break-card">
        <p class="label">Tradable</p>
        <p class="value">${fmtWei(tradable, decimals)}</p>
      </article>
    </div>
    <p class="formula">Circulating = In PUTs + Tradable</p>
  `;

  const chains = [
    { name: "Ethereum", value: onEthereum },
    { name: "Sonic", value: onSonic },
    { name: "Base", value: onBase },
    { name: "BNB", value: onBnb },
    { name: "Avalanche", value: onAvalanche }
  ];

  const chainRows = chains
    .map((chain) => {
      const p = pct(chain.value, tradable);
      return `
        <div class="chain-row">
          <span class="chain-name">${chain.name}</span>
          <div class="chain-bar-bg"><div class="chain-bar" style="width:${p}%"></div></div>
          <span class="chain-val">${fmtWei(chain.value, decimals)} FT (${p.toFixed(2)}%)</span>
        </div>
      `;
    })
    .join("");

  tradableByChainEl.innerHTML = `
    <h2>Tradable by Chain</h2>
    <div class="chain-list">${chainRows}</div>
  `;

  const latest = payload.latestBlocks || {};
  const latestItems = Object.entries(latest)
    .map(([k, block]) => `<div>${k}: ${Number(block).toLocaleString()}</div>`)
    .join("");
  blocksBodyEl.innerHTML = latestItems || "No block metadata available.";

  methodologyBodyEl.innerHTML = `
    <div>Community-made dashboard. Not official. Values may vary.</div>
    <div>Data source: indexed onchain metrics snapshot.</div>
    <div>Burned, circulating, non-circulating shown against 10B FT total supply.</div>
  `;

  const updatedAt = payload.updatedAt ? new Date(payload.updatedAt).toLocaleString() : "n/a";
  updatedAtEl.textContent = `Updated: ${updatedAt}`;
  heroTotalSupplyEl.textContent = `${fmtWei(currentTotalSupply, decimals)} FT`;

  finalNumbersEl.textContent = `${fmtWei(burned, decimals)} + ${fmtWei(circulating, decimals)} + ${fmtWei(nonCirculating, decimals)}`;
}

async function loadDashboard() {
  updatedAtEl.textContent = "Updated: loading...";
  try {
    const res = await fetch(`/data/metrics.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`metrics fetch failed (${res.status})`);
    const payload = await res.json();
    render(payload);
  } catch (error) {
    updatedAtEl.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    heroTotalSupplyEl.textContent = "--";
    summaryEl.innerHTML = "";
    stackedBarEl.innerHTML = "";
    splitLegendEl.innerHTML = "";
    circulatingBreakdownEl.innerHTML = "";
    tradableByChainEl.innerHTML = "";
    methodologyBodyEl.innerHTML = "";
    blocksBodyEl.innerHTML = "";
    finalNumbersEl.textContent = "";
  }
}

loadDashboard();
