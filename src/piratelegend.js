const { sleep } = require("./chrome-manager");

const TEASER_URL = "https://sukien.piratelegend.vn/teaser";

function jsString(value) {
  return JSON.stringify(value);
}

async function waitForDocument(client, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const page = await client.evaluate(`({
      readyState: document.readyState,
      href: location.href
    })`);
    const ready = page?.readyState === "interactive" || page?.readyState === "complete";
    const realPage = page?.href && page.href !== "about:blank" && !page.href.startsWith("chrome://");
    if (ready && realPage) return page;
    await sleep(250);
  }
  throw new Error("Timed out waiting for the Chrome page to finish initial navigation");
}

async function clickText(client, candidates) {
  const expression = `(() => {
    const wanted = ${jsString(candidates)}.map(x => String(x).toUpperCase());
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const nodes = [...document.querySelectorAll("button,a,[role=button],input[type=button],input[type=submit],div,span")];
    const scored = [];
    for (const el of nodes) {
      if (!visible(el)) continue;
      const text = String(el.innerText || el.value || el.getAttribute("aria-label") || "").trim();
      if (!text) continue;
      const upper = text.toUpperCase();
      const directInteractive = el.matches("button,a,[role=button],input[type=button],input[type=submit]");
      const interactive = directInteractive ? el : el.closest("button,a,[role=button]");
      const target = interactive && visible(interactive) ? interactive : el;
      const interactiveBonus = interactive ? 250 : 0;
      for (let i = 0; i < wanted.length; i++) {
        if (upper === wanted[i]) scored.push({ el: target, text, score: 1000 + interactiveBonus - i });
        else if (upper.includes(wanted[i])) scored.push({ el: target, text, score: 500 + interactiveBonus - i });
      }
    }
    scored.sort((a,b) => b.score - a.score);
    const hit = scored[0];
    if (!hit) return null;
    hit.el.scrollIntoView({block:"center", inline:"center"});
    hit.el.click();
    return hit.text;
  })()`;
  return client.evaluate(expression);
}

async function installClipboardCapture(client) {
  return client.evaluate(`(() => {
    if (window.__piratelegendClipboardInstalled) return true;
    window.__piratelegendClipboardInstalled = true;
    window.__piratelegendCopiedText = window.__piratelegendCopiedText || "";

    try {
      const clipboard = navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === "function") {
        const originalWriteText = clipboard.writeText.bind(clipboard);
        clipboard.writeText = async (text) => {
          window.__piratelegendCopiedText = String(text || "");
          return originalWriteText(text);
        };
      }
    } catch {}

    document.addEventListener("copy", () => {
      setTimeout(async () => {
        try {
          const text = await navigator.clipboard?.readText?.();
          if (text) window.__piratelegendCopiedText = String(text);
        } catch {}
      }, 0);
    }, true);
    return true;
  })()`);
}

async function detectReferralUrl(client) {
  const expression = `(() => {
    const strong = [];
    const weak = [];
    const collect = (bucket, value) => {
      if (!value) return;
      const text = String(value).trim();
      const matches = text.match(/https?:\\/\\/[^\\s"'<>]+/g) || [];
      for (const item of matches) bucket.push(item.replace(/[),.;]+$/, ""));
    };

    collect(strong, window.__piratelegendCopiedText || "");
    document.querySelectorAll("input,textarea").forEach(el => collect(strong, el.value));
    document.querySelectorAll("[data-url],[data-link],[data-copy],[data-clipboard-text]").forEach(el => {
      collect(strong, el.getAttribute("data-url"));
      collect(strong, el.getAttribute("data-link"));
      collect(strong, el.getAttribute("data-copy"));
      collect(strong, el.getAttribute("data-clipboard-text"));
    });
    document.querySelectorAll("a[href]").forEach(el => collect(weak, el.href));
    collect(weak, document.body?.innerText || "");

    const valid = (url) => {
      try {
        const parsed = new URL(url, location.href);
        if (!/(^|\\.)piratelegend\\.vn$/i.test(parsed.hostname)) return false;
        const current = new URL(location.href);
        const samePlainTeaser =
          parsed.origin === current.origin &&
          parsed.pathname.replace(/\\/$/, "") === "/teaser" &&
          !parsed.search &&
          !parsed.hash;
        return !samePlainTeaser;
      } catch {
        return false;
      }
    };

    const strongUnique = [...new Set(strong)].filter(valid);
    const weakUnique = [...new Set(weak)].filter(valid);
    const referralLike = (url) => /[?&#](ref|referral|invite|code|uid|share|from)[^=]*=/i.test(url);

    return strongUnique.find(referralLike)
      || strongUnique[0]
      || weakUnique.find(referralLike)
      || null;
  })()`;
  return client.evaluate(expression);
}

