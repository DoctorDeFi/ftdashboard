const updatedAtEl = document.getElementById("updatedAt");
const indexedBlockEl = document.getElementById("indexedBlock");
const sourceAddrEl = document.getElementById("sourceAddr");
const statsEl = document.getElementById("stats");
const protocolStateEl = document.getElementById("protocolState");
const listingsBodyEl = document.getElementById("listingsBody");
const salesBodyEl = document.getElementById("salesBody");
const activityBodyEl = document.getElementById("activityBody");
const countLabelEl = document.getElementById("countLabel");
const searchInputEl = document.getElementById("searchInput");
const collateralSelectEl = document.getElementById("collateralSelect");
const sortSelectEl = document.getElementById("sortSelect");
const buyModalBackdropEl = document.getElementById("buyModalBackdrop");
const buyModalCloseEl = document.getElementById("buyModalClose");
const buyModalPutLabelEl = document.getElementById("buyModalPutLabel");
const buyModalFiltersEl = document.getElementById("buyModalFilters");
const buyModalLinkEl = document.getElementById("buyModalLink");

let allListings = [];
const visibleListingMap = new Map();
let oracleState = {
  ethUsd: null,
  ethUsdDecimals: null
};

if (buyModalBackdropEl) {
  buyModalBackdropEl.hidden = true;
}

function shortAddr(value) {
  if (!value || value.length < 10) return value || "--";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function fmtDateFromUnix(unix) {
  if (!unix) return "--";
  const d = new Date(Number(unix) * 1000);
  if (Number.isNaN(d.valueOf())) return "--";
  return d.toLocaleString();
}

function fmtDateIso(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return "--";
  return d.toLocaleString();
}

function etherscanTx(hash) {
  return `https://etherscan.io/tx/${hash}`;
}

function formatUnitsFromWei(value, decimals = 18, maxFraction = 4) {
  try {
    const n = BigInt(value || 0);
    const d = BigInt(decimals);
    const base = 10n ** d;
    const whole = n / base;
    const frac = n % base;
    const fracStr = frac
      .toString()
      .padStart(Number(d), "0")
      .slice(0, maxFraction)
      .replace(/0+$/, "");
    return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  } catch {
    return "--";
  }
}

function premiumPct(row) {
  const bps = premiumBps(row);
  if (bps === null) return null;
  return Number(bps) / 100;
}

function pow10(decimals) {
  return 10n ** BigInt(decimals);
}

function isUsdLikeSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();
  return ["USDT", "USDC", "DAI", "USDE", "USDS", "FDUSD", "TUSD", "USDP"].includes(s);
}

function isEthLikeSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();
  return ["WETH", "ETH"].includes(s);
}

function scaleDecimals(value, fromDecimals, toDecimals) {
  const from = BigInt(fromDecimals);
  const to = BigInt(toDecimals);
  if (to === from) return value;
  if (to > from) return value * 10n ** (to - from);
  return value / 10n ** (from - to);
}

function investmentBaseWei(row) {
  try {
    const payment = String(row.paymentToken || "").toLowerCase();
    const collateral = String(row.put?.collateralToken || "").toLowerCase();
    const amountRemaining = BigInt(row.put?.amountRemainingWei || 0);
    if (amountRemaining <= 0n) return null;

    if (payment && collateral && payment === collateral) {
      return amountRemaining;
    }

    const paymentSymbol = row.paymentTokenMeta?.symbol;
    const collateralSymbol = row.put?.collateralMeta?.symbol;
    const paymentDecimals = Number(row.paymentTokenMeta?.decimals ?? 18);
    const collateralDecimals = Number(row.put?.collateralMeta?.decimals ?? 18);
    const ethUsdWei = oracleState.ethUsd ? BigInt(oracleState.ethUsd) : null;
    const ethUsdDecimals = Number(oracleState.ethUsdDecimals ?? 8);
    const ftWei = BigInt(row.put?.ftWei || 0);
    const ftPerUsdWei = BigInt(row.put?.ftPerUsdWei || 0);

    // Treat USD stables as equivalent units (USDT/USDC/etc), normalize decimals.
    if (isUsdLikeSymbol(paymentSymbol) && isUsdLikeSymbol(collateralSymbol)) {
      return scaleDecimals(amountRemaining, collateralDecimals, paymentDecimals);
    }

    // WETH/ETH collateral priced in USD-like token.
    if (
      isEthLikeSymbol(collateralSymbol) &&
      isUsdLikeSymbol(paymentSymbol) &&
      ethUsdWei &&
      ethUsdWei > 0n
    ) {
      const num = amountRemaining * pow10(paymentDecimals) * ethUsdWei;
      const den = pow10(collateralDecimals) * pow10(ethUsdDecimals);
      return den > 0n ? num / den : null;
    }

    // USD-like collateral priced in WETH/ETH token.
    if (
      isUsdLikeSymbol(collateralSymbol) &&
      isEthLikeSymbol(paymentSymbol) &&
      ethUsdWei &&
      ethUsdWei > 0n
    ) {
      const num = amountRemaining * pow10(ethUsdDecimals) * pow10(paymentDecimals);
      const den = pow10(collateralDecimals) * ethUsdWei;
      return den > 0n ? num / den : null;
    }

    // Cross-token fallback: derive USD notional from ft / ftPerUsd,
    // then express it in payment-token units if payment token is USD-like.
    if (ftWei > 0n && ftPerUsdWei > 0n && isUsdLikeSymbol(paymentSymbol)) {
      const usd18 = (ftWei * 10n ** 18n) / ftPerUsdWei;
      return (usd18 * pow10(paymentDecimals)) / 10n ** 18n;
    }

    return null;
  } catch {
    return null;
  }
}

