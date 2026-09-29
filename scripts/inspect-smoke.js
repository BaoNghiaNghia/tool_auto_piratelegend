const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../src/store");
const { ChromeManager, sleep } = require("../src/chrome-manager");
const { PirateLegendAutomation } = require("../src/piratelegend");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piratelegend-inspect-"));
  const store = new Store(root);
  const chrome = new ChromeManager(root);
  const pirate = new PirateLegendAutomation(store, chrome);
  const account = store.addAccount({
    label: "Inspect smoke",
    role: "MAIN",
    profilePath: path.join(root, "profile"),
  });

  try {
    const result = await pirate.inspect(account);
    if (!/piratelegend\.vn/i.test(result.url || "")) {
      throw new Error(`Unexpected page URL: ${result.url || "(empty)"}`);
    }
    if (typeof result.loginVisible !== "boolean") throw new Error("loginVisible must be boolean");
    if (typeof result.inviteMissionVisible !== "boolean") throw new Error("inviteMissionVisible must be boolean");
    if (!(result.turns === null || Number.isFinite(result.turns))) throw new Error("turns must be null or number");

    console.log("[inspect-smoke]", JSON.stringify({
      url: result.url,
      loginVisible: result.loginVisible,
      turns: result.turns,
      inviteMissionVisible: result.inviteMissionVisible,
      referralDetected: result.referralDetected,
    }));
  } finally {
    await chrome.close(account.id).catch(() => {});
    await sleep(700);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch((error) => {
  console.error("[inspect-smoke]", error.message);
  process.exitCode = 1;
});