async function readTurns(client) {
  const expression = `(() => {
    const clean = (s) => String(s || "").replace(/\\s+/g, " ").trim();
    const body = clean(document.body?.innerText || "");
    const direct = body.match(/SỐ\\s*LƯỢT\\s*[:：]?\\s*(\\d+)/i);
    if (direct) return Number(direct[1]);

    const all = [...document.querySelectorAll("body *")];
    for (const el of all) {
      const text = clean(el.innerText);
      if (!text || !/SỐ\\s*LƯỢT/i.test(text)) continue;
      const local = text.match(/SỐ\\s*LƯỢT\\s*[:：]?\\s*(\\d+)/i);
      if (local) return Number(local[1]);
      const parent = clean(el.parentElement?.innerText);
      const parentMatch = parent.match(/SỐ\\s*LƯỢT\\s*[:：]?\\s*(\\d+)/i);
      if (parentMatch) return Number(parentMatch[1]);
      const next = clean(el.nextElementSibling?.innerText);
      const nextMatch = next.match(/^(\\d+)$/);
      if (nextMatch) return Number(nextMatch[1]);
    }
    return null;
  })()`;
  return client.evaluate(expression);
}

async function ensureTreasureArea(client) {
  let turns = await readTurns(client);
  if (turns !== null) return turns;

  const clicked = await clickText(client, ["KHO BÁU MAY MẮN", "KHO BÁU", "MAY MẮN"]);
  if (clicked) {
    await sleep(1200);
    turns = await readTurns(client);
  }
  return turns;
}

async function loginIsRequired(client) {
  return client.evaluate(`(() => {
    const text = String(document.body?.innerText || "").toUpperCase();
    return text.includes("ĐĂNG NHẬP") || text.includes("ĐANG NHẬP") || text.includes("LOGIN");
  })()`);
}

async function inspectPage(client) {
  return client.evaluate(`(() => {
    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const text = clean(document.body?.innerText || "");
    const upper = text.toUpperCase();
    const buttonLabels = [...document.querySelectorAll('button,a,[role="button"]')]
      .map((el) => clean(el.innerText || el.getAttribute("aria-label")))
      .filter(Boolean)
      .slice(0, 40);
    return {
      url: location.href,
      title: document.title,
      loginVisible: upper.includes("ĐĂNG NHẬP") || upper.includes("LOGIN"),
      miniGameVisible: upper.includes("MINI GAME") || upper.includes("NHẬN LƯỢT"),
      inviteMissionVisible: upper.includes("MỜI BẠN BÈ") || upper.includes("LINK MỜI"),
      exchangeVisible: upper.includes("ĐỔI CODE"),
      historyVisible: upper.includes("LỊCH SỬ"),
      buttonLabels,
    };
  })()`);
}

async function waitForTurnsDecrease(client, before, timeoutMs = 12000) {
  const started = Date.now();
  let last = before;
  while (Date.now() - started < timeoutMs) {
    const current = await readTurns(client);
    if (current !== null) {
      last = current;
      if (current < before) return current;
    }
    await sleep(300);
  }
  return last;
}

