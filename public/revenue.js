const themeToggleEl = document.getElementById("themeToggle");
const updatedAtEl = document.getElementById("updatedAt");
const summaryCardsEl = document.getElementById("summaryCards");
const chartMetaEl = document.getElementById("chartMeta");
const chartSvgEl = document.getElementById("revenueChart");
const chartTabsEl = document.getElementById("chartTabs");
const chartTooltipEl = document.getElementById("chartTooltip");
let chartRange = "7";

function initTheme() {
  try {
    const stored = localStorage.getItem("ft-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "light";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggleEl) themeToggleEl.textContent = theme === "light" ? "Dark mode" : "Light mode";
}

function wireThemeToggle() {
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

function fmtNum(n, digits = 2) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtUsd(n) {
  return `$${fmtNum(n, 2)}`;
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function card(label, value, sub = "") {
  return `<article class="summary-card"><p class="label">${label}</p><p class="value">${value}</p>${sub ? `<p class="sub">${sub}</p>` : ""}</article>`;
}

function shortDate(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-GB", { hour12: false });
}

async function loadAll() {
  const [putsRes, buysRes, feesRes] = await Promise.all([
    fetch("/data/puts-marketplace.json", { cache: "no-store" }),
    fetch("/data/protocol-ft-buys.json", { cache: "no-store" }),
    fetch("/data/ftusd-fees.json", { cache: "no-store" })
  ]);

  if (!putsRes.ok) throw new Error("Failed to load PUT marketplace data");
  if (!buysRes.ok) throw new Error("Failed to load protocol buys data");
  if (!feesRes.ok) throw new Error("Failed to load ftUSD fee data");

  const puts = await putsRes.json();
  const buys = await buysRes.json();
  const fees = await feesRes.json();

  return { puts, buys, fees };
}

function renderSummary(puts, buys, fees) {
  const putsRevenue = asNum(puts?.stats?.totalRevenueUsdEstimate);
  const buybackUsd = asNum(buys?.summary?.totalUsdSpentStableEstimate);
  const ftusdFeesUsd = asNum(fees?.summary?.totalFeeUsdEstimate);

  const totalRevenue = putsRevenue + buybackUsd + ftusdFeesUsd;
  const coreProductRevenue = buybackUsd;

  summaryCardsEl.innerHTML = `
    <div class="summary-card summary-total">
      <p class="label">Total Revenue (USD)</p>
      <p class="value">${fmtUsd(totalRevenue)}</p>
      <p class="sub">PUT marketplace + core product + ftUSD mint/redeem</p>
    </div>
    <div class="summary-grid-small">
      ${card("PUT Marketplace Revenue", fmtUsd(putsRevenue), `Sales tracked: ${puts?.stats?.totalSalesTracked ?? 0}`)}
      ${card("Core Product Revenue", fmtUsd(coreProductRevenue), "ftUSD on ETH & Sonic, Margin Lending on Sonic")}
      ${card("ftUSD Minting/Redemption Revenue", fmtUsd(ftusdFeesUsd), "Gross fee generation from mint + redeem")}
    </div>
  `;
}

function mergeDailySeries(puts, buys, fees) {
  const map = new Map();
  for (const d of puts?.dailyVolumeRevenue || []) {
    const day = d.day;
    if (!day) continue;
    if (!map.has(day)) map.set(day, { day, puts: 0, core: 0, fees: 0, total: 0 });
    map.get(day).puts += asNum(d.revenueUsd);
  }
  for (const d of buys?.daily || []) {
    const day = d.day;
    if (!day) continue;
    if (!map.has(day)) map.set(day, { day, puts: 0, core: 0, fees: 0, total: 0 });
    map.get(day).core += asNum(d.usdSpentStableEstimate);
  }
  for (const d of fees?.daily || []) {
    const day = d.day;
    if (!day) continue;
    if (!map.has(day)) map.set(day, { day, puts: 0, core: 0, fees: 0, total: 0 });
    map.get(day).fees += asNum(d.totalFeeFtUsd);
  }
  const rows = Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  for (const r of rows) r.total = r.puts + r.core + r.fees;
  return rows;
}

function getChartRows(rows, range) {
  if (range === "all") return rows;
  const n = Number(range);
  if (!Number.isFinite(n) || n <= 0) return rows;
  return rows.slice(-n);
}

function drawRevenueChart(allRows) {
  if (!chartSvgEl || !chartMetaEl) return;
  const rows = getChartRows(allRows, chartRange);
  if (!rows.length) {
    chartMetaEl.textContent = "No daily data.";
    chartSvgEl.innerHTML = "";
    return;
  }

  const w = 1200;
  const h = 360;
  const pad = { left: 64, right: 18, top: 22, bottom: 42 };
  const maxY = Math.max(...rows.map((r) => r.total), 1);
  const minX = 0;
  const maxX = Math.max(rows.length - 1, 1);
  const x = (i) => pad.left + ((w - pad.left - pad.right) * (i - minX)) / (maxX - minX);
  const y = (v) => h - pad.bottom - ((h - pad.top - pad.bottom) * v) / maxY;

  chartMetaEl.textContent = `${rows[0].day} → ${rows[rows.length - 1].day} (${rows.length} days)`;

  const lines = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const yy = y(maxY * p);
    return `<line x1="${pad.left}" y1="${yy}" x2="${w - pad.right}" y2="${yy}" stroke="rgba(122,167,255,0.18)" stroke-width="1" />`;
  });
  const yLabels = [0, 0.5, 1].map((p) => {
    const v = maxY * p;
    const yy = y(v);
    return `<text x="${pad.left - 8}" y="${yy + 4}" text-anchor="end" fill="var(--muted)" font-size="13">${fmtUsd(v).replace('.00','')}</text>`;
  });

  const totalPts = rows.map((r, i) => `${x(i)},${y(r.total)}`).join(" ");

  const dots = rows
    .map((r, i) => {
      const cx = x(i);
      const cy = y(r.total);
      return `<circle class="rev-dot" data-i="${i}" cx="${cx}" cy="${cy}" r="4.5" fill="#67e8b5" stroke="#0b213f" stroke-width="2" />`;
    })
    .join("");

  const xLabels = [0, Math.floor((rows.length - 1) / 2), rows.length - 1]
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .map((i) => `<text x="${x(i)}" y="${h - 12}" text-anchor="middle" fill="var(--muted)" font-size="13">${rows[i].day}</text>`)
    .join("");

  chartSvgEl.innerHTML = `
    <g>${lines.join("")}</g>
    <g>${yLabels.join("")}</g>
    <polyline points="${totalPts}" fill="none" stroke="#67e8b5" stroke-width="3.2" />
    <g>${dots}</g>
    <g>${xLabels}</g>
  `;

  const onMove = (ev) => {
    const el = ev.target.closest(".rev-dot");
    if (!el) return;
    const i = Number(el.getAttribute("data-i"));
    const r = rows[i];
    if (!r || !chartTooltipEl) return;
    chartTooltipEl.hidden = false;
    chartTooltipEl.innerHTML = `<strong>${r.day}</strong><br/>Total: ${fmtUsd(r.total)}<br/>PUT: ${fmtUsd(r.puts)}<br/>Core: ${fmtUsd(r.core)}<br/>ftUSD fees: ${fmtUsd(r.fees)}`;
    const rect = chartSvgEl.getBoundingClientRect();
    const cx = Number(el.getAttribute("cx"));
    const cy = Number(el.getAttribute("cy"));
    chartTooltipEl.style.left = `${(cx / 1200) * rect.width}px`;
    chartTooltipEl.style.top = `${(cy / 360) * rect.height}px`;
  };
  const onLeave = () => {
    if (chartTooltipEl) chartTooltipEl.hidden = true;
  };
  chartSvgEl.onmousemove = onMove;
  chartSvgEl.onclick = onMove;
  chartSvgEl.onmouseleave = onLeave;
}

function wireChartTabs(allRows) {
  if (!chartTabsEl) return;
  chartTabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-range]");
    if (!btn) return;
    chartRange = String(btn.getAttribute("data-range"));
    chartTabsEl.querySelectorAll(".range-tab").forEach((b) => b.classList.toggle("active", b === btn));
    drawRevenueChart(allRows);
  });
}

async function init() {
  setTheme(initTheme());
  wireThemeToggle();

  try {
    const { puts, buys, fees } = await loadAll();
    const latest = [puts?.updatedAt, buys?.updatedAt, fees?.updatedAt]
      .map((x) => (x ? new Date(x).getTime() : 0))
      .sort((a, b) => b - a)[0];
    updatedAtEl.textContent = `Updated: ${shortDate(latest ? new Date(latest).toISOString() : null)}`;
    renderSummary(puts, buys, fees);
    const chartRows = mergeDailySeries(puts, buys, fees);
    drawRevenueChart(chartRows);
    wireChartTabs(chartRows);
  } catch (err) {
    updatedAtEl.textContent = `Error: ${err?.message || "load failed"}`;
    summaryCardsEl.innerHTML = `<article class="summary-card"><p class="label">Error</p><p class="value">Failed to load revenue data</p></article>`;
    if (chartMetaEl) chartMetaEl.textContent = err?.message || "Unknown error";
    if (chartSvgEl) chartSvgEl.innerHTML = "";
  }
}

init();
