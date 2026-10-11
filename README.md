# dsh-plugin-notify

[中文](README.zh.md) | English

Session-state notifications for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): a **WxPusher push** plus a **real browser notification** — with sound and `requireInteraction` — whenever a session stops, exits with an error, or asks you a question. Everything is configured from a native settings page (设置 → 通知 / Settings → Notifications).

- **Two independent channels, one payload.** The Host detects the transition once and delivers the same content to WxPusher and to every open browser page.
- **Real system notifications.** `new Notification(...)` with a PNG icon, an optional WebAudio chime, and `requireInteraction` so the banner stays until you dismiss it.
- **Native settings page.** A `settings.section` page built from the plugin's own Config schema; every field is `volatile`, so edits apply **live** — no restart, no plugin remount.
- **Write-only secret.** The WxPusher `appToken` is declared `role('secret')`: it is stored in the profile, never returned over the wire, and edited through a path-addressed write.
- **Zero runtime dependencies beyond the schema library.** One Host file, one Client file, no build step.

## What triggers a notification

| Event | Source | Detail shown |
|---|---|---|
| **Session stopped** | `api-session/status` → `running: false` | the folded session title |
| **Exited with an error** | `api-session/error`, `agent/error` | the error message |
| **Question asked** | `user-questions/request` (observed, then delegated) | the first question |
| **Approval needed** | `approval/request` (observed, then delegated) | the tool name |

Two filters keep the noise down:

- **`minRunMs`** — a run shorter than this never reports a stop.
- **`stopDebounceMs`** — after the agent goes idle the Host waits this long; if the session starts running again the report is dropped. A stop is also suppressed when an error notification for the same session just fired, because that one is more precise.

`user-questions/request` and `approval/request` are Cordis **waterfalls**: this plugin only observes them and always delegates with `next()`, so it can never swallow a request meant for another answerer.

## Requirements

- A DSH Host with the Web surface (`@deepseek-ai/dsh-web-app`), i.e. any normal `dsh web` profile. `ctx.webServer` is used for the notification stream; without it the plugin still pushes to WxPusher but delivers nothing to the browser.
- Node.js ≥ 20.
- A browser that supports the Notification API (Chrome, Edge, Firefox, Safari 16+).
- A [WxPusher](https://wxpusher.zjiecode.com) account, only if you want phone pushes.

## Install

### Through the plugin manager (recommended)

Add the package spec to the Plugins page — a registry name, a git URL, or an absolute path to a checkout — and enable the bundle it adds:

```
dsh-plugin-notify
```

or, from a clone:

```
/path/to/dsh-plugin-notify
```

The plugin's row is declared by the bundle's own `cordis.patch.yml`, so nothing else needs editing. If the profile was already running, reload it (or restart) so the new package enters the module-resolution table.

### Manually, in a profile

```bash
# in the profile directory, e.g. ~/.dsh/profiles/web
pnpm add dsh-plugin-notify
```

Then add the bundle to `dsh.profile.bundles` in that profile's `package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-notify"]
    }
  }
}
```

## Configure

Open **Settings → Notifications** (设置 → 通知). The page writes straight into the plugin's profile entry.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch for both channels. |
| `events.stopped` | `true` | Report a session that stopped working. |
| `events.error` | `true` | Report a session or step that errored. |
| `events.question` | `true` | Report a question from the agent. |
| `events.approval` | `false` | Report a pending approval decision. |
| `browser.enabled` | `true` | Raise browser notifications at all. |
| `browser.sound` | `true` | Play a short two-tone chime (WebAudio, no asset). |
| `browser.requireInteraction` | `true` | Keep the banner until dismissed. |
| `browser.onlyWhenHidden` | `true` | Stay quiet while the tab is visible. |
| `wxpusher.enabled` | `false` | Enable the WxPusher channel. |
| `wxpusher.appToken` | `''` | WxPusher `appToken` (**write-only secret**). |
| `wxpusher.uids` | `[]` | Receiving UIDs, one per line (`UID_xxxxxxxx`). |
| `wxpusher.topicIds` | `[]` | Receiving topic ids, one per line. |
| `wxpusher.url` | `''` | Optional URL a tapped push opens. |
| `advanced.stopDebounceMs` | `1200` | Idle grace period before reporting a stop. |
| `advanced.minRunMs` | `2000` | Runs shorter than this never notify. |
| `advanced.rootSessionsOnly` | `true` | Skip subagent sessions. |
| `advanced.includeSessionTitle` | `true` | Include the folded session title. |
| `advanced.maxDetailChars` | `300` | Truncate error/question detail. |

The same values live in the profile patch, so they survive upgrades:

```yaml
- id: dsh-plugin-notify
  config:
    events:
      approval: true
    wxpusher:
      enabled: true
      uids:
        - UID_xxxxxxxx
