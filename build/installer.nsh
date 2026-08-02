; Custom NSIS hooks for the Windows installer.
;
; On uninstall, offer to remove the user's settings folder as well. That folder
; holds settings.json, which contains the saved Anthropic API key, so leaving it
; behind after an uninstall is both clutter and a small credential-hygiene
; problem. The prompt defaults to "No" so nothing is destroyed by accident.

; electron-builder defines PRODUCT_NAME; fall back so the script still compiles
; standalone and so a rename cannot silently target the wrong directory.
!ifndef PRODUCT_NAME
  !define PRODUCT_NAME "Claude Live Screen"
!endif

!macro customUnInstall
  ; ${isUpdated} is true when the uninstaller runs as part of an upgrade —
  ; never delete settings then, only on a genuine uninstall.
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Also delete your Claude Live Screen settings?$\r$\n$\r$\nThis removes your saved Anthropic API key and preferences. Choose No to keep them for a future reinstall." \
      /SD IDNO IDNO claudeKeepAppData
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
      RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"
    claudeKeepAppData:
  ${endIf}
!macroend
