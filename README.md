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

The tool can reattach to Chrome sessions that it previously launched if the local server is restarted while those Chrome windows remain open.

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

Optional Chrome integration smoke test:

```powershell
npm run smoke:chrome
```

This creates a temporary local Chrome profile, opens the teaser URL through the tool's own Chrome DevTools Protocol implementation, confirms the target URL, closes Chrome, and removes the test profile.

## Local data

Runtime state:

```
data\state.json
```

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
