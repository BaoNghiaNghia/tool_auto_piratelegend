const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ChromeManager, sleep } = require("../src/chrome-manager");
const { TEASER_URL } = require("../src/piratelegend");

async function waitForPirateLegend(chrome, accountId, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const url = await chrome.currentUrl(accountId).catch(() => "");
    if (/piratelegend\.vn/i.test(url)) return url;
    await sleep(250);
  }
  throw new Error("Timed out waiting for Pirate Legend teaser URL");
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piratelegend-recovery-"));
  const profilePath = path.join(root, "profile");
  const account = {
    id: "recovery-smoke",
    label: "Recovery smoke",
    role: "MAIN",
    profilePath,
  };

  const first = new ChromeManager(root);
  let second = null;

  try {
    await first.launch(account, TEASER_URL);
    const firstUrl = await waitForPirateLegend(first, account.id);

    first.detachForServerShutdown();
    second = new ChromeManager(root);
    const attached = await second.attachIfRunning(account);
    if (!attached) throw new Error("New ChromeManager could not reattach the existing profile");

    const recoveredUrl = await waitForPirateLegend(second, account.id);
    console.log("[recovery-smoke]", JSON.stringify({
      firstUrl,
      recoveredUrl,
      reattached: true,
    }));
  } finally {
    if (second) await second.close(account.id).catch(() => {});
    else await first.close(account.id).catch(() => {});
    await sleep(800);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch((error) => {
  console.error("[recovery-smoke]", error.message);
  process.exitCode = 1;
});
