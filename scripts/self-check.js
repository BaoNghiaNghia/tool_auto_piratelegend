const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store, isPirateLegendUrl } = require("../src/store");
const { ChromeManager } = require("../src/chrome-manager");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
const major = Number(process.versions.node.split(".")[0]);
assert(major >= 22, `Node.js 22+ is required. Current: ${process.versions.node}`);

const uiPath = path.resolve(__dirname, "../public/index.html");
const uiHtml = fs.readFileSync(uiPath, "utf8");
const inlineScript = uiHtml.match(/<script>([\s\S]*?)<\/script>/i);
assert(inlineScript, "UI inline script was not found");
new Function(inlineScript[1]);
assert(uiHtml.includes('id="accounts"'), "UI accounts root is missing");
assert(uiHtml.includes('id="profileForm"'), "UI profile form is missing");

assert(isPirateLegendUrl("https://sukien.piratelegend.vn/teaser?ref=abc"), "Valid Pirate Legend URL rejected");
assert(!isPirateLegendUrl("http://sukien.piratelegend.vn/teaser?ref=abc"), "HTTP referral URL must be rejected");
assert(!isPirateLegendUrl("https://example.com/ref=abc"), "Foreign referral URL must be rejected");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "piratelegend-selfcheck-"));
try {
  const store = new Store(temp);
  const main = store.addAccount({
    label: "Main test",
    role: "MAIN",
    profilePath: path.join(temp, "profile-main"),
    referralUrl: "https://sukien.piratelegend.vn/teaser?ref=test",
  });

  const sub = store.addAccount({
    label: "Sub test",
    role: "SUB",
    profilePath: path.join(temp, "profile-sub"),
    parentMainId: main.id,
  });

  assert(store.getAccount(main.id)?.role === "MAIN", "MAIN account persistence failed");
  assert(store.getAccount(sub.id)?.parentMainId === main.id, "SUB to MAIN relation failed");

  store.deleteAccount(main.id);
  assert(store.getAccount(sub.id)?.status === "NEEDS_MAIN", "Orphan SUB state was not set");
  store.updateAccount(sub.id, { status: "ERROR", lastError: "self-check" });
  assert(store.getAccount(sub.id)?.status === "ERROR", "Runtime status update for orphan SUB failed");

  const main2 = store.addAccount({
    label: "Main test 2",
    role: "MAIN",
    profilePath: path.join(temp, "profile-main-2"),
  });
  store.updateAccount(sub.id, { parentMainId: main2.id });
  assert(store.getAccount(sub.id)?.parentMainId === main2.id, "Reassigning SUB to MAIN failed");

  let duplicateRejected = false;
  try {
    store.addAccount({
      label: "Duplicate",
      role: "MAIN",
      profilePath: path.join(temp, "profile-main-2"),
    });
  } catch {
    duplicateRejected = true;
  }
  assert(duplicateRejected, "Duplicate Chrome profile path was not rejected");

  const reopened = new Store(temp);
  assert(reopened.snapshot().schemaVersion === 1, "State schema version was not restored");
  assert(reopened.getAccount(main2.id)?.label === "Main test 2", "Persisted account could not be reopened");

  const exported = reopened.exportConfig();
  assert(exported.format === "piratelegend-profile-config", "Config export format is invalid");
  assert(exported.version === 1, "Config export version is invalid");
  assert(exported.accounts.length === 2, "Config export account count is invalid");

  const restoreRoot = path.join(temp, "restore");
  const restoreStore = new Store(restoreRoot);
  restoreStore.addAccount({ label: "Old config", role: "MAIN" });
  const restoreResult = restoreStore.restoreConfig(exported);
  assert(restoreResult.mainCount === 1 && restoreResult.subCount === 1, "Config restore counts are invalid");
  assert(restoreStore.getAccount(main2.id)?.label === "Main test 2", "MAIN was not restored");
  assert(restoreStore.getAccount(sub.id)?.parentMainId === main2.id, "SUB mapping was not restored");
  assert(restoreResult.backupFile, "Restore safety backup was not created");
  assert(fs.existsSync(path.join(restoreRoot, "data", restoreResult.backupFile)), "Restore safety backup file is missing");

  for (let i = 0; i < 12; i += 1) {
    fs.writeFileSync(
      path.join(restoreRoot, "data", `state.before-restore-${1000 + i}.json`),
      "{}",
      "utf8"
    );
  }
  restoreStore.restoreConfig(exported);
  const retainedBackups = fs.readdirSync(path.join(restoreRoot, "data"))
    .filter(name => /^state\.before-restore-\d+\.json$/.test(name));
  assert(retainedBackups.length <= 10, "Restore safety backups were not pruned");

  let invalidRestoreRejected = false;
  try {
    restoreStore.restoreConfig({
      format: "piratelegend-profile-config",
      version: 1,
      accounts: [{
        id: "broken-sub",
        label: "Broken Sub",
        role: "SUB",
        parentMainId: "missing-main"
      }]
    });
  } catch {
    invalidRestoreRejected = true;
  }
  assert(invalidRestoreRejected, "Invalid SUB mapping backup was not rejected");
  assert(restoreStore.getAccount(main2.id)?.label === "Main test 2", "Failed restore mutated the active config");

  const legacyRoot = path.join(temp, "legacy");
  fs.mkdirSync(path.join(legacyRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "data", "state.json"), JSON.stringify({
    accounts: [{
      id: "legacy-sub",
      label: "Legacy Sub",
      role: "SUB",
      parentMainId: "missing-main"
    }],
    logs: []
  }), "utf8");
  const legacyStore = new Store(legacyRoot);
  assert(legacyStore.snapshot().schemaVersion === 1, "Legacy state was not migrated");
  assert(legacyStore.getAccount("legacy-sub")?.status === "NEEDS_MAIN", "Legacy orphan SUB was not normalized");

  const corruptRoot = path.join(temp, "corrupt");
  fs.mkdirSync(path.join(corruptRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(corruptRoot, "data", "state.json"), "{not-json", "utf8");
  const corruptStore = new Store(corruptRoot);
  assert(corruptStore.snapshot().accounts.length === 0, "Corrupt state did not fall back safely");
  const backups = fs.readdirSync(path.join(corruptRoot, "data")).filter(name => name.startsWith("state.corrupt-"));
  assert(backups.length === 1, "Corrupt state backup was not created");

  const chrome = new ChromeManager(temp);
  let unrefCalls = 0;
  chrome.sessions.set("alive", {
    port: 10001,
    profilePath: path.join(temp, "alive"),
    child: { unref() { unrefCalls += 1; } },
  });
  chrome.sessions.set("dead", {
    port: 10002,
    profilePath: path.join(temp, "dead"),
    child: null,
  });

  const originalFetch = global.fetch;
  global.fetch = async (url) => ({
    ok: String(url).includes(":10001/"),
  });
  try {
    await chrome.refreshLiveness(0);
  } finally {
    global.fetch = originalFetch;
  }
  assert(chrome.isRunning("alive"), "Live Chrome session was pruned incorrectly");
  assert(!chrome.isRunning("dead"), "Dead Chrome session was not pruned");

  chrome.detachForServerShutdown();
  assert(unrefCalls === 1, "Managed Chrome child was not detached on server shutdown");

  console.log("[self-check] Node, UI, storage, migration, Chrome liveness, validation: OK");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
}

main().catch((error) => {
  console.error("[self-check]", error);
  process.exitCode = 1;
});
