const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const DIST = path.join(ROOT, "dist");
const bundleName = `PirateLegend-v${pkg.version}-win-${process.arch}`;
const OUT = path.join(DIST, bundleName);
const ZIP = path.join(DIST, `${bundleName}.zip`);

if (process.platform !== "win32") {
  throw new Error("Windows portable build must be created on Windows.");
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

try {
  fs.rmSync(OUT, {
    recursive: true,
    force: true,
    maxRetries: 6,
    retryDelay: 250,
  });
  fs.rmSync(ZIP, { force: true, maxRetries: 6, retryDelay: 250 });
} catch (error) {
  if (error?.code === "EPERM" || error?.code === "EBUSY") {
    throw new Error(
      "Cannot replace the existing portable release because Windows is using files inside it. " +
      "Close any running PirateLegend portable instance and try the build again."
    );
  }
  throw error;
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
    `Compress-Archive -Path '${OUT.replaceAll("'", "''")}\\*' -DestinationPath '${ZIP.replaceAll("'", "''")}' -Force`,
  ],
  { cwd: ROOT, encoding: "utf8" }
);

if (ps.status !== 0) {
  throw new Error(`ZIP packaging failed: ${ps.stderr || ps.stdout || "unknown error"}`);
}

const zipBytes = fs.statSync(ZIP).size;
console.log(`[build] Portable folder: ${OUT}`);
console.log(`[build] ZIP: ${ZIP}`);
console.log(`[build] ZIP size: ${(zipBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`[build] Bundled Node: ${process.version} (${process.arch})`);
