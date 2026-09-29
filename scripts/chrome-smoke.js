const fs = require("node:fs");
const path = require("node:path");
const { ChromeManager, sleep } = require("../src/chrome-manager");
const { TEASER_URL } = require("../src/piratelegend");

async function main() {
  const root = path.resolve(__dirname, "..");
  const profilePath = path.join(root, "chrome-profiles", "__smoke__");
  fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });

  const chrome = new ChromeManager(root);
  const account = {
    id: "__smoke__",
    label: "Chrome smoke test",
    role: "MAIN",
    profilePath,
  };

  try {
    await chrome.launch(account, TEASER_URL);
    await sleep(1500);
    const url = await chrome.currentUrl(account.id);
    if (!/piratelegend\.vn/i.test(url)) {
      throw new Error(`Unexpected page URL: ${url || "(empty)"}`);
    }
    console.log(`[chrome-smoke] Opened: ${url}`);
  } finally {
    await chrome.close(account.id).catch(() => {});
    await sleep(1000);
    fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch((error) => {
  console.error("[chrome-smoke]", error.message);
  process.exitCode = 1;
});
