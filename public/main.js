const metaEl = document.getElementById("meta");
const noncircEl = document.getElementById("noncirc");
const circulatingEl = document.getElementById("circulating");
const burnsEl = document.getElementById("burns");
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

function pieSlicePath(cx, cy, r, startAngle, endAngle) {
  const start = ((startAngle - 90) * Math.PI) / 180;
  const end = ((endAngle - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

function renderTradablePie(parts, decimals) {
  const total = parts.reduce((sum, p) => sum + BigInt(p.value), 0n);
  if (total <= 0n) return "<p class=\"kpi-hint\">No tradable FT found.</p>";

  const colors = ["#1976d2", "#ef6c00", "#2e7d32", "#c2185b", "#6a1b9a"];
  let angle = 0;
  const slices = parts
    .map((part, idx) => {
      const v = BigInt(part.value);
      const pct = Number(v) / Number(total || 1n);
      const end = angle + pct * 360;
      const path = pieSlicePath(60, 60, 58, angle, end);
      const title = `${part.name}: ${fmtWei(part.value, decimals)} FT (${(pct * 100).toFixed(2)}%)`;
      angle = end;
      return `<path class=\"pie-slice\" data-hover=\"${title}\" d=\"${path}\" fill=\"${colors[idx % colors.length]}\"></path>`;
    })
    .join("");

  const legend = parts
    .map(
      (part, idx) =>
        `<div><span class=\"dot\" style=\"background:${colors[idx % colors.length]}\"></span>${part.name}</div>`
    )
    .join("");

  return `
    <div class=\"pie-wrap\"> 
      <svg class=\"pie\" viewBox=\"0 0 120 120\" aria-label=\"Tradable distribution by chain\">${slices}</svg>
      <div class=\"pie-legend\">${legend}</div>
    </div>
    <p class=\"pie-hover\">Hover a pie slice to see chain breakdown.</p>
  `;
}

function wirePieHover() {
  const hoverEl = circulatingEl.querySelector(".pie-hover");
  const slices = circulatingEl.querySelectorAll(".pie-slice");
  if (!hoverEl || !slices.length) return;
  slices.forEach((slice) => {
    slice.addEventListener("mouseenter", () => {
      hoverEl.textContent = slice.getAttribute("data-hover") || "";
      slice.setAttribute("opacity", "0.8");
    });
    slice.addEventListener("mouseleave", () => {
      hoverEl.textContent = "Hover a pie slice to see chain breakdown.";
      slice.setAttribute("opacity", "1");
    });
  });
}

function render(payload) {
  const decimals = Number(payload?.decimals || 18);
  const v = payload?.valuesWei || {};

  const inPuts = v.inPuts || "0";
  const tradable = v.tradable || "0";
  const circulating = v.circulating || "0";
  const nonCirculating = v.nonCirculating || "0";
  const burned = v.burned || "0";

  const unallocated = v.unallocated || "0";
  const vcMsig = v.vcMsig || "0";
  const institutional = v.institutional || "0";

  const onEthereum = v.onEthereum || "0";
  const onSonic = v.onSonic || "0";
  const onBnb = v.onBnb || "0";
  const onAvalanche = v.onAvalanche || "0";
  const onBase = v.onBase || "0";
  const allocatedInPutsTotal = (
    BigInt(inPuts) + BigInt(vcMsig) + BigInt(institutional)
  ).toString();
  const circulatingTotal = (BigInt(allocatedInPutsTotal) + BigInt(tradable)).toString();

  const tradableParts = [
    { name: "Ethereum", value: onEthereum },
    { name: "Sonic", value: onSonic },
    { name: "BNB", value: onBnb },
    { name: "Avalanche", value: onAvalanche },
    { name: "Base", value: onBase }
  ];

  burnsEl.innerHTML = `
    <h2>Burned</h2>
    <p class=\"burns-value\">${fmtWei(burned, decimals)} FT</p>
  `;

  circulatingEl.innerHTML = `
    <h2>Circulating</h2>
    <p class=\"noncirc-total\">${fmtWei(circulatingTotal, decimals)} FT</p>
    <p class=\"formula\">= Allocated in PUTs + Tradable</p>
    <div class=\"noncirc-grid\">
      <article class=\"noncirc-item\">
        <p class=\"label\">Allocated in PUTs</p>
        <p class=\"value\">${fmtWei(allocatedInPutsTotal, decimals)} FT</p>
        <div class=\"breakdown\">
          <p><span>Direct Put Allocation</span><strong>${fmtWei(inPuts, decimals)} FT</strong></p>
          <p><span>VC multisig</span><strong>${fmtWei(vcMsig, decimals)} FT</strong></p>
          <p><span>Institution via SAFT</span><strong>${fmtWei(institutional, decimals)} FT</strong></p>
        </div>
      </article>
      <article class=\"noncirc-item\">
        <p class=\"label\">Tradable</p>
        <p class=\"value\">${fmtWei(tradable, decimals)} FT</p>
      </article>
      <article class=\"noncirc-item\">
        <p class=\"label\">Tradable by Chain (hover pie)</p>
        ${renderTradablePie(tradableParts, decimals)}
      </article>
    </div>
  `;

  noncircEl.innerHTML = `
    <h2>Non-Circulating</h2>
    <p class=\"noncirc-total\">${fmtWei(unallocated, decimals)} FT</p>
    <div class=\"noncirc-grid\">
      <article class=\"noncirc-item\">
        <p class=\"label\">Unallocated</p>
        <p class=\"value\">${fmtWei(unallocated, decimals)} FT</p>
      </article>
    </div>
  `;

  if (finalNumbersEl) {
    finalNumbersEl.textContent = `${fmtWei(burned, decimals)} + ${fmtWei(circulatingTotal, decimals)} + ${fmtWei(unallocated, decimals)}`;
  }

  wirePieHover();

  const latest = payload.latestBlocks || {};
  const latestText = Object.entries(latest)
    .map(([k, block]) => `${k}: ${Number(block).toLocaleString()}`)
    .join(" | ");
  const updatedAt = payload.updatedAt ? new Date(payload.updatedAt).toLocaleString() : "n/a";
  metaEl.textContent = `Updated every 30 minutes | Last update: ${updatedAt}${latestText ? ` | Latest blocks -> ${latestText}` : ""}`;
}

async function loadDashboard() {
  metaEl.textContent = "Loading latest metrics snapshot...";
  try {
    const res = await fetch(`/data/metrics.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`metrics fetch failed (${res.status})`);
    const payload = await res.json();
    render(payload);
  } catch (error) {
    metaEl.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    burnsEl.innerHTML = "";
    circulatingEl.innerHTML = "";
    noncircEl.innerHTML = "";
    if (finalNumbersEl) finalNumbersEl.textContent = "";
  }
}

loadDashboard();
