const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { CdpClient } = require("./cdp");

const DEFAULT_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ChromeManager {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.defaultProfilesDir = path.join(rootDir, "chrome-profiles");
    fs.mkdirSync(this.defaultProfilesDir, { recursive: true });
    this.sessions = new Map();
    this.revision = 1;
    this.lastLivenessCheckAt = 0;
    this.livenessPromise = null;
  }

  #setSession(accountId, session) {
    const previous = this.sessions.get(accountId);
    this.sessions.set(accountId, session);
    if (previous !== session) this.revision += 1;
    return session;
  }

  #deleteSession(accountId, expected = null) {
    const current = this.sessions.get(accountId);
    if (!current) return false;
    if (expected && current !== expected) return false;
    this.sessions.delete(accountId);
    this.revision += 1;
    return true;
  }

  resolveProfilePath(account) {
    if (account.profilePath) return path.resolve(account.profilePath);
    return path.join(this.defaultProfilesDir, account.id);
  }

  #profileKey(profilePath) {
    return path.resolve(profilePath).toLowerCase();
  }

  #assertProfileAvailable(account, profilePath) {
    const wanted = this.#profileKey(profilePath);
    for (const [accountId, session] of this.sessions.entries()) {
      if (accountId === account.id) continue;
      if (this.#profileKey(session.profilePath) === wanted) {
        throw new Error("This Chrome profile directory is already running under another account");
      }
    }
  }

  async attachIfRunning(account) {
    const existing = this.sessions.get(account.id);
    if (existing) return existing;

    const profilePath = this.resolveProfilePath(account);
    this.#assertProfileAvailable(account, profilePath);
    const marker = path.join(profilePath, "DevToolsActivePort");

    try {
      const [portLine, browserPath] = fs.readFileSync(marker, "utf8").trim().split(/\r?\n/);
      const port = Number(portLine);
      if (!port || !browserPath) return null;

      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok) return null;

      const version = await response.json();
      const session = {
        port,
        browserWsUrl: version.webSocketDebuggerUrl || `ws://127.0.0.1:${port}${browserPath}`,
        child: null,
        profilePath,
      };
      this.#setSession(account.id, session);
      return session;
    } catch {
      return null;
    }
  }

  async launch(account, url) {
    const existing = this.sessions.get(account.id);
    if (existing) {
      try {
        await this.navigate(account.id, url);
        return existing;
      } catch {
        this.#deleteSession(account.id, existing);
      }
    }

    const profilePath = this.resolveProfilePath(account);
    this.#assertProfileAvailable(account, profilePath);
    fs.mkdirSync(profilePath, { recursive: true });

    const attached = await this.attachIfRunning(account);
    if (attached) {
      await this.navigate(account.id, url);
      return attached;
    }

    fs.rmSync(path.join(profilePath, "DevToolsActivePort"), { force: true });

    const executable = process.env.CHROME_PATH || DEFAULT_CHROME;
    if (!fs.existsSync(executable)) throw new Error(`Chrome not found: ${executable}`);

    const args = [
      `--user-data-dir=${profilePath}`,
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--new-window",
      url,
    ];

    const child = spawn(executable, args, {
      detached: false,
      stdio: "ignore",
      windowsHide: false,
    });

    let info;
    try {
      info = await this.#waitForDevTools(profilePath, child);
    } catch (error) {
      try { child.kill(); } catch {}
      throw error;
    }

    const session = { ...info, child, profilePath };
    this.sessions.set(account.id, session);

    child.once("exit", () => {
      const current = this.sessions.get(account.id);
      if (current?.child === child) this.#deleteSession(account.id, current);
    });

    return session;
  }

  async #waitForDevTools(profilePath, child) {
    const marker = path.join(profilePath, "DevToolsActivePort");
    for (let i = 0; i < 150; i += 1) {
      if (child.exitCode !== null) {
        throw new Error(
          `Chrome exited with code ${child.exitCode}. If this profile is already open in Chrome, close that window/profile and try again.`
        );
      }
      try {
        const [portLine, browserPath] = fs.readFileSync(marker, "utf8").trim().split(/\r?\n/);
        const port = Number(portLine);
        if (port && browserPath) {
          return {
            port,
            browserWsUrl: `ws://127.0.0.1:${port}${browserPath}`,
          };
        }
      } catch {}
      await sleep(100);
    }
    throw new Error("Timed out waiting for Chrome DevTools. Close any Chrome window using this profile and try again.");
  }

  async targets(accountId) {
    const session = this.sessions.get(accountId);
    if (!session) throw new Error("Chrome profile is not running");
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${session.port}/json/list`, {
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      this.#deleteSession(accountId, session);
      throw new Error("Chrome DevTools is no longer reachable");
    }
    if (!response.ok) throw new Error("Cannot query Chrome targets");
    return response.json();
  }

  async pageClient(accountId, timeoutMs = 8000, preferPirateLegend = true) {
    const started = Date.now();
    let target = null;
    let fallback = null;

    while (Date.now() - started < timeoutMs) {
      const targets = await this.targets(accountId);
      const pages = targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl);
      const preferred = pages.find((page) => page.url.includes("piratelegend.vn"));

      if (preferred) {
        target = preferred;
        break;
      }

      fallback = pages.find((page) =>
        page.url &&
        page.url !== "about:blank" &&
        !page.url.startsWith("chrome://")
      ) || pages[0] || fallback;

      if (!preferPirateLegend && fallback) {
        target = fallback;
        break;
      }
      await sleep(100);
    }

    target ||= fallback;
    if (!target) throw new Error("No Chrome page target found");

    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    return client;
  }

  async navigate(accountId, url) {
    const client = await this.pageClient(accountId, 2000, false);
    try {
      await client.send("Page.navigate", { url });
    } finally {
      client.close();
    }
  }

  async currentUrl(accountId) {
    const targets = await this.targets(accountId);
    const page = targets.find((target) => target.type === "page" && target.url.includes("piratelegend.vn"))
      || targets.find((target) => target.type === "page");
    return page?.url || "";
  }

  async close(accountId) {
    const session = this.sessions.get(accountId);
    if (!session) return false;
    try {
      const client = new CdpClient(session.browserWsUrl);
      await client.connect();
      await client.send("Browser.close", {}, 5000);
      client.close();
    } catch {
      try { session.child?.kill(); } catch {}
    }
    this.#deleteSession(accountId, session);
    return true;
  }

  async refreshLiveness(minIntervalMs = 5000, batchSize = 12) {
    if (this.livenessPromise) return this.livenessPromise;

    const now = Date.now();
    if (now - this.lastLivenessCheckAt < minIntervalMs) return;
    this.lastLivenessCheckAt = now;

    this.livenessPromise = (async () => {
      const entries = [...this.sessions.entries()];
      for (let offset = 0; offset < entries.length; offset += batchSize) {
        const batch = entries.slice(offset, offset + batchSize);
        await Promise.all(batch.map(async ([accountId, session]) => {
          try {
            const response = await fetch(`http://127.0.0.1:${session.port}/json/version`, {
              signal: AbortSignal.timeout(700),
            });
            if (!response.ok) throw new Error("DevTools unavailable");
          } catch {
            this.#deleteSession(accountId, session);
          }
        }));
      }
    })();

    try {
      await this.livenessPromise;
    } finally {
      this.livenessPromise = null;
    }
  }

  detachForServerShutdown() {
    for (const session of this.sessions.values()) {
      try { session.child?.unref(); } catch {}
    }
  }

  isRunning(accountId) {
    return this.sessions.has(accountId);
  }
}

module.exports = { ChromeManager, sleep };