async function readReward(client) {
  const expression = `(() => {
    const text = String(document.body?.innerText || "").replace(/\\s+/g, " ");
    const matches = [...text.matchAll(/(\\d[\\d.,]*)\\s*điểm/gi)];
    if (!matches.length) return null;
    return matches[matches.length - 1][1];
  })()`;
  return client.evaluate(expression);
}

async function dismissPopup(client) {
  return client.evaluate(`(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const explicit = [...document.querySelectorAll(
      '[role="dialog"], .modal, .popup, [class*="modal"], [class*="popup"], [class*="dialog"], [class*="overlay"]'
    )].filter(visible);

    const fixedCandidates = [...document.querySelectorAll("body *")].filter((el) => {
      if (!visible(el)) return false;
      const style = getComputedStyle(el);
      if (style.position !== "fixed") return false;
      const text = String(el.innerText || "").toUpperCase();
      return /ĐIỂM|CHÚC MỪNG|HẾT LƯỢT|NHẬN/.test(text);
    });

    const dialogs = [...new Set([...explicit, ...fixedCandidates])]
      .sort((a,b) => Number(getComputedStyle(b).zIndex || 0) - Number(getComputedStyle(a).zIndex || 0));
    const root = dialogs[0];
    if (!root) return null;

    const wanted = ["NHẬN", "XÁC NHẬN", "OK", "ĐÓNG", "TIẾP TỤC"];
    const buttons = [...root.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')].filter(visible);
    for (const text of wanted) {
      const hit = buttons.find(el => String(el.innerText || el.value || el.getAttribute("aria-label") || "").trim().toUpperCase().includes(text));
      if (hit) { hit.click(); return text; }
    }

    const close = root.querySelector('button[aria-label="Close"],button[aria-label="close"],button.close,[class*="close"]');
    if (close && visible(close)) { close.click(); return "close"; }
    return null;
  })()`);
}

class PirateLegendAutomation {
  constructor(store, chrome) {
    this.store = store;
    this.chrome = chrome;
  }

  async open(account) {
    await this.chrome.launch(account, TEASER_URL);
    this.store.updateAccount(account.id, { status: "OPEN", lastError: "" });
    this.store.log(account.id, "INFO", "Chrome opened at teaser page");
  }

  async flow1(account) {
    if (account.role !== "MAIN") throw new Error("Flow 1 is only available for MAIN profiles");
    this.store.updateAccount(account.id, { status: "FLOW1_RUNNING", lastError: "" });
    this.store.log(account.id, "INFO", "Flow 1 started");

    await this.chrome.launch(account, TEASER_URL);
    const client = await this.chrome.pageClient(account.id);
    try {
      await waitForDocument(client);
      await sleep(1200);
      await installClipboardCapture(client);

      let referral = await detectReferralUrl(client);
      if (!referral) {
        const treasure = await clickText(client, ["KHO BÁU MAY MẮN", "KHO BÁU"]);
        if (treasure) {
          this.store.log(account.id, "INFO", `Opened treasure area: ${treasure}`);
          await sleep(1000);
        }
        referral = await detectReferralUrl(client);
      }

      if (!referral && await loginIsRequired(client)) {
        await clickText(client, ["ĐĂNG NHẬP", "LOGIN"]);
        this.store.updateAccount(account.id, { status: "WAIT_LOGIN" });
        this.store.log(account.id, "WARN", "Login is required. Complete login in this Chrome profile, then run Flow 1 again.");
        return { referralUrl: null, manualActionRequired: true, reason: "login" };
      }

      if (!referral) {
        const clicked = await clickText(client, [
          "MỜI BẠN BÈ",
          "MỜI BẠN",
          "CHIA SẺ",
          "COPY LINK",
          "SAO CHÉP LINK"
        ]);
        if (clicked) {
          this.store.log(account.id, "INFO", `Opened invite area: ${clicked}`);
          await sleep(1200);
          referral = await detectReferralUrl(client);

          if (!referral) {
            const copied = await clickText(client, ["SAO CHÉP LINK", "COPY LINK", "SAO CHÉP", "COPY"]);
            if (copied) {
              this.store.log(account.id, "INFO", `Triggered referral copy: ${copied}`);
              await sleep(500);
              referral = await detectReferralUrl(client);
            }
          }
        }
      }

      if (referral) {
        this.store.updateAccount(account.id, {
          referralUrl: referral,
          status: "REFERRAL_READY",
          lastError: "",
        });
        this.store.log(account.id, "SUCCESS", "Referral URL captured", { referralUrl: referral });
        return { referralUrl: referral };
      }

      this.store.updateAccount(account.id, { status: "WAIT_REFERRAL" });
      this.store.log(account.id, "WARN", "Referral URL not detected yet. Keep the invite popup open, then use Capture Link.");
      return { referralUrl: null, manualActionRequired: true };
    } finally {
      client.close();
    }
  }

