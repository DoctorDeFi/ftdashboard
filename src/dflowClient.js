import { config } from "./config.js";

const CRICKET_KEYWORDS = [
  "cricket",
  "ipl",
  "odi",
  "t20",
  "test match",
  "ashes",
  "bbl",
  "cpl"
];

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (config.dflowApiKey) headers.Authorization = `Bearer ${config.dflowApiKey}`;
  return headers;
}

async function getJson(base, endpoint, params = {}) {
  const url = new URL(endpoint, base);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    url.searchParams.set(k, String(v));
  });
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

function containsCricketText(value) {
  if (!value) return false;
  const text = String(value).toLowerCase();
  return CRICKET_KEYWORDS.some((kw) => text.includes(kw));
}

function isCricketEvent(event) {
  const haystack = [
    event?.title,
    event?.name,
    event?.description,
    event?.slug,
    event?.ticker
  ];
  return haystack.some((x) => containsCricketText(x));
}

function guessYesPrice(market) {
  const candidates = [
    market?.yes_price,
    market?.yesPrice,
    market?.best_yes_price,
    market?.bestYesPrice,
    market?.last_yes_price,
    market?.lastYesPrice,
    market?.price
  ].filter((x) => x !== undefined && x !== null);
  if (!candidates.length) return null;
  const raw = Number(candidates[0]);
  if (Number.isNaN(raw)) return null;
  if (raw <= 1) return raw * 100;
  return raw;
}

function normalizeMarket(eventTicker, market) {
  return {
    eventTicker,
    marketTicker: market?.ticker || market?.id || market?.slug || "unknown",
    title: market?.title || market?.name || market?.question || "Untitled market",
    closeTime: market?.close_time || market?.closeTime || null,
    yesPrice: guessYesPrice(market)
  };
}

function normalizeEvent(event) {
  const eventTicker = event?.ticker || event?.id || event?.slug || "unknown";
  const marketData = event?.markets || event?.contracts || [];
  const markets = Array.isArray(marketData)
    ? marketData.map((m) => normalizeMarket(eventTicker, m))
    : [];

  return {
    ticker: eventTicker,
    title: event?.title || event?.name || "Untitled event",
    closeTime: event?.close_time || event?.closeTime || null,
    status: event?.status || "unknown",
    tags: event?.tags || [],
    markets
  };
}

export async function getCricketSeries(limit = 50) {
  const data = await getJson(config.dflowMetadataBase, "/api/v1/series", {
    category: "Sports",
    tags: "Cricket",
    limit
  });

  const rows = data?.series || data?.items || data || [];
  if (!Array.isArray(rows)) return [];

  return rows.map((series) => ({
    ticker: series?.ticker || series?.id || series?.slug || "unknown",
    title: series?.title || series?.name || "Untitled series"
  }));
}

export async function getCricketEvents({ status = "active", limit = 40 } = {}) {
  let seriesTickers = [];
  try {
    const series = await getCricketSeries(100);
    seriesTickers = series.map((s) => s.ticker).filter(Boolean);
  } catch {
    // If series lookup fails, continue with broad event search and filter locally.
  }

  const data = await getJson(config.dflowMetadataBase, "/api/v1/events", {
    status,
    with_nested_markets: "true",
    series_tickers: seriesTickers.length ? seriesTickers.join(",") : undefined,
    limit
  });

  const rows = data?.events || data?.items || data || [];
  if (!Array.isArray(rows)) return [];

  return rows.filter(isCricketEvent).map(normalizeEvent);
}
