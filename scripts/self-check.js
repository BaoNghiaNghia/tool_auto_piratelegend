const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store, isPirateLegendUrl } = require("../src/store");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

  console.log("[self-check] Node, UI, storage, migration, validation: OK");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