  async captureReferral(account) {
    if (account.role !== "MAIN") throw new Error("Referral capture is only available for MAIN profiles");
    const client = await this.chrome.pageClient(account.id);
    try {
      await installClipboardCapture(client);
      let referral = await detectReferralUrl(client);

      if (!referral) {
        const copied = await clickText(client, ["SAO CHÉP LINK", "COPY LINK", "SAO CHÉP", "COPY"]);
        if (copied) {
          await sleep(500);
          referral = await detectReferralUrl(client);
        }
      }

      if (!referral) {
        throw new Error("No referral URL detected. Open the invite/share popup on the current page and try Capture link again.");
      }

      this.store.updateAccount(account.id, { referralUrl: referral, status: "REFERRAL_READY", lastError: "" });
      this.store.log(account.id, "SUCCESS", "Referral URL captured", { referralUrl: referral });
      return { referralUrl: referral };
    } finally {
      client.close();
    }
  }

  async openSubReferral(account) {
    if (account.role !== "SUB") throw new Error("This action is only available for SUB profiles");
    const parent = this.store.getAccount(account.parentMainId);
    if (!parent) throw new Error("SUB profile has no valid MAIN parent");
    if (!parent.referralUrl) throw new Error("Parent MAIN does not have a referral URL yet");

    this.store.updateAccount(account.id, { status: "REGISTRATION_MANUAL", lastError: "" });
    this.store.log(account.id, "INFO", `Opening referral from MAIN: ${parent.label}`);
    await this.chrome.launch(account, parent.referralUrl);
    return { referralUrl: parent.referralUrl };
  }

  async inspect(account) {
    if (account.role !== "MAIN") throw new Error("Inspect is only available for MAIN profiles");

    await this.chrome.launch(account, TEASER_URL);
    const client = await this.chrome.pageClient(account.id);
    try {
      await waitForDocument(client);
      await sleep(600);

      const page = await inspectPage(client);
      const turns = await readTurns(client);
      const referralUrl = await detectReferralUrl(client);

      const patch = { lastError: "" };
      if (turns !== null) patch.turns = turns;
      if (referralUrl) patch.referralUrl = referralUrl;
      this.store.updateAccount(account.id, patch);

      const summary = [
        `login=${page.loginVisible ? "yes" : "no"}`,
        `turns=${turns === null ? "unknown" : turns}`,
        `invite=${page.inviteMissionVisible ? "yes" : "no"}`,
        `referral=${referralUrl ? "yes" : "no"}`,
      ].join(" · ");
      this.store.log(account.id, "INFO", `Inspect: ${summary}`);

      return {
        ...page,
        turns,
        referralDetected: Boolean(referralUrl),
        referralUrl: referralUrl || null,
      };
    } finally {
      client.close();
    }
  }

