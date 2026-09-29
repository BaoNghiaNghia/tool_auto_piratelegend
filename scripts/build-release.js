const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, "PirateLegend");
const STAGING = path.join(ROOT, ".piratelegend-build");

if (process.platform !== "win32") {
  throw new Error("Windows build must be created on Windows.");
}

function rm(target, recursive = false) {
  fs.rmSync(target, { recursive, force: true, maxRetries: 8, retryDelay: 250 });
}

function copyFile(relativePath) {
  const source = path.join(ROOT, relativePath);
  const target = path.join(STAGING, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(relativePath) {
  fs.cpSync(path.join(ROOT, relativePath), path.join(STAGING, relativePath), { recursive: true });
}

function folderBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderBytes(full) : fs.statSync(full).size;
  }
  return total;
}

function writeLauncher() {
  const content = [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "",
    "where node >nul 2>nul",
    "if errorlevel 1 (",
    "  echo [PirateLegend] Node.js was not found.",
    "  echo [PirateLegend] Install Node.js 22 or newer, then run this file again.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "for /f \"tokens=1 delims=.\" %%V in (\'node -p \"process.versions.node\"\') do set \"NODE_MAJOR=%%V\"",
    "if %NODE_MAJOR% LSS 22 (",
    "  echo [PirateLegend] Node.js 22 or newer is required. Current: ",
    "  node --version",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "node scripts\\start-local.js",
    "",
    "if errorlevel 1 (",
    "  echo.",
    "  echo [PirateLegend] Launcher stopped with an error.",
    "  pause",
    ")",
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(STAGING, "Start PirateLegend.bat"), content, "utf8");
}

function cleanOldDist() {
  const leftovers = [];
  if (!fs.existsSync(DIST)) return leftovers;
  for (const entry of fs.readdirSync(DIST, { withFileTypes: true })) {
    if (entry.name === "PirateLegend") continue;
    const absolute = path.join(DIST, entry.name);
    try {
      rm(absolute, entry.isDirectory());
    } catch {
      leftovers.push(entry.name);
    }
  }
  return leftovers;
}

function installLiteBuild() {
  if (!fs.existsSync(OUT)) {
    fs.renameSync(STAGING, OUT);
    return;
  }

  const managed = ["src", "public", "scripts", "Start PirateLegend.bat"];
  for (const name of managed) {
    const target = path.join(OUT, name);
    try { rm(target, fs.existsSync(target) && fs.statSync(target).isDirectory()); } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EBUSY") {
        throw new Error(
          "Cannot update dist\\PirateLegend because the running Lite build is using " + name + ". " +
          "Close PirateLegend and build again."
        );
      }
      throw error;
    }
  }

  for (const name of ["src", "public", "scripts"]) {
    fs.cpSync(path.join(STAGING, name), path.join(OUT, name), { recursive: true });
  }
  fs.copyFileSync(
    path.join(STAGING, "Start PirateLegend.bat"),
    path.join(OUT, "Start PirateLegend.bat")
  );

  for (const legacy of ["runtime", "README-PORTABLE.txt", "release-manifest.json"]) {
    const target = path.join(OUT, legacy);
    try { rm(target, fs.existsSync(target) && fs.statSync(target).isDirectory()); } catch {}
  }

  rm(STAGING, true);
}

try { rm(STAGING, true); } catch {}
fs.mkdirSync(STAGING, { recursive: true });

copyDir("src");
copyDir("public");
copyFile("scripts/start-local.js");
writeLauncher();

const bytes = folderBytes(STAGING);
fs.mkdirSync(DIST, { recursive: true });
const leftovers = cleanOldDist();

try {
  installLiteBuild();
} catch (error) {
  try { rm(STAGING, true); } catch {}
  throw error;
}

console.log(`[build] Lite folder: ${OUT}`);
console.log(`[build] Size: ${(bytes / 1024).toFixed(1)} KiB`);
console.log("[build] Bundled Node: no");
console.log("[build] ZIP: no");
if (leftovers.length) {
  console.warn(`[build] Could not remove locked old artifact(s): ${leftovers.join(", ")}`);
} else {
  console.log("[build] dist cleaned.");
}