```

### WxPusher credentials

1. Sign in at <https://wxpusher.zjiecode.com>, create an application, and copy its **appToken**.
2. Follow the app's QR code with WeChat to subscribe, then copy your **UID** from the app's user list (or use a **topic id** to reach many subscribers).
3. Paste the appToken and the UIDs into the settings page and press **Save**.

The appToken input is always empty on load — the Host only ever reports *whether* a token is set.

### Browser permission

The page shows the current `Notification.permission`. If it is `default`, press **Request permission**; if it is `denied`, re-allow notifications for the page in your browser's site settings. Sound needs one user gesture on the page before the browser lets an `AudioContext` start — the plugin hooks the first click/keypress to unlock it.

### Test

**Send a test notification** broadcasts a frame to every connected page and pushes one WxPusher message, then reports both outcomes:

```
Browser: delivered to 1 page(s) · WxPusher: sent
Browser: no connected page (browser notifications may be off) · WxPusher: no appToken
```

## How it works

```
Host                                    Browser
────                                    ───────
api-session/status ─┐
api-session/error  ─┤
agent/error        ─┼─► detect ─► frame ─┬─► WxPusher HTTPS push
user-questions/…   ─┤                    │
approval/request   ─┘                    └─► GET /dsh-plugin-notify/events (SSE)
                                                        │
                                                        ▼
                                            new Notification(title, {
                                              body, icon, tag,
                                              requireInteraction, silent,
                                            })  +  WebAudio chime
```

- The Host plugin registers two exact routes on `ctx.webServer`: the SSE stream at `/dsh-plugin-notify/events` and the test endpoint at `/dsh-plugin-notify/test`.
- The Client half opens an `EventSource` on the **document-relative** path `dsh-plugin-notify/events`, so it resolves under whatever mount served the page and inherits the page's own authentication. `EventSource` reconnects by itself; the Host sends a `: ping` heartbeat every 25 s.
- The settings page resolves its namespace from `ctx.configForms.describe()` — by entry id first, then by the schema it knows it owns — so it keeps working when a profile nests the bundle patch and prefixes the entry id.
- Writes go through `ConfigForm.mutate()` with **path-addressed** operations, so a secret that the wire never returned is never restated.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/dsh-plugin-notify/events` | Server-Sent Events stream of notification frames. |
| `POST` | `/dsh-plugin-notify/test` | Broadcast one test frame and push it; answers with both channel outcomes. |

## Known limitations

- WxPusher content is composed in Chinese (the WxPusher audience is the phone); the browser notification is localized through the Harness locale service.
- The "stopped" signal is the agent going idle. A session that idles mid-conversation between turns is reported once, by design — `stopDebounceMs` and `minRunMs` are the knobs.
- Nothing is persisted beyond the profile config: no history, no replay of missed notifications.
- The plugin does not create a Remote namespace, so the browser half talks to the Host over the two HTTP routes above rather than over the typed Remote channel.

## License

MIT — see [LICENSE](LICENSE).
