const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3210);
const HOST = "127.0.0.1";
const URL = `http://${HOST}:${PORT}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHealth(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/health`, { timeout: timeoutMs }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 100_000) req.destroy();
      });
      res.on("end", () => {
        try {
          const body = JSON.parse(raw);
          resolve(Boolean(res.statusCode === 200 && body?.ok === true));
        } catch {
          resolve(false);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function isPortOpen(timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port: PORT });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function openBrowser() {
  if (process.env.PIRATELEGEND_NO_BROWSER === "1" || process.argv.includes("--no-browser")) return;

  try {
    const child = spawn(
      "cmd.exe",
      ["/d", "/s", "/c", `start "" "${URL}"`],
      { detached: true, stdio: "ignore", windowsHide: true }
    );
    child.unref();
  } catch {
    // Browser auto-open is optional. The URL is always printed below.
  }
}

async function waitForHealth(timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await getHealth(700)) return true;
    await delay(150);
  }
  return false;
}

async function main() {
  if (await getHealth()) {
    console.log(`[PirateLegend] Server is already running at ${URL}`);
    console.log("[PirateLegend] Reusing the existing instance.");
    openBrowser();
    return;
  }

  if (await isPortOpen()) {
    console.error(`[PirateLegend] Port ${PORT} is being used by another application.`);
    console.error(`[PirateLegend] PirateLegend health check did not respond at ${URL}/api/health`);
    console.error("[PirateLegend] Close the other application or set a different PORT.");
    process.exitCode = 1;
    return;
  }

  console.log(`[PirateLegend] Starting local tool at ${URL}`);
  console.log("[PirateLegend] Press Ctrl+C in this window to stop the server.");

  const child = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    windowsHide: false,
  });

  const healthy = await waitForHealth();
  if (healthy) openBrowser();

  child.on("exit", (code, signal) => {
    if (signal) process.exitCode = 0;
    else process.exitCode = Number.isInteger(code) ? code : 1;
  });

  const forwardSignal = (signal) => {
    try { child.kill(signal); } catch {}
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
}

main().catch((error) => {
  console.error("[PirateLegend] Launcher error:", error.message || error);
  process.exitCode = 1;
});
