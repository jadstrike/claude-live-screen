const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  globalShortcut,
  safeStorage,
  systemPreferences,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");

const SYSTEM_PROMPT = `You are a real-time screen assistant. The user shares live screenshots of their screen and you give immediate, practical help about what is visible.

Rules:
- Be fast and brief: 1-4 short sentences, or a compact bullet list. No preamble, no headers.
- Lead with the single most useful observation or answer.
- If you see an error message, name the likely cause and the exact fix first.
- If the screen shows code, point out bugs or the next step, referencing the visible line or symbol.
- If the user asked a question, answer it directly about what is on screen.
- Never describe the screen back to the user unless they ask; they can already see it.
- If nothing on screen needs attention and there is no question, reply with exactly: Nothing notable.
- Do not include internal or system XML tags in your response.`;

const DEFAULT_AUTO_PROMPT =
  "Here is my current screen. If anything looks wrong, or you have one high-value tip about what I'm doing, tell me briefly. Otherwise reply: Nothing notable.";

const DEFAULT_SETTINGS = {
  apiKeyEncrypted: null,
  apiKeyPlain: null, // fallback when OS encryption is unavailable
  model: "claude-opus-5",
  responseMode: "fast", // "fast" | "thorough"
  intervalMs: 3000,
  onlyOnChange: true,
  autoPrompt: DEFAULT_AUTO_PROMPT,
  maxImageEdge: 1568,
  maxTokens: 1024,
  displayId: null,
  historyPairs: 6,
};

let mainWindow = null;
let overlayWindow = null;
let watchTimer = null;
let busy = false;
let lastFrameHash = null;
let history = []; // alternating {role, content} text turns, capped

// Master switch. OFF at every launch — nothing is captured or sent while off,
// so no API cost and no privacy exposure until the user explicitly enables it.
let visionEnabled = false;

function setVision(enabled) {
  visionEnabled = Boolean(enabled);
  if (!visionEnabled) stopWatch();
  broadcast("vision", { enabled: visionEnabled });
  broadcast("status", {
    state: visionEnabled ? (watchTimer ? "watching" : "idle") : "off",
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function storeApiKey(settings, plainKey) {
  if (!plainKey) {
    settings.apiKeyEncrypted = null;
    settings.apiKeyPlain = null;
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    settings.apiKeyEncrypted = safeStorage.encryptString(plainKey).toString("base64");
    settings.apiKeyPlain = null;
  } else {
    settings.apiKeyEncrypted = null;
    settings.apiKeyPlain = plainKey;
  }
}

function getApiKey() {
  const settings = loadSettings();
  if (settings.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(settings.apiKeyEncrypted, "base64"));
    } catch {
      return null;
    }
  }
  return settings.apiKeyPlain || null;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

function getClient() {
  const key = getApiKey();
  // With no stored key, the SDK still resolves ANTHROPIC_API_KEY /
  // ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile from the environment.
  return key ? new Anthropic({ apiKey: key }) : new Anthropic();
}

function buildRequestParams(settings, frameBase64, question) {
  const params = {
    model: settings.model,
    max_tokens: settings.maxTokens || 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      ...history,
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: frameBase64 },
          },
          { type: "text", text: question },
        ],
      },
    ],
  };

  // Effort + explicit thinking control exist on the Opus 5 / Sonnet 5 tier.
  // Haiku 4.5 accepts neither parameter and runs without thinking by default.
  const supportsEffort =
    settings.model.startsWith("claude-opus-5") || settings.model.startsWith("claude-sonnet-5");
  if (supportsEffort) {
    if (settings.responseMode === "fast") {
      params.thinking = { type: "disabled" };
      params.output_config = { effort: "low" };
    } else {
      // Omitting `thinking` runs adaptive thinking on these models.
      params.output_config = { effort: "high" };
    }
  }
  return params;
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Authentication failed. Check your Anthropic API key in Settings.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limited by the API. Increase the capture interval or wait a moment.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API. Check your internet connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `API error ${err.status}: ${err.message}`;
  }
  return err && err.message ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Screen capture
// ---------------------------------------------------------------------------

