/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const https = require("https");
const httpProxy = require("http-proxy");

const certPath =
  process.env.TLS_CERT_PATH ||
  "/etc/letsencrypt/live/pd.lu.im.ntu.edu.tw/fullchain.pem";
const keyPath =
  process.env.TLS_KEY_PATH ||
  "/etc/letsencrypt/live/pd.lu.im.ntu.edu.tw/privkey.pem";
const upstream = process.env.TLS_UPSTREAM || "http://127.0.0.1:3000";
const port = Number(process.env.TLS_PORT || 443);

function readTlsFile(path) {
  try {
    return fs.readFileSync(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[tls-gateway] failed to read ${path}: ${message}`);
    process.exit(1);
  }
}

const proxy = httpProxy.createProxyServer({
  target: upstream,
  changeOrigin: true,
  ws: true,
});

proxy.on("error", (error, req, res) => {
  console.error(`[tls-gateway] proxy error: ${error.message}`);
  if (res && typeof res.writeHead === "function") {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad gateway");
  }
});

const server = https.createServer(
  {
    cert: readTlsFile(certPath),
    key: readTlsFile(keyPath),
  },
  (req, res) => {
    proxy.web(req, res);
  }
);

server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[tls-gateway] listening on :${port}, proxying to ${upstream}`);
});
