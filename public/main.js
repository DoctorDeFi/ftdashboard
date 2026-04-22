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
const themeToggleEl = document.getElementById("themeToggle");
let buysChartRange = "30D";

function getPreferredTheme() {
  try {
    const stored = localStorage.getItem("ft-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "light";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggleEl) {
    themeToggleEl.textContent = theme === "light" ? "Dark mode" : "Light mode";
  }
}

function initThemeToggle() {
  const initial = getPreferredTheme();
  setTheme(initial);
  if (!themeToggleEl) return;
  themeToggleEl.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next = current === "light" ? "dark" : "light";
    setTheme(next);
    try {
      localStorage.setItem("ft-theme", next);
    } catch {}
  });
}

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

function withLogo(label) {
  return String(label || "");
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
  const allDaily = (payload.daily || [])
    .map((d) => ({ day: d.day, ft: Number(d.ftBought || 0) }))
    .filter((d) => Number.isFinite(d.ft));
  const rangeDays = buysChartRange === "7D" ? 7 : buysChartRange === "30D" ? 30 : null;
  const daily = rangeDays ? allDaily.slice(-rangeDays) : allDaily.slice();
  const moduleRows = (payload.moduleTotals || [])
    .map(
      (m) => `
      <tr>
        <td>
          <div>${withLogo(m.module)}</div>
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
  const historyRows = daily
    .slice()
    .reverse()
    .slice(0, 14)
    .map(
      (d) => `
      <tr>
        <td>${d.day}</td>
        <td>${d.ft.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
      </tr>
    `
    )
    .join("");

  const chartW = 1200;
  const chartH = 360;
  const padL = 84;
  const padR = 28;
  const padT = 22;
  const padB = 54;
  const maxY = Math.max(...daily.map((d) => d.ft), 1);
  const minY = 0;
  const spanX = Math.max(daily.length - 1, 1);
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const points = daily.map((d, i) => {
    const x = padL + (i * plotW) / spanX;
    const y = chartH - padB - ((d.ft - minY) / (maxY - minY || 1)) * plotH;
    return [x, y];
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1][0].toFixed(2)},${(chartH - padB).toFixed(2)} L${points[0][0].toFixed(2)},${(chartH - padB).toFixed(2)} Z`
      : "";
  const startDay = daily[0]?.day || "--";
  const endDay = daily[daily.length - 1]?.day || "--";
  const yTicks = [0, maxY * 0.5, maxY];
  const yFormat = (n) =>
    Number(n).toLocaleString(undefined, {
      maximumFractionDigits: n >= 100 ? 0 : 2
    });
  const yGrid = yTicks
    .map((v) => {
      const y = chartH - padB - ((v - minY) / (maxY - minY || 1)) * plotH;
      return `
      <line x1="${padL}" y1="${y.toFixed(2)}" x2="${(chartW - padR).toFixed(2)}" y2="${y.toFixed(2)}" class="chart-grid-line"></line>
      <text x="${(padL - 10).toFixed(2)}" y="${(y + 4).toFixed(2)}" text-anchor="end" class="chart-axis-text">${yFormat(v)}</text>
    `;
    })
    .join("");
  const xTickIndexes = Array.from(new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])).filter(
    (i) => i >= 0
  );
  const xTicks = xTickIndexes
    .map((i) => {
      const p = points[i];
      const label = daily[i]?.day || "";
      return `<text x="${p[0].toFixed(2)}" y="${(chartH - 20).toFixed(2)}" text-anchor="middle" class="chart-axis-text">${label}</text>`;
    })
    .join("");
  const pointsMarkup = points
    .map((p, i) => {
      const d = daily[i];
      const val = d.ft.toLocaleString(undefined, { maximumFractionDigits: 4 });
      return `
      <circle
        class="chart-point"
        data-idx="${i}"
        cx="${p[0].toFixed(2)}"
        cy="${p[1].toFixed(2)}"
        r="5.5"
        tabindex="0"
        role="button"
        aria-label="${d.day}: ${val} FT"
      >
        <title>${d.day}: ${val} FT</title>
      </circle>
    `;
    })
    .join("");
  const defaultDetail = daily[daily.length - 1] || null;

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
    <div class="table-wrap buys-chart-wrap buys-chart-block">
        <h3 class="mini-h">Daily FT Buys (${buysChartRange})</h3>
        <div class="range-tabs">
          <button type="button" class="range-tab ${buysChartRange === "7D" ? "active" : ""}" data-buys-range="7D">7D</button>
          <button type="button" class="range-tab ${buysChartRange === "30D" ? "active" : ""}" data-buys-range="30D">30D</button>
          <button type="button" class="range-tab ${buysChartRange === "ALL" ? "active" : ""}" data-buys-range="ALL">All</button>
        </div>
        <div class="buys-chart-meta">${startDay} → ${endDay} (${daily.length} day${daily.length === 1 ? "" : "s"})</div>
        ${
          daily.length
            ? `
          <div class="buys-chart-shell">
          <svg class="buys-chart" viewBox="0 0 ${chartW} ${chartH}" preserveAspectRatio="none" aria-label="Daily FT buys line chart">
            <defs>
              <linearGradient id="buysArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="rgba(88, 255, 171, 0.36)" />
                <stop offset="100%" stop-color="rgba(88, 255, 171, 0.03)" />
              </linearGradient>
            </defs>
            ${yGrid}
            <line x1="${padL}" y1="${(chartH - padB).toFixed(2)}" x2="${(chartW - padR).toFixed(2)}" y2="${(
                chartH - padB
              ).toFixed(2)}" class="chart-axis-line"></line>
            <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(chartH - padB).toFixed(2)}" class="chart-axis-line"></line>
            <path d="${areaPath}" fill="url(#buysArea)"></path>
            <path d="${linePath}" fill="none" stroke="#56eca5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
            ${pointsMarkup}
            ${xTicks}
            <text x="${((padL + chartW - padR) / 2).toFixed(2)}" y="${(chartH - 8).toFixed(2)}" text-anchor="middle" class="chart-axis-label">Day</text>
            <text x="${(padL - 10).toFixed(2)}" y="${(padT - 6).toFixed(2)}" text-anchor="end" class="chart-axis-label">FT Bought</text>
          </svg>
          <div class="chart-tooltip" data-chart-tooltip></div>
          </div>
        `
            : `<div class="puts-sub">No daily data yet.</div>`
        }
      </div>
    <div class="buys-lower-grid">
      <div class="table-wrap">
        <h3 class="mini-h history-head">History</h3>
        <table class="mini-table history-table">
          <thead><tr><th>Day</th><th>FT Bought</th></tr></thead>
          <tbody>${historyRows || '<tr><td colspan="2">No rows</td></tr>'}</tbody>
        </table>
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
    </div>
  `;

  if (daily.length) {
    const shellEl = protocolBuysSectionEl.querySelector(".buys-chart-shell");
    const svgEl = protocolBuysSectionEl.querySelector(".buys-chart");
    const tooltipEl = protocolBuysSectionEl.querySelector("[data-chart-tooltip]");
    const pointEls = Array.from(protocolBuysSectionEl.querySelectorAll(".chart-point"));
    const setDetail = (idx) => {
      const item = daily[idx];
      if (!item || !tooltipEl || !svgEl || !shellEl) return;
      const pointEl = pointEls[idx];
      if (!pointEl) return;
      const x = Number(pointEl.getAttribute("cx"));
      const y = Number(pointEl.getAttribute("cy"));
      const left = (x / chartW) * svgEl.clientWidth;
      const top = (y / chartH) * svgEl.clientHeight;
      tooltipEl.innerHTML = `<span>${item.day}</span><strong>${item.ft.toLocaleString(undefined, {
        maximumFractionDigits: 4
      })} FT</strong>`;
      tooltipEl.style.left = `${Math.min(Math.max(left, 88), svgEl.clientWidth - 88)}px`;
      tooltipEl.style.top = `${Math.max(top - 14, 26)}px`;
      tooltipEl.classList.add("visible");
      pointEls.forEach((el, i) => el.classList.toggle("active", i === idx));
    };
    pointEls.forEach((el) => {
      const idx = Number(el.getAttribute("data-idx"));
      el.addEventListener("mouseenter", () => setDetail(idx));
      el.addEventListener("focus", () => setDetail(idx));
      el.addEventListener("click", () => setDetail(idx));
    });
    if (defaultDetail) {
      setDetail(daily.length - 1);
    }
  }

  const rangeButtons = Array.from(protocolBuysSectionEl.querySelectorAll("[data-buys-range]"));
  rangeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.getAttribute("data-buys-range");
      if (!next || next === buysChartRange) return;
      buysChartRange = next;
      renderProtocolBuys(payload);
    });
  });
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

  const inPutsDisplay = inPuts;
  const circulating = inPutsDisplay + tradable;
  const nonCirculating = unallocated + vcMsig + institutional;

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
          <span class="chain-name">${withLogo(chain.name)}</span>
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

initThemeToggle();
loadDashboard();
