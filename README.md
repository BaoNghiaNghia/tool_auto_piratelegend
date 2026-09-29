# Pirate Legend Automation

Local Windows automation manager for persistent Chrome profiles used with the Pirate Legend teaser event.

Project root:

```
D:\Bot_Tool_Auto_Game\tool_auto_piratelegend
```

## Current scope

### MAIN profiles

- Open `https://sukien.piratelegend.vn/teaser` in a dedicated persistent Chrome profile.
- Flow 1:
  - Navigate toward the treasure/invite area using visible DOM text.
  - Detect when login is required and leave login to the user in that Chrome profile.
  - Capture and persist the referral URL from visible inputs, data attributes, links, or the page copy action.
- Inspect:
  - Open the teaser in the selected MAIN profile without clicking missions or reward actions.
  - Read current URL/title, login visibility, mini-game/invite visibility, `SỐ LƯỢT`, and whether a referral URL is already visible.
  - Show the latest inspection result directly on the profile card and write a compact summary to Activity.
- Check lượt:
  - Navigate to the treasure area.
  - Read the current `SỐ LƯỢT` without consuming a turn.
- Flow 2:
  - Read `SỐ LƯỢT` dynamically.
  - Click `LẬT THẺ`.
  - Read/log a visible points reward when available.
  - Dismiss the result popup.
  - Wait until `SỐ LƯỢT` actually decreases before allowing the next flip.
  - Stop at `0`.
  - Stop safely if the counter does not decrease, rather than submitting another flip.

### SUB profiles

- Assign a SUB profile to one MAIN profile.
- Open that MAIN profile's stored referral URL in the SUB Chrome profile.
- Registration/account creation on the website remains manual.
- If a MAIN is deleted, its SUB profiles are retained and marked `NEEDS_MAIN` so they can be reassigned.

## Chrome profile behavior

Each account uses one persistent Chrome user-data directory.

If Profile Path is left blank, the tool creates one under:

```
chrome-profiles\<account-id>
```

The same explicit Chrome profile path cannot be assigned to two accounts.

The tool can reattach to Chrome sessions that it previously launched if the local server is restarted while those Chrome windows remain open. Graceful server shutdown leaves managed Chrome windows open by default; use the profile card's **Close** action when you explicitly want that Chrome profile closed.

The API also refreshes Chrome-session liveness before state/action requests, so a profile manually closed outside the tool is removed from the in-memory session list instead of remaining stuck as `OPEN`.

Do not open the same profile directory separately in another Chrome process while the tool is using it.

Default Chrome executable:

```
C:\Program Files\Google\Chrome\Application\chrome.exe
```

To use another Chrome executable, set the `CHROME_PATH` environment variable before starting the tool.

## Start

Double-click:

```
start.bat
```

or run:

```powershell
npm start
```

The launcher first checks `http://127.0.0.1:3210/api/health`:

- If PirateLegend is already running on port 3210, it reuses that server instead of starting a second copy. This avoids `EADDRINUSE` when `start.bat` is opened twice.
- If port 3210 is occupied by another application and the PirateLegend health endpoint does not respond, the launcher reports a real port conflict.
- If the port is free, it starts the server normally.
- The launcher opens `http://127.0.0.1:3210` in the default browser after startup/reuse.

To run a second isolated local instance on another port:

```powershell
node scripts/start-local.js --port=3221
```

For direct server-only debugging without launcher reuse logic:

```powershell
npm run server
```

The server binds only to `127.0.0.1`.

Health endpoint:

```
http://127.0.0.1:3210/api/health
```

It reports uptime, schema version, MAIN/SUB counts, active Chrome sessions, running jobs, state/activity file sizes, activity count, activity-write errors, and startup session-recovery progress.

The local UI includes profile search and filters for MAIN, SUB, attention-required states, and currently open Chrome sessions. Profiles are ordered by MAIN group, with each MAIN's SUB profiles directly after it. Each profile card shows its latest activity time and disables actions that are not valid for the current state. The dashboard also shows the current number of open Chrome profiles and provides **Close idle Chrome** to close managed Chrome windows that are not running a job.

### Account Setup

The dedicated **Account Setup** panel is the primary place to configure accounts:

- **+ Add MAIN** creates a MAIN profile with the role locked to MAIN during setup.
- Every MAIN is shown as its own group with Chrome state, referral readiness, and SUB count.
- **+ Add SUB** on a MAIN group opens the SUB setup form with that MAIN already selected.
- The global **+ Add SUB** action lets you choose from existing MAIN profiles.
- SUB rows appear directly inside their parent MAIN group with quick **Edit** and **Open** actions.
- SUB profiles that lose their MAIN are shown in an **Unassigned SUB** warning group so they can be reassigned instead of disappearing.
- Account creation/registration on the Pirate Legend website remains manual; this setup UI manages the local Chrome profiles and MAIN → SUB relationship.

### Configuration backup / restore

Use **Export config** to download a JSON backup containing profile configuration and MAIN → SUB mapping. The export contains profile IDs, labels, roles, explicit Chrome profile paths, parent mapping, and stored referral URLs. It does **not** export Chrome cookies/session data.

Use **Restore config** to replace the current profile configuration from one of these JSON files. Restore is blocked while jobs are running or managed Chrome profiles are open. Before replacing the active configuration, the tool automatically saves the current state and activity history as:

```
data\state.before-restore-<timestamp>.json
data\activity.before-restore-<timestamp>.jsonl
```

