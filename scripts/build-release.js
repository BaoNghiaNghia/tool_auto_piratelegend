const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const DIST = path.join(ROOT, "dist");
const bundleName = `PirateLegend-v${pkg.version}-win-${process.arch}`;
const FINAL_ZIP = path.join(DIST, `${bundleName}.zip`);
const FINAL_FOLDER = path.join(DIST, bundleName);
const KEEP_FOLDER = process.argv.includes("--keep-folder");
const buildStamp = `${Date.now()}-${process.pid}`;
const STAGING = path.join(DIST, `.build-${buildStamp}`);
const OUT = path.join(STAGING, bundleName);
const STAGING_ZIP = path.join(STAGING, `${bundleName}.zip`);

if (process.platform !== "win32") {
  throw new Error("Windows portable build must be created on Windows.");
}

function rmSafe(target, recursive = false) {
  fs.rmSync(target, {
    recursive,
    force: true,
    maxRetries: 8,
    retryDelay: 250,
  });
}

function replaceFile(source, destination) {
  const tempDestination = destination + ".new";
  rmSafe(tempDestination);
  fs.copyFileSync(source, tempDestination);
  try {
    rmSafe(destination);
    fs.renameSync(tempDestination, destination);
  } catch (error) {
    try { rmSafe(tempDestination); } catch {}
    if (error?.code === "EPERM" || error?.code === "EBUSY") {
      throw new Error(
        "Cannot replace " + path.basename(destination) + " because Windows is using it. " +
        "Close WinRAR/File Explorer preview or any process using the ZIP, then build again."
      );
    }
    throw error;
  }
}

function copyFile(relativePath) {
  const source = path.join(ROOT, relativePath);
  const target = path.join(OUT, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(relativePath) {
  const source = path.join(ROOT, relativePath);
  const target = path.join(OUT, relativePath);
  fs.cpSync(source, target, { recursive: true });
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function writeReleaseLauncher() {
  const content = [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "",
    "set \"NODE_EXE=%~dp0runtime\\node.exe\"",
    "if not exist \"%NODE_EXE%\" (",
    "  echo [PirateLegend] Bundled Node runtime is missing.",
    "  echo [PirateLegend] Re-extract the release ZIP and try again.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "\"%NODE_EXE%\" scripts\\start-local.js",
    "",
    "if errorlevel 1 (",
    "  echo.",
    "  echo [PirateLegend] Launcher stopped with an error.",
    "  pause",
    ")",
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(OUT, "Start PirateLegend.bat"), content, "utf8");
}

function collectFiles(dir, prefix = "") {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(absolute, relative));
    else result.push(relative.replaceAll("\\", "/"));
  }
  return result.sort();
}

function cleanOldArtifacts() {
  if (!fs.existsSync(DIST)) return [];

  const leftovers = [];
  for (const entry of fs.readdirSync(DIST, { withFileTypes: true })) {
    const name = entry.name;
    const absolute = path.join(DIST, name);

    if (name.startsWith(".build-")) {
      if (absolute === STAGING) continue;
      try { rmSafe(absolute, true); } catch { leftovers.push(name); }
      continue;
    }

    if (name === "LATEST.txt") {
      try { rmSafe(absolute); } catch { leftovers.push(name); }
      continue;
    }

    const isReleaseFolder = entry.isDirectory() && /^PirateLegend-v.+-win-.+/.test(name);
    const isReleaseZip = entry.isFile() && /^PirateLegend-v.+-win-.+\.zip$/i.test(name);
    const keepCurrentFolder = KEEP_FOLDER && name === bundleName;
    const keepCurrentZip = name === path.basename(FINAL_ZIP);

    if ((isReleaseFolder && !keepCurrentFolder) || (isReleaseZip && !keepCurrentZip)) {
      try { rmSafe(absolute, isReleaseFolder); } catch { leftovers.push(name); }
    }
  }
  return leftovers;
}
fs.mkdirSync(DIST, { recursive: true });
for (const entry of fs.readdirSync(DIST, { withFileTypes: true })) {
  if (entry.name.startsWith(".build-")) {
    try { rmSafe(path.join(DIST, entry.name), true); } catch {}
  }
}
fs.mkdirSync(path.join(OUT, "runtime"), { recursive: true });

copyDir("src");
copyDir("public");
copyFile("scripts/start-local.js");
copyFile("README.md");

fs.copyFileSync(process.execPath, path.join(OUT, "runtime", "node.exe"));
writeReleaseLauncher();

const releaseReadme = `Pirate Legend Automation v${pkg.version}

START
1. Extract the whole ZIP to a normal writable folder.
2. Double-click "Start PirateLegend.bat".
3. Google Chrome must be installed. Default path:
   C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
4. The UI opens at http://127.0.0.1:3210

DATA
- Local account configuration is created in data\\
- Persistent Chrome profiles are created in chrome-profiles\\
- Neither folder is included in the release archive.
- Keep these folders when upgrading if you want to preserve local sessions.

UPGRADE
1. Close the PirateLegend server window.
2. Extract the new release to a new folder.
3. Copy data\\ and chrome-profiles\\ from the old folder if you want to retain local state/sessions.
4. Start the new release.

The app stores no account passwords. Login sessions remain in Chrome profile data.
`;
fs.writeFileSync(path.join(OUT, "README-PORTABLE.txt"), releaseReadme, "utf8");

const filesBeforeManifest = collectFiles(OUT);
const manifest = {
  name: pkg.name,
  product: "Pirate Legend Automation",
  version: pkg.version,
  builtAt: new Date().toISOString(),
  gitCommit: gitCommit(),
  platform: process.platform,
  arch: process.arch,
  bundledNode: process.version,
  entrypoint: "Start PirateLegend.bat",
  excludedRuntimeData: ["data/", "chrome-profiles/"],
  files: filesBeforeManifest.map((relative) => {
    const file = path.join(OUT, relative);
    return {
      path: relative,
      bytes: fs.statSync(file).size,
      sha256: sha256(file),
    };
  }),
};
fs.writeFileSync(path.join(OUT, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

const ps = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    `Compress-Archive -Path '${OUT.replaceAll("'", "''")}\\*' -DestinationPath '${STAGING_ZIP.replaceAll("'", "''")}' -Force`,
  ],
  { cwd: ROOT, encoding: "utf8" }
);

if (ps.status !== 0) {
  throw new Error(`ZIP packaging failed: ${ps.stderr || ps.stdout || "unknown error"}`);
}

replaceFile(STAGING_ZIP, FINAL_ZIP);

if (KEEP_FOLDER) {
  try { rmSafe(FINAL_FOLDER, true); } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EBUSY") {
      throw new Error(
        "Cannot replace the unpacked release folder because Windows is using it. " +
        "Close any portable PirateLegend instance using that folder and try again."
      );
    }
    throw error;
  }
  fs.cpSync(OUT, FINAL_FOLDER, { recursive: true });
} else {
  try { rmSafe(FINAL_FOLDER, true); } catch {}
}

const leftovers = cleanOldArtifacts();
const zipBytes = fs.statSync(FINAL_ZIP).size;
try { rmSafe(STAGING, true); } catch {}

console.log(`[build] ZIP: ${FINAL_ZIP}`);
console.log(`[build] ZIP size: ${(zipBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`[build] Bundled Node: ${process.version} (${process.arch})`);
if (KEEP_FOLDER) console.log(`[build] Debug folder: ${FINAL_FOLDER}`);
if (leftovers.length) {
  console.warn(`[build] Could not remove locked old artifact(s): ${leftovers.join(", ")}`);
} else {
  console.log("[build] dist cleaned: only current release artifact(s) kept.");
}
