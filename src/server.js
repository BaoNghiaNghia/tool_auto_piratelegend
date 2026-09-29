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
let jobRevision = 1;
let sessionRecovery = { running: false, recovered: 0, checked: 0, total: 0 };

function baseHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...baseHeaders(),
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}

function mutationOriginAllowed(req) {
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    return parsed.protocol === "http:" && loopback && port === PORT;
  } catch {
    return false;
  }
}

function readBody(req, maxBytes = 5_000_000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    let settled = false;

    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new Error("Request body is too large"));
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON body")); }
    });

    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function accountView(account) {
  return { ...account, running: chrome.isRunning(account.id), job: jobs.get(account.id) || null };
}

function stateRevision() {
  return `${STARTED_AT}:${store.revision}:${jobRevision}:${chrome.revision}`;
}

function stateView() {
  const snapshot = store.snapshot({ logLimit: 100 });
  return {
    revision: stateRevision(),
    startedAt: STARTED_AT,
    accounts: snapshot.accounts.map(accountView),
    logs: snapshot.logs,
    system: store.storageStats(),
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
  jobRevision += 1;

  Promise.resolve()
    .then(task)
    .then((result) => {
      jobs.set(account.id, { ...job, state: "DONE", result, finishedAt: new Date().toISOString() });
      jobRevision += 1;
    })
    .catch((error) => {
      store.updateAccount(account.id, { status: "ERROR", lastError: error.message });
      store.log(account.id, "ERROR", error.message);
      jobs.set(account.id, { ...job, state: "ERROR", error: error.message, finishedAt: new Date().toISOString() });
      jobRevision += 1;
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
    : ext === ".webp" ? "image/webp"
    : ext === ".png" ? "image/png"
    : ext === ".ico" ? "image/x-icon"
    : "application/octet-stream";
  res.writeHead(200, { ...baseHeaders(), "content-type": type, "cache-control": "no-cache" });
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

    if (["POST", "PATCH", "DELETE"].includes(req.method) && !mutationOriginAllowed(req)) {
      return json(res, 403, { error: "Cross-origin local API mutation blocked" });
    }

    if (pathname.startsWith("/api/")) {
      const passiveRead = req.method === "GET" && (pathname === "/api/state" || pathname === "/api/health");
      if (passiveRead) {
        chrome.refreshLiveness(5000).catch(() => {});
      } else {
        await chrome.refreshLiveness(0);
      }
    }

    if (req.method === "GET" && pathname === "/api/health") {
      const snapshot = store.snapshot({ includeLogs: false });
      const storage = store.storageStats();
      const runningJobs = [...jobs.values()].filter((job) => job.state === "RUNNING").length;
      return json(res, 200, {
        ok: true,
        startedAt: STARTED_AT,
        uptimeSeconds: Math.floor(process.uptime()),
        schemaVersion: snapshot.schemaVersion || 1,
        accountCount: snapshot.accounts.length,
        mainCount: snapshot.accounts.filter((account) => account.role === "MAIN").length,
        subCount: snapshot.accounts.filter((account) => account.role === "SUB").length,
        chromeSessions: chrome.sessions.size,
        runningJobs,
        activityCount: storage.activityCount,
        stateFileBytes: storage.stateFileBytes,
        activityFileBytes: storage.activityFileBytes,
        activityWriteError: storage.activityWriteError,
        sessionRecovery,
      });
    }

    if (req.method === "GET" && pathname === "/api/state") {
      const revision = stateRevision();
      if (parsed.searchParams.get("revision") === revision) {
        return json(res, 200, { unchanged: true, revision });
      }
      return json(res, 200, stateView());
    }

    if (req.method === "GET" && pathname === "/api/config/export") {
      return json(res, 200, store.exportConfig());
    }

    if (req.method === "POST" && pathname === "/api/chrome/close-idle") {
      const ids = [...chrome.sessions.keys()];
      let closed = 0;
      let skippedBusy = 0;
      const batchSize = 6;

      for (let offset = 0; offset < ids.length; offset += batchSize) {
        const batch = ids.slice(offset, offset + batchSize);
        const results = await Promise.all(batch.map(async (id) => {
          if (isBusy(id)) return "busy";
          return await chrome.close(id) ? "closed" : "missing";
        }));
        closed += results.filter((result) => result === "closed").length;
        skippedBusy += results.filter((result) => result === "busy").length;
      }

      return json(res, 200, { ok: true, closed, skippedBusy });
    }

    if (req.method === "POST" && pathname === "/api/config/restore") {
      const runningJobs = [...jobs.values()].some((job) => job.state === "RUNNING");
      if (runningJobs) return json(res, 409, { error: "Wait for running jobs to finish before restoring a backup" });
      if (chrome.sessions.size > 0) return json(res, 409, { error: "Close all managed Chrome profiles before restoring a backup" });
      const body = await readBody(req);
      const result = store.restoreConfig(body);
      jobs.clear();
      jobRevision += 1;
      return json(res, 200, { ok: true, ...result });
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

      if (req.method === "POST" && action === "inspect") {
        startJob(account, "INSPECT", () => pirate.inspect(account));
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

async function recoverExistingChromeSessions(batchSize = 12) {
  const accounts = store.snapshot({ includeLogs: false }).accounts;
  sessionRecovery = {
    running: true,
    recovered: 0,
    checked: 0,
    total: accounts.length,
  };

  try {
    for (let offset = 0; offset < accounts.length; offset += batchSize) {
      const batch = accounts.slice(offset, offset + batchSize);
      await Promise.all(batch.map(async (account) => {
        try {
          const current = store.getAccount(account.id);
          if (!current) return;
          const session = await chrome.attachIfRunning(current);
          if (session) sessionRecovery.recovered += 1;
        } catch {}
        finally {
          sessionRecovery.checked += 1;
        }
      }));
    }
  } finally {
    sessionRecovery.running = false;
  }

  if (sessionRecovery.recovered) {
    console.log(`[PirateLegend] Reattached ${sessionRecovery.recovered} Chrome profile(s)`);
  }
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Pirate Legend Automation: http://127.0.0.1:${PORT}`);
  console.log(`Project: ${ROOT}`);
});

recoverExistingChromeSessions().catch((error) => {
  sessionRecovery.running = false;
  console.error("[PirateLegend] Session recovery failed:", error.message);
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
  console.log("[PirateLegend] Leaving managed Chrome windows open for session recovery.");
  chrome.detachForServerShutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