The 10 newest state backups and 10 newest activity backups are retained automatically. Restored accounts start with clean runtime status/turn counters while retaining IDs and mapping, so auto-managed Chrome profile directories continue to match the restored account IDs.

## Performance / scaling

- Account/runtime state lives in `state.json`; activity is append-only in `activity.jsonl`, so writing a log no longer rewrites the full state file.
- Activity is kept to 500 recent events in memory. The JSONL file is compacted in batches instead of on every event.
- `/api/state` uses a revision token. Idle polling returns only a tiny `unchanged` response instead of serializing all profiles/logs again.
- UI polling never overlaps: approximately every 2 seconds while visible and every 10 seconds while the tab is in the background.
- Passive state/health reads run Chrome liveness checks in the background. DevTools checks are batched (12 at a time) and deduplicated.
- Startup session recovery runs in the background in batches, so the local UI starts immediately even with many stale Chrome profiles.
- Profile grouping/search uses indexed lookups instead of repeated O(n²) scans. The UI renders at most 300 matching profile cards at once; Search/Filter narrows larger sets.
- The dominant resource cost at scale remains Chrome itself. Keep only profiles you actively need open and use **Close idle Chrome** to reclaim RAM.

## Build Windows portable

Development/source mode requires Node.js 22+, but the release build can bundle the exact Node runtime used to build it.

Double-click:

```
build.bat
```

or run:

```powershell
npm run build
```

The default build runs the complete source/self-check in a temporary staging folder and leaves only one current release archive:

```
dist\PirateLegend-v<version>-win-<arch>.zip
```

Old timestamped build folders, old ZIPs, stale staging folders, and `LATEST.txt` are cleaned automatically after a successful build.

For local debugging when you also want an unpacked release folder, run:

```powershell
npm run build:folder
```

That keeps only:

```
dist\PirateLegend-v<version>-win-<arch>\
dist\PirateLegend-v<version>-win-<arch>.zip
```

The portable archive contains:

- `Start PirateLegend.bat` — user-facing launcher.
- `runtime\node.exe` — bundled Node runtime, so Node does not need to be installed on the target machine.
- `src\` and `public\` — application runtime files.
- `scripts\start-local.js` — safe single-instance launcher.
- `release-manifest.json` — version, Git commit, build time, architecture, Node version, file sizes and SHA-256 hashes.
- `README-PORTABLE.txt` — quick start and upgrade instructions.

The release intentionally does **not** include:

```
data\
chrome-profiles\
```

This prevents local account configuration, Chrome sessions, cookies, and profile data from being copied into release artifacts. On another machine, extract the ZIP and double-click `Start PirateLegend.bat`. Google Chrome is still required.

For upgrades where you want to retain local sessions, keep/copy the existing `data\` and `chrome-profiles\` directories into the new extracted release folder before starting it.

## Validation

Run the complete local source/self-check:

```powershell
npm run check
```

It checks:

- Backend JavaScript syntax.
- Chrome/CDP source syntax.
- UI inline JavaScript syntax.
- Store creation and persistence.
- MAIN → SUB relation validation.
- Orphan SUB runtime state.
- Duplicate Chrome profile-path rejection.
- Pirate Legend referral URL validation.

Optional Chrome integration smoke tests:

```powershell
npm run smoke:chrome
npm run smoke:inspect
npm run smoke:recovery
```

`smoke:chrome` creates a temporary local Chrome profile, opens the teaser URL through the tool's own Chrome DevTools Protocol implementation, confirms the target URL, closes Chrome, and removes the test profile.

`smoke:inspect` creates an isolated temporary profile and validates the read-only Inspect path end-to-end. It checks that the teaser target is selected after Chrome startup and reports observable page state without clicking mission/reward controls.

`smoke:recovery` simulates a local-server restart: it launches a temporary Chrome profile with one manager instance, detaches it without closing Chrome, creates a fresh manager instance, reattaches through `DevToolsActivePort`, verifies the Pirate Legend URL, then closes and removes the temporary profile.

## Local data

Runtime state and activity:

```
data\state.json
data\activity.jsonl
```

`state.json` stores profile/runtime state; activity is separated into `activity.jsonl` to reduce write amplification. Legacy activity embedded in older `state.json` files is migrated automatically. State files use schema version 1. Older/missing fields are normalized when loaded. If `state.json` is not valid JSON, the original file is preserved as `data\state.corrupt-<timestamp>.json` and the app starts with an empty safe state.

Auto-managed Chrome sessions:

```
chrome-profiles\
```

Both directories are ignored by Git.

Activity history is capped at the 500 most recent events.

## Main files

```
src/server.js             Local HTTP API + static UI server
src/store.js              Persistent account/referral/status state
src/cdp.js                Minimal Chrome DevTools Protocol client
src/chrome-manager.js     Persistent Chrome lifecycle/session recovery
src/piratelegend.js       Flow 1 / Check lượt / Flow 2 site automation
public/index.html         Local management UI
scripts/self-check.js     Local validation suite
scripts/chrome-smoke.js   Chrome/CDP integration smoke test
scripts/build-release.js  Windows portable release builder
start.bat                 Windows source launcher
build.bat                 Windows build entrypoint
```

## Design rules

- DOM/text targeting is preferred over fixed mouse coordinates.
- Flow 2 never hard-codes a specific number of turns.
- A new flip is not submitted until the previous flip is confirmed by a decreased turn counter.
- Profile configuration cannot be edited while that Chrome profile is open.
- Edit/delete/close actions are protected while a job is running.
- Account credentials are not stored by this app; login sessions live inside the dedicated Chrome profile.
