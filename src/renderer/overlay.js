const api = window.claudeScreen;

const dot = document.getElementById("overlay-dot");
const title = document.getElementById("overlay-title");
const content = document.getElementById("overlay-content");
const btnGhost = document.getElementById("btn-ghost");
const btnHide = document.getElementById("btn-hide");
const btnPower = document.getElementById("btn-power");

const OFF_MESSAGE =
  "Screen vision is OFF — press ⏻ or Ctrl/Cmd+Shift+S to let Claude see your screen.";

let ghost = false;
let streaming = false;
let visionOn = false;

function applyVision(enabled) {
  visionOn = enabled;
  btnPower.classList.toggle("active", enabled);
  if (!enabled) {
    content.textContent = OFF_MESSAGE;
    content.classList.remove("muted");
  }
}

api.onEvent((name, payload) => {
  switch (name) {
    case "status": {
      const labels = {
        off: "Claude · off",
        idle: "Claude",
        watching: "Claude · watching",
        capturing: "Claude · capturing…",
        thinking: "Claude · looking…",
      };
      title.textContent = labels[payload.state] || "Claude";
      dot.className = `dot ${payload.state}`;
      break;
    }
    case "vision":
      applyVision(Boolean(payload.enabled));
      break;
    case "stream-start":
      streaming = true;
      content.textContent = "";
      break;
    case "stream-delta":
      if (streaming) {
        content.textContent += payload.text;
        content.scrollTop = content.scrollHeight;
      }
      break;
    case "stream-end":
      streaming = false;
      if (payload.text) content.textContent = payload.text;
      content.classList.toggle(
        "muted",
        /^Nothing notable\.?$/i.test((payload.text || "").trim())
      );
      break;
    case "error":
      streaming = false;
      content.textContent = `⚠ ${payload.message}`;
      break;
  }
});

btnPower.addEventListener("click", () => api.setVision(!visionOn));

btnGhost.addEventListener("click", () => {
  ghost = !ghost;
  btnGhost.classList.toggle("active", ghost);
  api.setOverlayClickThrough(ghost);
});

btnHide.addEventListener("click", () => api.hideOverlay());

// Sync initial state (vision defaults to OFF at every launch).
api.getSettings().then((s) => {
  applyVision(Boolean(s.visionEnabled));
  dot.className = `dot ${s.visionEnabled ? "idle" : "off"}`;
  title.textContent = s.visionEnabled ? "Claude" : "Claude · off";
});