function premiumBps(row) {
  try {
    const price = BigInt(row.priceWei || 0);
    const investment = investmentBaseWei(row);
    if (investment === null) return null;
    if (investment <= 0n) return null;
    return ((price - investment) * 10000n) / investment;
  } catch {
    return null;
  }
}

function populateCollateralOptions(rows) {
  const prev = collateralSelectEl.value || "all";
  const entries = new Map();
  for (const row of rows) {
    if (row.derivedStatus !== "active") continue;
    const address = String(row.put?.collateralToken || "").toLowerCase();
    const symbol = String(row.put?.collateralMeta?.symbol || "").trim();
    if (!address || !symbol) continue;
    if (!entries.has(address)) entries.set(address, symbol);
  }

  const sorted = [...entries.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  collateralSelectEl.innerHTML = [
    `<option value="all">All Collateral</option>`,
    ...sorted.map(([address, symbol]) => `<option value="${address}">${symbol}</option>`)
  ].join("");
  collateralSelectEl.value = entries.has(prev) || prev === "all" ? prev : "all";
}

function renderStats(stats = {}) {
  statsEl.innerHTML = `
    <article class="card"><p class="label">Active Listings</p><p class="value">${stats.activeListings || 0}</p></article>
    <article class="card"><p class="label">Expired Listings</p><p class="value">${stats.expiredListings || 0}</p></article>
    <article class="card"><p class="label">Tracked Listings</p><p class="value">${stats.totalTrackedListings || 0}</p></article>
    <article class="card"><p class="label">Tracked Sales</p><p class="value">${stats.totalSalesTracked || 0}</p></article>
    <article class="card"><p class="label">Accepted Tokens</p><p class="value">${stats.acceptedTokens || 0}</p></article>
    <article class="card"><p class="label">Logs In Last Run</p><p class="value">${stats.scannedLogsInRun || 0}</p></article>
  `;
}

function renderProtocol(config, acceptedTokens) {
  const tokens = (acceptedTokens || [])
    .map((x) => `<span class="pill">${x.symbol} <small>${shortAddr(x.address)}</small></span>`)
    .join(" ");

  protocolStateEl.innerHTML = `
    <h2>Protocol State</h2>
    <div class="kv-grid">
      <div><span>Maker Fee (bps)</span><strong>${config?.makerFeeBps ?? "--"}</strong></div>
      <div><span>Taker Fee (bps)</span><strong>${config?.takerFeeBps ?? "--"}</strong></div>
      <div><span>Emergency Paused</span><strong>${String(config?.emergencyPaused ?? "--")}</strong></div>
      <div><span>Fee Recipient</span><strong>${shortAddr(config?.feeRecipient)}</strong></div>
    </div>
    <p class="tokens-line">${tokens || "No token config events indexed yet."}</p>
  `;
}

function sortListings(rows, mode) {
  const next = [...rows];
  const big = (value, fallback = 0n) => {
    try {
      return value ? BigInt(value) : fallback;
    } catch {
      return fallback;
    }
  };

  if (mode === "price_desc") {
    return next.sort((a, b) => {
      const av = big(a.priceWei, 0n);
      const bv = big(b.priceWei, 0n);
      if (av === bv) return 0;
      return av > bv ? -1 : 1;
    });
  }
  if (mode === "expiry_asc") {
    return next.sort((a, b) => Number(a.expires || Number.MAX_SAFE_INTEGER) - Number(b.expires || Number.MAX_SAFE_INTEGER));
  }
  if (mode === "expiry_desc") {
    return next.sort((a, b) => Number(b.expires || 0) - Number(a.expires || 0));
  }
  if (mode === "token_asc") {
    return next.sort((a, b) => Number(a.tokenId || 0) - Number(b.tokenId || 0));
  }
  if (mode === "collateral_az") {
    return next.sort((a, b) =>
      String(a.put?.collateralMeta?.symbol || "").localeCompare(String(b.put?.collateralMeta?.symbol || ""))
    );
  }
  if (mode === "premium_desc") {
    return next.sort((a, b) => {
      const av = premiumBps(a);
      const bv = premiumBps(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av === bv) return 0;
      return av > bv ? -1 : 1;
    });
  }
  if (mode === "premium_asc") {
    return next.sort((a, b) => {
      const av = premiumBps(a);
      const bv = premiumBps(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av === bv) return 0;
      return av > bv ? 1 : -1;
    });
  }
  return next.sort((a, b) => {
    const av = big(a.priceWei, 0n);
    const bv = big(b.priceWei, 0n);
    if (av === bv) return 0;
    return av > bv ? 1 : -1;
  });
}

function renderListings() {
  const q = searchInputEl.value.trim().toLowerCase();
  const selectedCollateral = String(collateralSelectEl.value || "all").toLowerCase();
  visibleListingMap.clear();

  const filtered = allListings.filter((row) => {
    if (row.derivedStatus !== "active") return false;
    if (selectedCollateral !== "all") {
      const collateralAddr = String(row.put?.collateralToken || "").toLowerCase();
      if (collateralAddr !== selectedCollateral) return false;
    }
    if (!q) return true;
    const haystack = [
      row.tokenId,
      row.seller,
      row.paymentTokenMeta?.symbol,
      row.put?.collateralMeta?.symbol,
      row.paymentToken
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  const sorted = sortListings(filtered, sortSelectEl.value);

  listingsBodyEl.innerHTML = sorted
    .map((x) => {
      visibleListingMap.set(String(x.tokenId), x);
      const premium = premiumPct(x);
      const premiumText = premium === null ? "--" : `${premium >= 0 ? "+" : ""}${premium.toFixed(2)}%`;
      const premiumClass = premium === null ? "" : premium >= 0 ? "premium up" : "premium down";
      return `
        <tr>
          <td>PUT #${x.tokenId}<br /><small>${shortAddr(x.seller)}</small></td>
          <td>${x.put?.amountDisplay || "--"} ${x.put?.collateralMeta?.symbol || ""}</td>
          <td>${x.put?.collateralMeta?.symbol || "--"}</td>
          <td>${x.put?.amountRemainingDisplay || "--"}</td>
          <td>${x.priceDisplay || "--"} ${x.paymentTokenMeta?.symbol || ""}</td>
          <td><span class="${premiumClass}">${premiumText}</span></td>
          <td>${fmtDateFromUnix(x.expires)}</td>
          <td>${x.put?.ftDisplay || "--"}</td>
          <td><button class="buy-btn" data-token-id="${x.tokenId}" type="button">Buy</button></td>
        </tr>
      `;
    })
    .join("");

  countLabelEl.textContent = `Rows: ${sorted.length}`;
}

function addFilterRow(label, value) {
  return `
    <div class="filter-row">
      <span>${label}</span>
      <strong>${value || "--"}</strong>
    </div>
  `;
}

function dateOnlyFromUnix(unix) {
  if (!unix) return "--";
  const d = new Date(Number(unix) * 1000);
  if (Number.isNaN(d.valueOf())) return "--";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function openBuyModal(row) {
  const investmentToken = row.put?.collateralMeta?.symbol || "--";
  const investmentValue = row.put?.amountDisplay || "--";
  const remainingValue = row.put?.amountRemainingDisplay || "--";
  const priceToken = row.paymentTokenMeta?.symbol || "--";
  const priceValue =
    row.priceWei && row.paymentTokenMeta
      ? formatUnitsFromWei(row.priceWei, Number(row.paymentTokenMeta.decimals || 18))
      : row.priceDisplay || "--";
  const deadlineDate = dateOnlyFromUnix(row.expires);

  buyModalPutLabelEl.textContent = `PUT #${row.tokenId}`;
  buyModalFiltersEl.innerHTML = [
    addFilterRow("Remaining Min Amount", remainingValue),
    addFilterRow("Remaining Max Amount", remainingValue),
    addFilterRow("Investment Token", investmentToken),
    addFilterRow("Investment Min Amount", investmentValue),
    addFilterRow("Investment Max Amount", investmentValue),
    addFilterRow("Current Price Token", priceToken),
    addFilterRow("Current Price Min Amount", priceValue),
    addFilterRow("Current Price Max Amount", priceValue),
    addFilterRow("Sale Deadline From", deadlineDate),
    addFilterRow("Sale Deadline To", deadlineDate),
    addFilterRow("Reference Seller", shortAddr(row.seller))
  ].join("");

  buyModalLinkEl.href = `https://marketplace.flyingtulip.com/marketplace?tab=0&from=ft-dashboard&tokenId=${encodeURIComponent(String(row.tokenId))}`;
  buyModalBackdropEl.hidden = false;
}

function closeBuyModal() {
  buyModalBackdropEl.hidden = true;
}

function renderSales(rows) {
  salesBodyEl.innerHTML = rows
    .slice(0, 100)
    .map((x) => `
      <tr>
        <td>${x.type}</td>
        <td>${x.tokenId ? `#${x.tokenId}` : "--"}</td>
        <td>${x.priceDisplay || "--"} ${x.paymentTokenMeta?.symbol || ""}</td>
        <td>${shortAddr(x.seller)}</td>
        <td>${shortAddr(x.buyer)}</td>
        <td>${fmtDateFromUnix(x.atUnix)}</td>
        <td><a href="${etherscanTx(x.txHash)}" target="_blank" rel="noopener noreferrer">${shortAddr(x.txHash)}</a></td>
      </tr>
    `)
    .join("");
}

function renderActivity(rows) {
  activityBodyEl.innerHTML = rows
    .slice(0, 120)
    .map((x) => `
      <tr>
        <td>${x.event}</td>
        <td>${x.tokenId ? `#${x.tokenId}` : "--"}</td>
        <td>${shortAddr(x.seller)}</td>
        <td>${Number(x.blockNumber || 0).toLocaleString()}</td>
        <td>${fmtDateFromUnix(x.atUnix)}</td>
        <td><a href="${etherscanTx(x.txHash)}" target="_blank" rel="noopener noreferrer">${shortAddr(x.txHash)}</a></td>
      </tr>
    `)
    .join("");
}

async function loadDashboard() {
  updatedAtEl.textContent = "Updated: loading...";
  try {
    const res = await fetch(`/data/puts-marketplace.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`Data fetch failed (${res.status})`);
    const payload = await res.json();

    allListings = Array.isArray(payload.listingsActive) ? payload.listingsActive : [];
    oracleState = {
      ethUsd: payload?.oracle?.ethUsd || null,
      ethUsdDecimals: payload?.oracle?.ethUsdDecimals ?? 8
    };
    populateCollateralOptions(allListings);

    updatedAtEl.textContent = `Updated: ${fmtDateIso(payload.updatedAt)}`;
    indexedBlockEl.textContent = `Indexed Block: ${Number(payload.source?.indexedThroughBlock || 0).toLocaleString()}`;
    sourceAddrEl.textContent = `Contract: ${shortAddr(payload.source?.marketplace)}`;

    renderStats(payload.stats || {});
    renderProtocol(payload.config || {}, payload.acceptedTokens || []);
    renderListings();
    renderSales(payload.salesRecent || []);
    renderActivity(payload.activityRecent || []);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    updatedAtEl.textContent = `Error: ${msg}`;
    indexedBlockEl.textContent = "Indexed Block: --";
    sourceAddrEl.textContent = "Contract: --";
    statsEl.innerHTML = "";
    protocolStateEl.innerHTML = "";
    listingsBodyEl.innerHTML = `<tr><td colspan="9">${msg}. Run: npm run index:puts</td></tr>`;
    salesBodyEl.innerHTML = "";
    activityBodyEl.innerHTML = "";
    countLabelEl.textContent = "Rows: 0";
  }
}

searchInputEl.addEventListener("input", renderListings);
collateralSelectEl.addEventListener("change", renderListings);
sortSelectEl.addEventListener("change", renderListings);
listingsBodyEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest(".buy-btn");
  if (!(button instanceof HTMLButtonElement)) return;
  const tokenId = button.getAttribute("data-token-id");
  if (!tokenId) return;
  const row = visibleListingMap.get(String(tokenId));
  if (!row) return;
  openBuyModal(row);
});
buyModalCloseEl.addEventListener("click", closeBuyModal);
buyModalBackdropEl.addEventListener("click", (event) => {
  if (event.target === buyModalBackdropEl) closeBuyModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !buyModalBackdropEl.hidden) closeBuyModal();
});

loadDashboard();
