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

  const stateOnDisk = JSON.parse(fs.readFileSync(path.join(temp, "data", "state.json"), "utf8"));
  assert(!Object.prototype.hasOwnProperty.call(stateOnDisk, "logs"), "Activity logs should not be embedded in state.json");
  assert(fs.existsSync(path.join(temp, "data", "activity.jsonl")), "Activity log file was not created");

  const reopened = new Store(temp);
  assert(reopened.snapshot().schemaVersion === 1, "State schema version was not restored");
  assert(reopened.getAccount(main2.id)?.label === "Main test 2", "Persisted account could not be reopened");
  assert(reopened.snapshot().logs.length > 0, "Activity logs were not restored from activity.jsonl");

  const revisionBeforeLog = reopened.revision;
  const stateBeforeActivity = fs.readFileSync(path.join(temp, "data", "state.json"), "utf8");
  reopened.log(main2.id, "INFO", "Activity persistence check");
  const stateAfterActivity = fs.readFileSync(path.join(temp, "data", "state.json"), "utf8");
  assert(reopened.revision > revisionBeforeLog, "Store revision did not advance after activity log");
  assert(stateAfterActivity === stateBeforeActivity, "Activity logging rewrote state.json");
  const reopenedAfterLog = new Store(temp);
  assert(
    reopenedAfterLog.snapshot().logs.some(log => log.message === "Activity persistence check"),
    "Appended activity did not survive Store restart"
  );

  const activityStats = reopened.storageStats();
  assert(activityStats.activityCount > 0, "Activity count stats are invalid");
  assert(activityStats.stateFileBytes > 0, "State file size stats are invalid");
  assert(activityStats.activityFileBytes > 0, "Activity file size stats are invalid");

  const spamRoot = path.join(temp, "activity-spam");
  const spamStore = new Store(spamRoot);
  for (let i = 0; i < 620; i += 1) {
    spamStore.log("spam-account", "INFO", `Spam log ${i}`);
  }
  assert(spamStore.snapshot().logs.length === 500, "In-memory activity retention exceeded 500");
  const spamReloaded = new Store(spamRoot);
  assert(spamReloaded.snapshot().logs.length === 500, "Activity retention after restart exceeded 500");
  const activityLines = fs.readFileSync(path.join(spamRoot, "data", "activity.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  assert(activityLines.length < 600, "Activity JSONL compaction did not bound the file");

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
  assert(restoreResult.activityBackupFile, "Restore activity backup was not created");
  assert(
    fs.existsSync(path.join(restoreRoot, "data", restoreResult.activityBackupFile)),
    "Restore activity backup file is missing"
  );

  for (let i = 0; i < 12; i += 1) {
    fs.writeFileSync(
      path.join(restoreRoot, "data", `state.before-restore-${1000 + i}.json`),
      "{}",
      "utf8"
    );
    fs.writeFileSync(
      path.join(restoreRoot, "data", `activity.before-restore-${1000 + i}.jsonl`),
      "{}\n",
      "utf8"
    );
  }
  restoreStore.restoreConfig(exported);
  const retainedBackups = fs.readdirSync(path.join(restoreRoot, "data"))
    .filter(name => /^state\.before-restore-\d+\.json$/.test(name));
  assert(retainedBackups.length <= 10, "Restore safety backups were not pruned");
  const retainedActivityBackups = fs.readdirSync(path.join(restoreRoot, "data"))
    .filter(name => /^activity\.before-restore-\d+\.jsonl$/.test(name));
  assert(retainedActivityBackups.length <= 10, "Restore activity backups were not pruned");

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
    logs: [{
      id: "legacy-log",
      accountId: "legacy-sub",
      level: "INFO",
      message: "Legacy activity",
      meta: null,
      at: new Date().toISOString()
    }]
  }), "utf8");
  const legacyStore = new Store(legacyRoot);
  assert(legacyStore.snapshot().schemaVersion === 1, "Legacy state was not migrated");
  assert(legacyStore.getAccount("legacy-sub")?.status === "NEEDS_MAIN", "Legacy orphan SUB was not normalized");
  assert(legacyStore.snapshot().logs.some(log => log.id === "legacy-log"), "Legacy activity log was not migrated");
  assert(fs.existsSync(path.join(legacyRoot, "data", "activity.jsonl")), "Legacy activity file was not created");
  const migratedState = JSON.parse(fs.readFileSync(path.join(legacyRoot, "data", "state.json"), "utf8"));
  assert(!Object.prototype.hasOwnProperty.call(migratedState, "logs"), "Legacy logs were not removed from state.json");

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

  const chromeRevisionBefore = chrome.revision;
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
  assert(chrome.revision > chromeRevisionBefore, "Chrome revision did not advance after pruning a dead session");

  chrome.detachForServerShutdown();
  assert(unrefCalls === 1, "Managed Chrome child was not detached on server shutdown");

  const batchChrome = new ChromeManager(temp);
  for (let i = 0; i < 25; i += 1) {
    batchChrome.sessions.set(`batch-${i}`, {
      port: 11000 + i,
      profilePath: path.join(temp, `batch-${i}`),
      child: null,
    });
  }

  let activeFetches = 0;
  let maxActiveFetches = 0;
  let totalFetches = 0;
  const fetchBeforeBatch = global.fetch;
  global.fetch = async () => {
    totalFetches += 1;
    activeFetches += 1;
    maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
    await new Promise(resolve => setTimeout(resolve, 3));
    activeFetches -= 1;
    return { ok: true };
  };
  try {
    await Promise.all([
      batchChrome.refreshLiveness(0, 5),
      batchChrome.refreshLiveness(0, 5),
    ]);
  } finally {
    global.fetch = fetchBeforeBatch;
  }
  assert(totalFetches === 25, "Overlapping liveness checks were not deduplicated");
  assert(maxActiveFetches <= 5, "Liveness batch concurrency exceeded the configured batch size");

  console.log("[self-check] Node, UI, storage, activity I/O, Chrome liveness, validation: OK");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
}

main().catch((error) => {
  console.error("[self-check]", error);
  process.exitCode = 1;
});