async function captureFrame() {
  const settings = loadSettings();
  const displays = screen.getAllDisplays();
  const target =
    displays.find((d) => String(d.id) === String(settings.displayId)) ||
    screen.getPrimaryDisplay();

  const maxEdge = settings.maxImageEdge || 1568;
  const scale = Math.min(1, maxEdge / Math.max(target.size.width, target.size.height));
  const thumbnailSize = {
    width: Math.max(1, Math.round(target.size.width * scale)),
    height: Math.max(1, Math.round(target.size.height * scale)),
  };

  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
  const source =
    sources.find((s) => String(s.display_id) === String(target.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;

  const jpeg = source.thumbnail.toJPEG(70);
  return {
    base64: jpeg.toString("base64"),
    hash: crypto.createHash("sha256").update(jpeg).digest("hex"),
  };
}

function screenPermissionGranted() {
  if (process.platform !== "darwin") return true;
  return systemPreferences.getMediaAccessStatus("screen") === "granted";
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function broadcast(name, payload) {
  for (const win of [mainWindow, overlayWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("app-event", name, payload || {});
    }
  }
}

function pushHistory(settings, question, answer) {
  history.push({ role: "user", content: `[screen frame] ${question}` });
  history.push({ role: "assistant", content: answer });
  const maxTurns = Math.max(0, (settings.historyPairs || 6) * 2);
  if (history.length > maxTurns) history = history.slice(history.length - maxTurns);
}

async function analyze(question, trigger, precapturedFrame) {
  if (!visionEnabled) {
    broadcast("error", {
      message:
        "Screen vision is OFF. Flip the switch in the app, press the ⏻ button on the overlay, or hit Ctrl/Cmd+Shift+S to let Claude see your screen.",
    });
    return false;
  }
  if (busy) return false;
  question = String(question || "").trim() || DEFAULT_AUTO_PROMPT;
  busy = true;
  broadcast("status", { state: "capturing", trigger });
  try {
    if (!screenPermissionGranted()) {
      broadcast("permission", { granted: false });
      throw new Error(
        "Screen Recording permission is not granted. Enable it in System Settings > Privacy & Security > Screen Recording, then restart the app."
      );
    }

    const frame = precapturedFrame || (await captureFrame());
    if (!frame) throw new Error("Could not capture the screen.");
    lastFrameHash = frame.hash;

    const settings = loadSettings();
    const params = buildRequestParams(settings, frame.base64, question);
    const client = getClient();

    broadcast("status", { state: "thinking", trigger });
    broadcast("stream-start", { question, trigger });

    const stream = client.messages.stream(params);
    stream.on("text", (delta) => broadcast("stream-delta", { text: delta }));
    const final = await stream.finalMessage();

    if (final.stop_reason === "refusal") {
      broadcast("stream-end", { text: "", aborted: true });
      broadcast("error", { message: "Claude declined to respond to this screen content." });
      return true;
    }

    const text = final.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    pushHistory(settings, question, text);
    broadcast("stream-end", {
      text,
      truncated: final.stop_reason === "max_tokens",
      usage: {
        input: final.usage.input_tokens,
        output: final.usage.output_tokens,
        cacheRead: final.usage.cache_read_input_tokens || 0,
        cacheWrite: final.usage.cache_creation_input_tokens || 0,
      },
      model: final.model,
    });
    return true;
  } catch (err) {
    broadcast("stream-end", { text: "", aborted: true });
    broadcast("error", { message: describeError(err) });
    return false;
  } finally {
    busy = false;
    broadcast("status", {
      state: visionEnabled ? (watchTimer ? "watching" : "idle") : "off",
    });
  }
}

// ---------------------------------------------------------------------------
// Auto-watch loop
// ---------------------------------------------------------------------------

async function watchTick() {
  if (!visionEnabled) return;
  if (busy) return; // drop this frame; a response is still streaming
  const settings = loadSettings();
  let frame;
  try {
    frame = await captureFrame();
  } catch {
    return;
  }
  if (!frame) return;
  if (settings.onlyOnChange && frame.hash === lastFrameHash) return;
  await analyze(settings.autoPrompt || DEFAULT_AUTO_PROMPT, "auto", frame);
}

function startWatch() {
  if (!visionEnabled) {
    broadcast("error", {
      message:
        "Turn the screen-vision switch on first — it stays off by default to save cost.",
    });
    return;
  }
  const settings = loadSettings();
  stopWatch();
  watchTimer = setInterval(watchTick, Math.max(1000, settings.intervalMs || 3000));
  broadcast("watch", { active: true });
  broadcast("status", { state: "watching" });
  watchTick();
}

function stopWatch() {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  broadcast("watch", { active: false });
  broadcast("status", { state: visionEnabled ? "idle" : "off" });
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 780,
    minWidth: 420,
    minHeight: 560,
    title: "Claude Live Screen",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Exclude our own windows from screen capture so Claude never sees itself.
  mainWindow.setContentProtection(true);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const width = 400;
  const height = 280;
  overlayWindow = new BrowserWindow({
    width,
    height,
    x: display.workArea.x + display.workArea.width - width - 24,
    y: display.workArea.y + 24,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setContentProtection(true);
  overlayWindow.loadFile(path.join(__dirname, "renderer", "overlay.html"));
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle("settings:get", () => {
    const s = loadSettings();
    return {
      model: s.model,
      responseMode: s.responseMode,
      intervalMs: s.intervalMs,
      onlyOnChange: s.onlyOnChange,
      autoPrompt: s.autoPrompt,
      maxImageEdge: s.maxImageEdge,
      maxTokens: s.maxTokens,
      displayId: s.displayId,
      hasApiKey: Boolean(getApiKey()),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      screenPermissionGranted: screenPermissionGranted(),
      watching: Boolean(watchTimer),
      visionEnabled,
      platform: process.platform,
    };
  });

  ipcMain.handle("vision:set", (_event, enabled) => {
    setVision(enabled);
    return visionEnabled;
  });

  ipcMain.handle("settings:set", (_event, incoming) => {
    const settings = loadSettings();
    const editable = [
      "model",
      "responseMode",
      "intervalMs",
      "onlyOnChange",
      "autoPrompt",
      "maxImageEdge",
      "maxTokens",
      "displayId",
    ];
    for (const key of editable) {
      if (key in incoming) settings[key] = incoming[key];
    }
    if ("apiKey" in incoming) storeApiKey(settings, incoming.apiKey);
    saveSettings(settings);
    if (watchTimer) startWatch(); // apply a new interval immediately
    return { ok: true, hasApiKey: Boolean(getApiKey()) };
  });

  ipcMain.handle("displays:list", () => {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d) => ({
      id: String(d.id),
      label: `${d.label || "Display"} (${d.size.width}x${d.size.height})${
        d.id === primaryId ? " — primary" : ""
      }`,
    }));
  });

  ipcMain.handle("watch:start", () => {
    startWatch();
    return true;
  });
  ipcMain.handle("watch:stop", () => {
    stopWatch();
    return true;
  });
  ipcMain.handle("analyze:now", () => analyze(loadSettings().autoPrompt, "manual"));
  ipcMain.handle("ask", (_event, question) => {
    const q = String(question || "").trim();
    if (!q) return false;
    return analyze(q, "ask");
  });
  ipcMain.handle("history:clear", () => {
    history = [];
    return true;
  });

  ipcMain.handle("overlay:set-click-through", (_event, enabled) => {
    if (overlayWindow) {
      overlayWindow.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
    }
    return true;
  });
  ipcMain.handle("overlay:hide", () => {
    if (overlayWindow) overlayWindow.hide();
    return true;
  });
  ipcMain.handle("open-screen-permission-settings", () => {
    if (process.platform === "darwin") {
      shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      );
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();
  createOverlayWindow();

  globalShortcut.register("CommandOrControl+Shift+A", () => {
    analyze(loadSettings().autoPrompt, "hotkey");
  });
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    setVision(!visionEnabled);
  });
  globalShortcut.register("CommandOrControl+Shift+O", () => {
    if (!overlayWindow) {
      createOverlayWindow();
    } else if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();
    }
  });

  // On macOS, asking for a thumbnail triggers the system permission prompt
  // the first time; report status so the UI can guide the user.
  if (process.platform === "darwin" && !screenPermissionGranted()) {
    broadcast("permission", { granted: false });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createOverlayWindow();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopWatch();
});

app.on("window-all-closed", () => {
  app.quit();
});
