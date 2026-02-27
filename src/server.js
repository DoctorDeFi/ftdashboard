import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const publicDir = path.resolve(process.cwd(), "public");
const RPC_ENDPOINTS = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  sonic: "https://rpc.soniclabs.com",
  bsc: "https://bsc-rpc.publicnode.com",
  avalanche: "https://avalanche-c-chain-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com"
};
const JSONRPC_BLOCKNUMBER_PAYLOAD = JSON.stringify({
  jsonrpc: "2.0",
  method: "eth_blockNumber",
  params: [],
  id: 1
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const reqPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path
    .normalize(reqPath)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/[?#].*$/, "");
  const filePath = path.resolve(publicDir, `.${safePath}`);
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "forbidden" });
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath);
  const contentType =
    ext === ".html"
      ? "text/html"
      : ext === ".css"
        ? "text/css"
        : "application/javascript";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store, max-age=0"
  });
  res.end(fs.readFileSync(filePath));
  return true;
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("request_too_large"));
      }
    });
    req.on("end", () => resolve(data || "{}"));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS" && req.url?.startsWith("/rpc/")) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/api/health")) {
      sendJson(res, 200, { ok: true, service: "ft-onchain-dashboard" });
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/api/rpc-health")) {
      const checks = await Promise.all(
        Object.entries(RPC_ENDPOINTS).map(async ([chain, endpoint]) => {
          try {
            const upstream = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSONRPC_BLOCKNUMBER_PAYLOAD
            });
            const text = await upstream.text();
            let body = null;
            try {
              body = JSON.parse(text);
            } catch {
              body = { raw: text.slice(0, 500) };
            }
            const ok = upstream.ok && Boolean(body?.result);
            return {
              chain,
              endpoint,
              ok,
              status: upstream.status,
              blockNumber: body?.result || null,
              error: body?.error || null
            };
          } catch (error) {
            return {
              chain,
              endpoint,
              ok: false,
              status: 0,
              blockNumber: null,
              error: error instanceof Error ? error.message : String(error)
            };
          }
        })
      );

      sendJson(res, 200, {
        ok: checks.every((x) => x.ok),
        checks
      });
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/rpc/")) {
      const chainKey = req.url.replace("/rpc/", "").split("?")[0];
      const endpoint = RPC_ENDPOINTS[chainKey];
      if (!endpoint) {
        sendJson(res, 404, { error: "unknown_chain" });
        return;
      }

      const body = await readRequestBody(req);
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(text);
      return;
    }

    if (serveStatic(req, res)) return;
    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: "internal_server_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`FT onchain dashboard running on http://localhost:${config.port}`);
});
