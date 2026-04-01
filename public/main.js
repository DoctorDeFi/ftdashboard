const updatedAtEl = document.getElementById("updatedAt");
const heroTotalSupplyEl = document.getElementById("heroTotalSupply");
const summaryEl = document.getElementById("summary");
const stackedBarEl = document.getElementById("stackedBar");
const splitMetaEl = document.getElementById("splitMeta");
const splitLegendEl = document.getElementById("splitLegend");
const circulatingBreakdownEl = document.getElementById("circulatingBreakdown");
const tradableByChainEl = document.getElementById("tradableByChain");
const protocolBuysSectionEl = document.getElementById("protocolBuysSection");
const blocksBodyEl = document.getElementById("blocksBody");
const finalNumbersEl = document.getElementById("finalNumbers");
const systemNavEl = document.getElementById("systemNav");
const withdrawalNavEl = document.getElementById("withdrawalNav");

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

function formatNav(value) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return `$${value.toFixed(5)}`;
}

function shortHash(v, a = 6, b = 4) {
  const s = String(v || "");
  if (s.length <= a + b + 3) return s;
  return `${s.slice(0, a)}...${s.slice(-b)}`;
}

function renderProtocolBuys(payload) {
  if (!protocolBuysSectionEl) return;
  if (!payload || !payload.summary) {
    protocolBuysSectionEl.innerHTML = `
      <h2>Protocol FT Buys</h2>
      <p class="puts-sub">No buy snapshot available yet.</p>
    `;
    return;
  }

  const s = payload.summary;
  const totalFtNum = Number(s.totalFtBought || 0);
  const avgPriceNum = Number(s.avgBuyPriceUsd || 0);
  const estUsd = Number.isFinite(totalFtNum) && Number.isFinite(avgPriceNum) ? totalFtNum * avgPriceNum : 0;
  const moduleWallet = new Map((payload.wallets || []).map((w) => [w.module, w]));
  const moduleRows = (payload.moduleTotals || [])
    .map(
      (m) => `
      <tr>
        <td>
          <div>${m.module}</div>
          ${
            moduleWallet.get(m.module)
              ? `<a class="module-wallet-link" target="_blank" rel="noopener noreferrer" href="${
                  moduleWallet.get(m.module).chainKey === "sonic"
                    ? "https://sonicscan.org/address/"
                    : "https://etherscan.io/address/"
                }${moduleWallet.get(m.module).address}">${shortHash(moduleWallet.get(m.module).address, 8, 6)}</a>`
              : ""
          }
        </td>
        <td>${m.ftBought}</td>
      </tr>
    `
    )
    .join("");

  protocolBuysSectionEl.innerHTML = `
    <div class="split-head">
      <h2>Protocol FT Buys (Rev/Distribution)</h2>
    </div>
    <p class="puts-sub">Excludes FT buybacks funded through PUT withdrawals.</p>
    <article class="summary-card buys-highlight">
      <p class="label">Total Protocol FT Bought</p>
      <p class="value">${s.totalFtBought}</p>
      <p class="buys-highlight-sub">$${estUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
    </article>
    <div class="summary-grid buys-grid buys-inline">
      <article class="summary-card buys-stat">
        <p class="label">Avg Buy Price (USD)</p>
        <p class="value">$${s.avgBuyPriceUsd}</p>
      </article>
      <article class="summary-card buys-stat">
        <p class="label">FT Bought 24h</p>
        <p class="value">${s.ftBought24h}</p>
      </article>
      <article class="summary-card buys-stat">
        <p class="label">Tracked Chains</p>
        <p class="value">${(payload.chainTotals || []).length}</p>
      </article>
    </div>
    <div class="table-wrap">
      <h3 class="mini-h">Module Breakdown</h3>
      <table class="mini-table">
        <thead>
          <tr><th>Module</th><th>FT Bought</th></tr>
        </thead>
        <tbody>${moduleRows || '<tr><td colspan="2">No rows</td></tr>'}</tbody>
      </table>
    </div>
  `;
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
  const vcShiftToNonCirculating = 20_000_000n * 10n ** 18n;

  const onEthereum = BigInt(v.onEthereum || "0");
  const onSonic = BigInt(v.onSonic || "0");
  const onBnb = BigInt(v.onBnb || "0");
  const onAvalanche = BigInt(v.onAvalanche || "0");
  const onBase = BigInt(v.onBase || "0");

  const vcEffectiveInPuts =
    institutional > vcShiftToNonCirculating ? institutional - vcShiftToNonCirculating : 0n;
  const allocatedInPutsTotal = inPuts + vcEffectiveInPuts;
  const inPutsDisplay = inPuts + vcEffectiveInPuts;
  const circulating = allocatedInPutsTotal + tradable;
  const nonCirculating = unallocated + vcMsig + vcShiftToNonCirculating;

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
        <p class="value">${fmtWei(inPutsDisplay, decimals)}</p>
      </article>
      <article class="break-card">
        <p class="label">Tradable</p>
        <p class="value">${fmtWei(tradable, decimals)}</p>
      </article>
    </div>
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

  const updatedAt = payload.updatedAt ? new Date(payload.updatedAt).toLocaleString() : "n/a";
  updatedAtEl.textContent = `Updated: ${updatedAt}`;
  heroTotalSupplyEl.textContent = `${fmtWei(currentTotalSupply, decimals)}`;

  finalNumbersEl.textContent = `${fmtWei(burned, decimals)} + ${fmtWei(circulating, decimals)} + ${fmtWei(nonCirculating, decimals)}`;
}

function renderNavs(navData) {
  if (!systemNavEl || !withdrawalNavEl) return;
  if (!navData) {
    systemNavEl.textContent = "--";
    withdrawalNavEl.textContent = "--";
    return;
  }

  const { systemNav, withdrawalNav } = navData;
  systemNavEl.textContent = formatNav(systemNav);
  withdrawalNavEl.textContent = formatNav(withdrawalNav);
}

async function loadNavs() {
  const res = await fetch(`/data/nav.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`nav fetch failed (${res.status})`);
  const payload = await res.json();
  return {
    systemNav: Number(payload?.systemNav?.value || 0),
    withdrawalNav: Number(payload?.withdrawalNav?.value || 0)
  };
}

async function loadDashboard() {
  updatedAtEl.textContent = "Updated: loading...";
  renderNavs(null);
  renderProtocolBuys(null);
  try {
    const [metricsRes, navData, buysRes] = await Promise.all([
      fetch(`/data/metrics.json?t=${Date.now()}`),
      loadNavs().catch(() => null),
      fetch(`/data/protocol-ft-buys.json?t=${Date.now()}`).catch(() => null)
    ]);
    if (!metricsRes.ok) throw new Error(`metrics fetch failed (${metricsRes.status})`);
    const payload = await metricsRes.json();
    render(payload);
    renderNavs(navData);
    if (buysRes && buysRes.ok) {
      const buysPayload = await buysRes.json();
      renderProtocolBuys(buysPayload);
    } else {
      renderProtocolBuys(null);
    }
  } catch (error) {
    updatedAtEl.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    heroTotalSupplyEl.textContent = "--";
    summaryEl.innerHTML = "";
    stackedBarEl.innerHTML = "";
    splitLegendEl.innerHTML = "";
    circulatingBreakdownEl.innerHTML = "";
    tradableByChainEl.innerHTML = "";
    protocolBuysSectionEl.innerHTML = "";
    blocksBodyEl.innerHTML = "";
    finalNumbersEl.textContent = "";
    renderNavs(null);
  }
}

loadDashboard();