  async refreshTurns(account) {
    if (account.role !== "MAIN") throw new Error("Turn counter is only available for MAIN profiles");
    await this.chrome.launch(account, TEASER_URL);
    const client = await this.chrome.pageClient(account.id);
    try {
      await waitForDocument(client);
      await sleep(800);
      const turns = await ensureTreasureArea(client);
      if (turns === null && await loginIsRequired(client)) {
        await clickText(client, ["ĐĂNG NHẬP", "LOGIN"]);
        this.store.updateAccount(account.id, { status: "WAIT_LOGIN" });
        this.store.log(account.id, "WARN", "Login is required before SỐ LƯỢT can be read.");
        return { turns: null, manualActionRequired: true, reason: "login" };
      }
      if (turns === null) throw new Error("Could not read SỐ LƯỢT from the current page");
      this.store.updateAccount(account.id, { turns, status: "READY", lastError: "" });
      this.store.log(account.id, "INFO", `SỐ LƯỢT: ${turns}`);
      return { turns };
    } finally {
      client.close();
    }
  }

  async flow2(account) {
    if (account.role !== "MAIN") throw new Error("Flow 2 is only available for MAIN profiles");
    this.store.updateAccount(account.id, { status: "FLOW2_RUNNING", lastError: "" });
    this.store.log(account.id, "INFO", "Flow 2 started");

    await this.chrome.launch(account, TEASER_URL);
    const client = await this.chrome.pageClient(account.id);
    let flips = 0;
    try {
      await waitForDocument(client);
      await sleep(1000);

      let firstTurns = await ensureTreasureArea(client);
      if (firstTurns === null && await loginIsRequired(client)) {
        await clickText(client, ["ĐĂNG NHẬP", "LOGIN"]);
        this.store.updateAccount(account.id, { status: "WAIT_LOGIN" });
        this.store.log(account.id, "WARN", "Login is required. Complete login in this Chrome profile, then run Flow 2 again.");
        return { flips: 0, turns: null, manualActionRequired: true, reason: "login" };
      }

      for (let guard = 0; guard < 100; guard += 1) {
        const turns = guard === 0 ? firstTurns : await readTurns(client);
        if (turns === null) {
          throw new Error("Could not read SỐ LƯỢT from the current page");
        }

        this.store.updateAccount(account.id, { turns });
        this.store.log(account.id, "INFO", `Current turns: ${turns}`);

        if (turns <= 0) {
          this.store.updateAccount(account.id, { status: "FLOW2_DONE", turns: 0, lastError: "" });
          this.store.log(account.id, "SUCCESS", `Flow 2 completed after ${flips} flip(s)`);
          return { flips, turns: 0 };
        }

        const clicked = await clickText(client, ["LẬT THẺ", "LẬT THẺ NGAY"]);
        if (!clicked) throw new Error("Could not find the LẬT THẺ button");

        flips += 1;
        this.store.log(account.id, "INFO", `Flip ${flips} submitted`);
        await sleep(900);

        const reward = await readReward(client);
        if (reward) this.store.log(account.id, "SUCCESS", `Reward detected: ${reward} điểm`);

        await dismissPopup(client);
        const after = await waitForTurnsDecrease(client, turns, 12000);
        this.store.updateAccount(account.id, { turns: after });

        if (after >= turns) {
          this.store.log(account.id, "ERROR", `Turn counter did not decrease after flip (${turns} -> ${after})`);
          throw new Error("Turn counter did not decrease after LẬT THẺ; stopped to prevent duplicate actions");
        }

        this.store.log(account.id, "INFO", `Turn consumed: ${turns} -> ${after}`);
        await sleep(350);
      }
      throw new Error("Flow 2 safety limit reached");
    } finally {
      client.close();
    }
  }
}

module.exports = {
  PirateLegendAutomation,
  TEASER_URL,
  readTurns,
  detectReferralUrl,
};
