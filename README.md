# Claude Live Screen

An open-source desktop assistant for **Windows and macOS** that lets Claude watch your screen live and give fast, real-time advice about whatever you're looking at — error messages, code, documents, settings dialogs, anything.

- 👀 **Auto-watch** — captures your screen on an interval and proactively points out problems or next steps (only when the screen actually changes).
- 💬 **Ask anything** — type a question and Claude answers it about the current screen.
- 🪟 **Always-on-top overlay** — a small floating card streams Claude's advice in real time while you work. Supports click-through "ghost" mode.
- ⚡ **Built for speed** — streaming responses, a "Fast" mode (minimal thinking + low effort), downscaled JPEG frames, prompt caching, and frame de-duplication.
- 🙈 **Doesn't see itself** — the app's own windows are excluded from capture, so no feedback loops.
- 🔴 **Hard off-switch, off by default** — Claude sees nothing until you flip the switch. No background capture, no surprise API bills.
- 🧩 **Companion Claude Code skill** — already pay for a Claude subscription? Skip the API key entirely with [`/claude-screen`](https://github.com/jadstrike/claude-screen-skill).

## Install

**Download the installer** from the [**latest release**](https://github.com/jadstrike/claude-live-screen/releases/latest), then run it:

| Platform | File |
|---|---|
| Windows 10/11 (x64) | `Claude-Live-Screen-Setup-<version>-x64.exe` |
| macOS (Apple Silicon) | `Claude-Live-Screen-<version>-mac-arm64.dmg` |
| macOS (Intel) | `Claude-Live-Screen-<version>-mac-x64.dmg` |

> **These builds are unsigned**, because code-signing certificates cost more than this project earns. Each OS warns once on first launch — this is expected:
> - **Windows** — SmartScreen "Windows protected your PC" → **More info → Run anyway**
> - **macOS** — "developer cannot be verified" → **right-click the app → Open**, or `xattr -cr "/Applications/Claude Live Screen.app"`

You'll need an [Anthropic API key](https://platform.claude.com/). To use a Claude subscription you already pay for instead, see the [Claude Code skill](https://github.com/jadstrike/claude-screen-skill).

<details>
<summary><b>Alternative: run from source</b> (no security warning)</summary>

Requires [Node.js](https://nodejs.org) 18+. Avoids the unsigned-build warning entirely, because the Electron runtime npm downloads is already signed and notarised upstream.

```bash
git clone https://github.com/jadstrike/claude-live-screen.git
cd claude-live-screen
npm install
npm start
```

</details>

> ⚠️ **This app cannot run inside WSL.** WSL has no Windows desktop to draw on, and would capture the Linux desktop rather than your real screen. Install it on Windows or macOS directly.

## First run

1. Launch **Claude Live Screen**.
2. Open **Settings**, paste your Anthropic API key, click **Save**.
3. Flip **AI screen vision** to **ON** (or press `Ctrl/Cmd+Shift+S`). It is off every launch by design.
4. Click **Start watching** — Claude checks your screen every few seconds and speaks up when something matters. Or type a question and press **Ask**.
5. Press `Ctrl/Cmd+Shift+S` again to switch vision off when you're done.

On macOS, the first capture asks for **Screen Recording** permission. Grant it in System Settings → Privacy & Security → Screen Recording, then restart the app.

## The master switch

Both the app and the skill ship with a single idea at the centre: **Claude can only see your screen while you have explicitly turned vision on.**

| | Desktop app | [Claude Code skill](https://github.com/jadstrike/claude-screen-skill) |
|---|---|---|
| Default | OFF at every launch | OFF (state file seeded at install) |
| Turn on | Toggle in the app, ⏻ on the overlay, or `Ctrl/Cmd+Shift+S` | `/claude-screen on` |
| Turn off | Same three ways | `/claude-screen off` |
| Check | Status dot + label | `/claude-screen status` |
| While off | Capture is never attempted; watch mode stops | Capture script **exits with an error** — the guard is in the script, not just the prompt |
| Auto-off | — | After any watch session ends |

The state is deliberately **not** persisted across launches in the desktop app: every start begins with vision off, so a forgotten "on" from last week can never quietly resume capturing. While off, the Start-watching, Analyze and Ask controls are disabled, the status reads *Vision off*, and no frame is ever captured — the check sits in the main process, ahead of any capture call.

## Already using Claude Code? (no API key needed)

If you have a Claude subscription and use [Claude Code](https://claude.com/claude-code), there's a companion project that needs **no API key and no app at all**:

### 👉 [**claude-screen-skill**](https://github.com/jadstrike/claude-screen-skill) — `/claude-screen` for Claude Code

```bash
git clone https://github.com/jadstrike/claude-screen-skill.git
cd claude-screen-skill && ./install.sh
```

It runs on the Claude subscription you already pay for, works on macOS/Windows/Linux/WSL, and has the same off-by-default master switch.

| | Skill | This app |
|---|---|---|
| Cost | Your Claude subscription | Anthropic API usage |
| Setup | One script | Install app + API key |
| Speed | A few seconds per frame | Sub-second streaming |
| Best for | Occasional "look at this" | Continuous over-the-shoulder help |

## Hotkeys

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+Shift+S` | Turn screen vision on / off (master switch) |
| `Ctrl/Cmd+Shift+A` | Analyze the screen right now |
| `Ctrl/Cmd+Shift+O` | Show / hide the overlay |

## Settings

| Setting | Default | Notes |
|---|---|---|
| Model | Claude Opus 5 | Sonnet 5 (balanced) and Haiku 4.5 (lowest latency) also available |
| Response mode | Fast | "Fast" disables extended thinking and uses low effort for sub-second-feel replies; "Thorough" enables adaptive thinking at high effort |
| Capture interval | 3 s | Minimum 1 s |
| Only send when the screen changes | On | Skips API calls when consecutive frames are identical |
| Display to watch | Primary | Multi-monitor supported |
| Auto-watch instruction | Built-in prompt | What Claude is asked on each automatic check |

## How it works

```
┌─────────────────────────── Electron main process ───────────────────────────┐
│  desktopCapturer ──▶ JPEG frame (≤1568px, deduped by hash)                  │
│        │                                                                    │
│        ▼                                                                    │
│  Anthropic Messages API (streaming, vision) ──▶ IPC events                  │
└──────────────┬──────────────────────────────────────────────┬───────────────┘
               ▼                                              ▼
        Control window                              Always-on-top overlay
   (settings, feed, ask box)                     (live streaming advice card)
```

- Frames are captured with Electron's `desktopCapturer` (no native modules needed), downscaled, and JPEG-compressed to keep vision-token cost and latency low.
- A short rolling text history (last 6 exchanges) gives Claude conversational context without re-sending old screenshots.
- The system prompt is marked for prompt caching, and responses stream token-by-token to both windows.
- Both app windows call `setContentProtection(true)`, so they are invisible to the capture — Claude never analyzes its own advice.

## Privacy & cost

- **The switch is the primary control.** Vision is off by default and stays off until you turn it on, so the app costs nothing and sees nothing while idle. Turn it off (`Ctrl/Cmd+Shift+S`) before opening anything private.
- **Your screen content is sent to the Anthropic API** for analysis while vision is on. Don't run auto-watch while sensitive material (passwords, private documents, other people's data) is on screen — or use the "only on change" + longer interval settings, or stop watching.
- Nothing is stored server-side by this app; screenshots exist only in memory for the duration of a request.
- Each auto-check is one vision API request. At the default 3-second interval with change detection, a busy screen can generate ~10–20 requests/minute. Watch the token counter in the footer, lengthen the interval, or switch to Haiku 4.5 to reduce cost.

## Building installers yourself

```bash
npm run icon       # regenerate build/icon.png (pure Node, no image tools needed)
npm run dist:win   # .exe NSIS installer (x64)
npm run dist:mac   # .dmg (arm64 + x64)
```

Output lands in `dist/`. **Each installer must be built on its own OS**: run `dist:win` on Windows and `dist:mac` on macOS.

> **Building for the wrong OS fails by design.** On Linux or WSL, `npm run dist:win` stops with:
> ```
> ⨯ wine is required, please see https://electron.build/multi-platform-build#linux
> ```
> That's expected — electron-builder shells out to Wine to stamp the icon and metadata into the Windows binary. `npm run dist:mac` can't work off a Mac at all, since Apple's tooling is macOS-only. **You don't need to solve this**: CI already builds both on real runners. Just push a tag (below) and download the results.

Releases are produced by GitHub Actions (`.github/workflows/build.yml`), which builds on real macOS and Windows runners, then publishes both installers to the release in a single step when a `v*` tag is pushed:

```bash
npm version patch      # or minor / major — creates the commit and tag
git push --follow-tags # CI builds both installers and publishes the release
```

To produce signed, warning-free builds, add your certificates as repository secrets and configure `build.mac` / `build.win` in `package.json`.

## Development notes & limitations

- Developing inside **WSL2**: the app runs under WSLg, but it will capture the WSLg desktop, not your Windows desktop. For real testing, run it on Windows (or macOS) natively.
- Change detection is a byte-level hash — a blinking cursor or clock inside the captured area counts as a change. Region-based diffing is a welcome contribution.
- Linux mostly works (X11; Wayland needs PipeWire portals) but isn't an official target yet.

## Contributing

Issues and PRs are welcome. Good first contributions: region-of-interest capture, response text-to-speech, per-app watch filters, smarter frame diffing, tray icon.

## License

[MIT](./LICENSE)
