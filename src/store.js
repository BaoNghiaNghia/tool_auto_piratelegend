const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function normalizeProfilePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return path.resolve(raw);
}

function isPirateLegendUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && /(^|\.)piratelegend\.vn$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

class Store {
  constructor(rootDir) {
    this.dataDir = path.join(rootDir, "data");
    this.file = path.join(this.dataDir, "state.json");
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.state = this.#load();
  }

  #load() {
    if (!fs.existsSync(this.file)) {
      return { schemaVersion: 1, accounts: [], logs: [] };
    }

    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      const now = new Date().toISOString();

      const accounts = (Array.isArray(parsed.accounts) ? parsed.accounts : [])
        .filter((account) => account && typeof account.id === "string" && account.id)
        .map((account) => ({
          id: account.id,
          label: String(account.label || "").trim() || "Unnamed profile",
          role: account.role === "SUB" ? "SUB" : "MAIN",
          profilePath: String(account.profilePath || "").trim(),
          parentMainId: String(account.parentMainId || "").trim(),
          referralUrl: String(account.referralUrl || "").trim(),
          status: String(account.status || "READY"),
          turns: Number.isFinite(account.turns) ? account.turns : null,
          lastError: String(account.lastError || ""),
          createdAt: account.createdAt || now,
          updatedAt: account.updatedAt || now,
        }));

      const mainIds = new Set(accounts.filter((account) => account.role === "MAIN").map((account) => account.id));
      for (const account of accounts) {
        if (account.role === "MAIN") {
          account.parentMainId = "";
        } else if (!mainIds.has(account.parentMainId)) {
          account.parentMainId = "";
          account.status = "NEEDS_MAIN";
        }
      }

      const logs = (Array.isArray(parsed.logs) ? parsed.logs : [])
        .filter((log) => log && typeof log.id === "string" && typeof log.accountId === "string")
        .slice(0, 500);

