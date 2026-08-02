const api = window.claudeScreen;

const els = {
  statusDot: document.getElementById("status-dot"),
  statusLabel: document.getElementById("status-label"),
  btnWatch: document.getElementById("btn-watch"),
  btnAnalyze: document.getElementById("btn-analyze"),
  btnClear: document.getElementById("btn-clear"),
  permissionBanner: document.getElementById("permission-banner"),
  btnOpenPermission: document.getElementById("btn-open-permission"),
  apiKey: document.getElementById("api-key"),
  btnSaveKey: document.getElementById("btn-save-key"),
  apiKeyStatus: document.getElementById("api-key-status"),
  model: document.getElementById("model"),
  responseMode: document.getElementById("response-mode"),
  interval: document.getElementById("interval"),
  onlyOnChange: document.getElementById("only-on-change"),
  display: document.getElementById("display"),
  autoPrompt: document.getElementById("auto-prompt"),
  btnSaveSettings: document.getElementById("btn-save-settings"),
  settingsStatus: document.getElementById("settings-status"),
  feed: document.getElementById("feed"),
  askForm: document.getElementById("ask-form"),
  askInput: document.getElementById("ask-input"),
  usage: document.getElementById("usage"),
  visionSwitch: document.getElementById("vision-switch"),
  visionLabel: document.getElementById("vision-label"),
};

let watching = false;
let currentEntry = null;

function setStatus(state) {
  const labels = {
    off: "Vision off",
    idle: "Idle",
    watching: "Watching",
    capturing: "Capturing…",
    thinking: "Claude is looking…",
  };
  els.statusDot.className = `dot ${state}`;
  els.statusLabel.textContent = labels[state] || state;
}

function setVisionUI(enabled) {
  els.visionSwitch.checked = enabled;
  els.visionLabel.textContent = `AI screen vision: ${enabled ? "ON" : "OFF"}`;
  for (const el of [els.btnWatch, els.btnAnalyze, els.askInput]) {
    el.disabled = !enabled;
  }
  if (!enabled) setStatus("off");
}

function setWatching(active) {
  watching = active;
  els.btnWatch.textContent = active ? "Stop watching" : "Start watching";
  els.btnWatch.classList.toggle("danger", active);
}

function addEntry(question, trigger) {
  const entry = document.createElement("div");
  entry.className = "entry";

  const q = document.createElement("div");
  q.className = "question";
  q.textContent = trigger === "ask" ? question : "(auto) screen check";
  entry.appendChild(q);

  const a = document.createElement("div");
  a.className = "answer";
  a.textContent = "";
  entry.appendChild(a);

  els.feed.appendChild(entry);
  els.feed.scrollTop = els.feed.scrollHeight;
  return { entry, answer: a };
}

function loadSettingsIntoForm(s) {
  els.model.value = s.model;
  els.responseMode.value = s.responseMode;
  els.interval.value = (s.intervalMs / 1000).toString();
  els.onlyOnChange.checked = Boolean(s.onlyOnChange);
  els.autoPrompt.value = s.autoPrompt;
  els.apiKeyStatus.textContent = s.hasApiKey
    ? "An API key is saved."
    : "No API key saved yet (ANTHROPIC_API_KEY from the environment is used if set).";
  if (!s.encryptionAvailable) {
    els.apiKeyStatus.textContent +=
      " Note: OS keychain encryption unavailable — the key is stored in plain text.";
  }
  setWatching(Boolean(s.watching));
  setVisionUI(Boolean(s.visionEnabled));
  if (s.platform === "darwin" && !s.screenPermissionGranted) {
    els.permissionBanner.classList.remove("hidden");
  }
}

async function loadDisplays(selectedId) {
  const displays = await api.listDisplays();
  els.display.innerHTML = "";
  for (const d of displays) {
    const option = document.createElement("option");
    option.value = d.id;
    option.textContent = d.label;
    els.display.appendChild(option);
  }
  if (selectedId) els.display.value = String(selectedId);
}

async function init() {
  const settings = await api.getSettings();
  loadSettingsIntoForm(settings);
  await loadDisplays(settings.displayId);

  api.onEvent((name, payload) => {
    switch (name) {
      case "status":
        setStatus(payload.state);
        break;
      case "watch":
        setWatching(payload.active);
        break;
      case "vision":
        setVisionUI(Boolean(payload.enabled));
        break;
      case "stream-start":
        currentEntry = addEntry(payload.question, payload.trigger);
        break;
      case "stream-delta":
        if (currentEntry) {
          currentEntry.answer.textContent += payload.text;
          els.feed.scrollTop = els.feed.scrollHeight;
        }
        break;
      case "stream-end":
        if (currentEntry) {
          if (payload.text) currentEntry.answer.textContent = payload.text;
          if (payload.truncated) {
            currentEntry.answer.textContent += " […response truncated]";
          }
          if (!payload.text && payload.aborted) currentEntry.entry.remove();
          if (/^Nothing notable\.?$/i.test((payload.text || "").trim())) {
            currentEntry.entry.classList.add("muted");
          }
          currentEntry = null;
        }
        if (payload.usage) {
          els.usage.textContent =
            `Last: ${payload.usage.input} in / ${payload.usage.output} out tokens` +
            (payload.usage.cacheRead ? ` (${payload.usage.cacheRead} cached)` : "") +
            ` · ${payload.model}`;
        }
        break;
      case "error": {
        const err = document.createElement("div");
        err.className = "entry error";
        err.textContent = payload.message;
        els.feed.appendChild(err);
        els.feed.scrollTop = els.feed.scrollHeight;
        break;
      }
      case "permission":
        if (!payload.granted) els.permissionBanner.classList.remove("hidden");
        break;
    }
  });
}

els.visionSwitch.addEventListener("change", () => {
  api.setVision(els.visionSwitch.checked);
});

els.btnWatch.addEventListener("click", async () => {
  if (watching) {
    await api.stopWatch();
  } else {
    await api.startWatch();
  }
});

els.btnAnalyze.addEventListener("click", () => api.analyzeNow());

els.btnClear.addEventListener("click", async () => {
  await api.clearHistory();
  els.feed.innerHTML = "";
});

els.btnOpenPermission.addEventListener("click", () =>
  api.openScreenPermissionSettings()
);

els.btnSaveKey.addEventListener("click", async () => {
  const key = els.apiKey.value.trim();
  if (!key) return;
  const result = await api.saveSettings({ apiKey: key });
  els.apiKey.value = "";
  els.apiKeyStatus.textContent = result.hasApiKey ? "API key saved." : "Could not save key.";
});

els.btnSaveSettings.addEventListener("click", async () => {
  await api.saveSettings({
    model: els.model.value,
    responseMode: els.responseMode.value,
    intervalMs: Math.round(parseFloat(els.interval.value || "3") * 1000),
    onlyOnChange: els.onlyOnChange.checked,
    displayId: els.display.value || null,
    autoPrompt: els.autoPrompt.value.trim(),
  });
  els.settingsStatus.textContent = "Saved.";
  setTimeout(() => (els.settingsStatus.textContent = ""), 2000);
});

els.askForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = els.askInput.value.trim();
  if (!question) return;
  els.askInput.value = "";
  const accepted = await api.ask(question);
  if (accepted === false) {
    els.askInput.value = question; // busy — let the user retry
  }
});

init();
