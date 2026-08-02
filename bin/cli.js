#!/usr/bin/env node
// Launcher for `npx claude-live-screen`.
//
// Running through npm avoids code-signing entirely: npm does not set macOS's
// com.apple.quarantine attribute (browsers do), and the Electron binary pulled
// from npm is already signed and notarised by the Electron project. So there is
// no Gatekeeper prompt and no SmartScreen warning on this path.
const { spawn } = require("child_process");
const path = require("path");

let electronPath;
try {
  // The `electron` package exports the absolute path to its binary.
  electronPath = require("electron");
} catch {
  console.error(
    "Could not find the Electron runtime.\n" +
      "Install the app's dependencies first:\n\n" +
      "  npm install -g claude-live-screen\n\n" +
      "or run it without installing:\n\n" +
      "  npx claude-live-screen\n"
  );
  process.exit(1);
}

if (typeof electronPath !== "string") {
  console.error(
    "The Electron runtime did not resolve to a binary path. Try reinstalling:\n\n" +
      "  npm install -g claude-live-screen --force\n"
  );
  process.exit(1);
}

const appDir = path.join(__dirname, "..");
const child = spawn(electronPath, [appDir, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: false,
});

child.on("close", (code) => process.exit(code === null ? 1 : code));
child.on("error", (err) => {
  console.error(`Failed to start Claude Live Screen: ${err.message}`);
  process.exit(1);
});
