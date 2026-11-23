# Changelog

## 0.2.3

- If PBConPC is not installed, the status bar button shows a download icon,
  and the message explains what PBConPC is and where to get it.

## 0.2.2

- Publisher is now `hcl1981` (as in the VS Code Marketplace). The extension ID
  changes to `hcl1981.pbcplus`; uninstall the old `pbcplus.pbcplus` once.

## 0.2.1

- Works in Restricted Mode: a new project and the editor help are available;
  building, running and debugging offer to trust the folder.
- The Raspberry Pi Pico extension is still installed along with it, but is no
  longer required to start.

## 0.2.0

- English user interface; German when VS Code runs in German.
- Snippets renamed: `pbc-main`, `pbc-button`, `pbc-text`, `pbc-tone`, `pbc-led`.
- Settings and commands renamed to English (`pbcplus.pbconpcPath`,
  `pbcplus.gdbPath`, `pbcplus.exactTiming`, `pbcplus.hideDebugBuildHint`,
  `pbcplus.templateUrl`). Settings from 0.1.0 must be set again.

## 0.1.0

First version: new project from the book template, run, debug and profile in
PBConPC, pin hints, warning about UART0 on GP0/GP1, snippets.
