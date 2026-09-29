const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { Store } = require("./store");
const { ChromeManager } = require("./chrome-manager");
const { PirateLegendAutomation } = require("./piratelegend");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3210);
const STARTED_AT = new Date().toISOString();

const store = new Store(ROOT);
const chrome = new ChromeManager(ROOT);
const pirate = new PirateLegendAutomation(store, chrome);
const jobs = new Map();

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function accountView(account) {
  return { ...account, running: chrome.isRunning(account.id), job: jobs.get(account.id) || null };
}

function stateView() {
  const snapshot = store.snapshot();
  return {
    startedAt: STARTED_AT,
    accounts: snapshot.accounts.map(accountView),
    logs: snapshot.logs,
  };
}

function isBusy(accountId) {
  return jobs.get(accountId)?.state === "RUNNING";
}

function startJob(account, name, task) {
  const existing = jobs.get(account.id);
  if (existing?.state === "RUNNING") throw new Error(`Account already running job: ${existing.name}`);
  const job = { name, state: "RUNNING", startedAt: new Date().toISOString(), error: "" };
  jobs.set(account.id, job);

  Promise.resolve()
    .then(task)
    .then((result) => {
      jobs.set(account.id, { ...job, state: "DONE", result, finishedAt: new Date().toISOString() });
    })
    .catch((error) => {
      store.updateAccount(account.id, { status: "ERROR", lastError: error.message });
      store.log(account.id, "ERROR", error.message);
      jobs.set(account.id, { ...job, state: "ERROR", error: error.message, finishedAt: new Date().toISOString() });
    });

  return job;
}

function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const file = path.resolve(PUBLIC, relative);
  const insidePublic = file === PUBLIC || file.startsWith(PUBLIC + path.sep);
  if (!insidePublic || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  const type = ext === ".html" ? "text/html; charset=utf-8"
    : ext === ".css" ? "text/css; charset=utf-8"
    : ext === ".js" ? "application/javascript; charset=utf-8"
    : "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = parsed.pathname;

  try {
    if (req.method === "GET" && pathname === "/favicon.ico") {
      res.writeHead(204, { "cache-control": "public, max-age=86400" });
      return res.end();
    }

    if (req.method === "GET" && pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        startedAt: STARTED_AT,
        accountCount: store.snapshot().accounts.length,
      });
    }

    if (req.method === "GET" && pathname === "/api/state") {
      return json(res, 200, stateView());
    }

    if (req.method === "POST" && pathname === "/api/accounts") {
      const body = await readBody(req);
      const account = store.addAccount(body);
      return json(res, 201, accountView(account));
    }

    const accountMatch = pathname.match(/^\/api\/accounts\/([^/]+)(?:\/(.+))?$/);
    if (accountMatch) {
      const id = decodeURIComponent(accountMatch[1]);
      const action = accountMatch[2] || "";
      const account = store.getAccount(id);
      if (!account) return json(res, 404, { error: "Account not found" });

      if (req.method === "PATCH" && !action) {
        if (isBusy(id)) return json(res, 409, { error: "Cannot edit a profile while a job is running" });
        if (chrome.isRunning(id)) return json(res, 409, { error: "Close this Chrome profile before editing its configuration" });
        const body = await readBody(req);
        return json(res, 200, accountView(store.updateAccount(id, body)));
      }

      if (req.method === "DELETE" && !action) {
        if (isBusy(id)) return json(res, 409, { error: "Cannot delete a profile while a job is running" });
        await chrome.close(id);
        store.deleteAccount(id);
        jobs.delete(id);
        return json(res, 200, { ok: true });
      }

      if (req.method === "POST" && action === "open") {
        startJob(account, "OPEN", () => pirate.open(account));
        return json(res, 202, { ok: true });
      }

      if (req.method === "POST" && action === "close") {
        if (isBusy(id)) return json(res, 409, { error: "Wait for the current job to finish before closing this profile" });
        await chrome.close(id);
        store.updateAccount(id, { status: "READY", lastError: "" });
        return json(res, 200, { ok: true });
      }

      if (req.method === "POST" && action === "flow1") {
        startJob(account, "FLOW1", () => pirate.flow1(account));
        return json(res, 202, { ok: true });
      }

      if (req.method === "POST" && action === "capture-referral") {
        startJob(account, "CAPTURE_REFERRAL", () => pirate.captureReferral(account));
        return json(res, 202, { ok: true });
      }

      if (req.method === "POST" && action === "open-referral") {
        startJob(account, "OPEN_REFERRAL", () => pirate.openSubReferral(account));
        return json(res, 202, { ok: true });
      }

      if (req.method === "POST" && action === "read-turns") {
        startJob(account, "READ_TURNS", () => pirate.refreshTurns(account));
        return json(res, 202, { ok: true });
      }

      if (req.method === "POST" && action === "flow2") {
        startJob(account, "FLOW2", () => pirate.flow2(account));
        return json(res, 202, { ok: true });
      }

      return json(res, 404, { error: "Unknown account action" });
    }

    if (req.method === "GET" && serveStatic(req, res, pathname)) return;
    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 400, { error: error.message || String(error) });
  }
});

async function recoverExistingChromeSessions() {
  let recovered = 0;
  const accounts = store.snapshot().accounts;
  for (const account of accounts) {
    try {
      const session = await chrome.attachIfRunning(account);
      if (session) recovered += 1;
    } catch {}
  }
  if (recovered) console.log(`[PirateLegend] Reattached ${recovered} Chrome profile(s)`);
}

recoverExistingChromeSessions()
  .catch(() => {})
  .finally(() => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`Pirate Legend Automation: http://127.0.0.1:${PORT}`);
      console.log(`Project: ${ROOT}`);
    });
  });

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Close the existing Pirate Legend tool window or set another PORT.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[PirateLegend] Shutting down (${signal})...`);
  const ids = [...chrome.sessions.keys()];
  await Promise.allSettled(ids.map((id) => chrome.close(id)));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
