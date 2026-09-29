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
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      return {
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      };
    } catch {
      return { accounts: [], logs: [] };
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