      return { schemaVersion: 1, accounts, logs };
    } catch {
      try {
        const backup = path.join(this.dataDir, `state.corrupt-${Date.now()}.json`);
        fs.copyFileSync(this.file, backup);
      } catch {}
      return { schemaVersion: 1, accounts: [], logs: [] };
    }
  }

  #validateAccount(input, currentId = "") {
    const role = input.role === "SUB" ? "SUB" : input.role === "MAIN" ? "MAIN" : null;
    if (!role) throw new Error("Role must be MAIN or SUB");

    const label = String(input.label || "").trim();
    if (!label) throw new Error("Profile name is required");

    const profilePath = normalizeProfilePath(input.profilePath);
    if (profilePath) {
      const normalized = profilePath.toLowerCase();
      const duplicate = this.state.accounts.find((account) =>
        account.id !== currentId &&
        normalizeProfilePath(account.profilePath).toLowerCase() === normalized
      );
      if (duplicate) {
        throw new Error(`Chrome profile path is already used by: ${duplicate.label}`);
      }
    }

    const parentMainId = role === "SUB" ? String(input.parentMainId || "").trim() : "";
    if (role === "SUB") {
      const parent = this.getAccount(parentMainId);
      if (!parent || parent.role !== "MAIN") throw new Error("SUB must be assigned to a valid MAIN profile");
    }

    const referralUrl = role === "MAIN" ? String(input.referralUrl || "").trim() : "";
    if (!isPirateLegendUrl(referralUrl)) {
      throw new Error("Referral URL must be an HTTPS piratelegend.vn URL");
    }

    return { label, role, profilePath, parentMainId, referralUrl };
  }

  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  exportConfig() {
    return {
      format: "piratelegend-profile-config",
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: this.state.accounts.map((account) => ({
        id: account.id,
        label: account.label,
        role: account.role,
        profilePath: account.profilePath,
        parentMainId: account.parentMainId,
        referralUrl: account.referralUrl,
      })),
    };
  }

  restoreConfig(payload) {
    if (!payload || payload.format !== "piratelegend-profile-config" || payload.version !== 1) {
      throw new Error("Unsupported backup format");
    }
    if (!Array.isArray(payload.accounts)) throw new Error("Backup accounts must be an array");
    if (payload.accounts.length > 5000) throw new Error("Backup contains too many accounts");

    const now = new Date().toISOString();
    const seenIds = new Set();
    const seenPaths = new Map();
    const staged = payload.accounts.map((input, index) => {
      const id = String(input?.id || "").trim() || crypto.randomUUID();
      if (seenIds.has(id)) throw new Error(`Duplicate account id at backup row ${index + 1}`);
      seenIds.add(id);

      const role = input?.role === "SUB" ? "SUB" : input?.role === "MAIN" ? "MAIN" : null;
      if (!role) throw new Error(`Invalid role at backup row ${index + 1}`);

      const label = String(input?.label || "").trim();
      if (!label) throw new Error(`Missing profile name at backup row ${index + 1}`);

      const profilePath = normalizeProfilePath(input?.profilePath);
      if (profilePath) {
        const key = profilePath.toLowerCase();
        if (seenPaths.has(key)) {
          throw new Error(`Duplicate Chrome profile path: ${profilePath}`);
        }
        seenPaths.set(key, id);
      }

      const referralUrl = role === "MAIN" ? String(input?.referralUrl || "").trim() : "";
      if (!isPirateLegendUrl(referralUrl)) {
        throw new Error(`Invalid referral URL for ${label}`);
      }

      return {
        id,
        label,
        role,
        profilePath,
        parentMainId: role === "SUB" ? String(input?.parentMainId || "").trim() : "",
        referralUrl,
        status: "READY",
        turns: null,
        lastError: "",
        createdAt: now,
        updatedAt: now,
      };
    });

    const mainIds = new Set(staged.filter((account) => account.role === "MAIN").map((account) => account.id));
    for (const account of staged) {
      if (account.role === "SUB" && !mainIds.has(account.parentMainId)) {
        throw new Error(`SUB ${account.label} references a missing MAIN`);
      }
    }

    let backupFile = null;
    if (fs.existsSync(this.file)) {
      backupFile = path.join(this.dataDir, `state.before-restore-${Date.now()}.json`);
      fs.copyFileSync(this.file, backupFile);

      const backups = fs.readdirSync(this.dataDir)
        .filter((name) => /^state\.before-restore-\d+\.json$/.test(name))
        .sort()
        .reverse();
      for (const oldBackup of backups.slice(10)) {
        try { fs.rmSync(path.join(this.dataDir, oldBackup), { force: true }); } catch {}
      }
    }

    this.state = {
      schemaVersion: 1,
      accounts: staged,
      logs: [],
    };
    this.save();
    return {
      accountCount: staged.length,
      mainCount: staged.filter((account) => account.role === "MAIN").length,
      subCount: staged.filter((account) => account.role === "SUB").length,
      backupFile: backupFile ? path.basename(backupFile) : null,
    };
  }

  getAccount(id) {
    return this.state.accounts.find((account) => account.id === id) || null;
  }

  addAccount(input) {
    const now = new Date().toISOString();
    const valid = this.#validateAccount(input);
    const account = {
      id: crypto.randomUUID(),
      ...valid,
      status: "READY",
      turns: null,
      lastError: "",
      createdAt: now,
      updatedAt: now,
    };
    this.state.accounts.push(account);
    this.save();
    this.log(account.id, "INFO", "Account created");
    return account;
  }

  updateAccount(id, patch) {
    const account = this.getAccount(id);
    if (!account) return null;

    const configKeys = ["label", "role", "profilePath", "parentMainId", "referralUrl"];
    const configChanged = configKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));

    if (configChanged) {
      const next = {
        label: Object.prototype.hasOwnProperty.call(patch, "label") ? patch.label : account.label,
        role: Object.prototype.hasOwnProperty.call(patch, "role") ? patch.role : account.role,
        profilePath: Object.prototype.hasOwnProperty.call(patch, "profilePath") ? patch.profilePath : account.profilePath,
        parentMainId: Object.prototype.hasOwnProperty.call(patch, "parentMainId") ? patch.parentMainId : account.parentMainId,
        referralUrl: Object.prototype.hasOwnProperty.call(patch, "referralUrl") ? patch.referralUrl : account.referralUrl,
      };

      const valid = this.#validateAccount(next, id);
      if (account.role === "MAIN" && valid.role === "SUB") {
        const child = this.state.accounts.find((item) => item.parentMainId === id);
        if (child) throw new Error(`Cannot change MAIN to SUB while ${child.label} is assigned to it`);
      }
      Object.assign(account, valid);
    }

    for (const key of ["status", "turns", "lastError"]) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) account[key] = patch[key];
    }
    account.updatedAt = new Date().toISOString();
    this.save();
    return account;
  }

  deleteAccount(id) {
    const before = this.state.accounts.length;
    this.state.accounts = this.state.accounts.filter((account) => account.id !== id);
    this.state.accounts.forEach((account) => {
      if (account.parentMainId === id) {
        account.parentMainId = "";
        account.status = "NEEDS_MAIN";
        account.updatedAt = new Date().toISOString();
      }
    });
    this.state.logs = this.state.logs.filter((log) => log.accountId !== id);
    if (this.state.accounts.length !== before) this.save();
    return this.state.accounts.length !== before;
  }

  log(accountId, level, message, meta = null) {
    this.state.logs.unshift({
      id: crypto.randomUUID(),
      accountId,
      level,
      message,
      meta,
      at: new Date().toISOString(),
    });
    this.state.logs = this.state.logs.slice(0, 500);
    this.save();
  }
}

module.exports = { Store, isPirateLegendUrl, normalizeProfilePath };
