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

Then open:

```
http://127.0.0.1:3210
```

The server binds only to `127.0.0.1`.

Health endpoint:

```
http://127.0.0.1:3210/api/health
```

It reports uptime, schema version, MAIN/SUB counts, active Chrome sessions, and running jobs.

The local UI includes profile search and filters for MAIN, SUB, attention-required states, and currently open Chrome sessions. Each profile card shows its latest activity time and disables actions that are not valid for the current state.

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

Runtime state:

```
data\state.json
```

State files use schema version 1. Older/missing fields are normalized when loaded. If `state.json` is not valid JSON, the original file is preserved as `data\state.corrupt-<timestamp>.json` and the app starts with an empty safe state.

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
start.bat                 Windows launcher
```

## Design rules

- DOM/text targeting is preferred over fixed mouse coordinates.
- Flow 2 never hard-codes a specific number of turns.
- A new flip is not submitted until the previous flip is confirmed by a decreased turn counter.
- Profile configuration cannot be edited while that Chrome profile is open.
- Edit/delete/close actions are protected while a job is running.
- Account credentials are not stored by this app; login sessions live inside the dedicated Chrome profile.
