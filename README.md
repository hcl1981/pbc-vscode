# PBC+ for VS Code

*[Deutsch](README.de.md)*

C programming for the **PicoBoy Color Plus**, the way the handbook
[Programmieren in C](https://pbcplus.de/programmieren/c/) teaches it. The
extension creates projects from the book template and runs, debugs and
profiles them in the [PBConPC](https://github.com/hcl1981/PBConPC) emulator,
no device needed. It builds on the
[Raspberry Pi Pico](https://marketplace.visualstudio.com/items?itemName=raspberry-pi.raspberry-pi-pico)
extension, which takes care of the SDK, the compiler and flashing the PBC+.

## Features

- **New project from the book template.** Command *PBC+: New Project from the
  Book Template*: the extension downloads the current template from
  pbcplus.de (without internet it uses its bundled copy), warns about spaces
  and accented letters in the path and opens the Pico extension's import.
- **Run in PBConPC.** Click **▷ PBConPC** in the status bar to build the
  project and start it in the emulator. PBConPC gets its own empty memory, so
  whatever you keep in the emulator otherwise stays untouched.
- **Debug.** **Debug** in the status bar builds, starts PBConPC and attaches
  the debugger. The program stops at the start of `main`; breakpoints,
  stepping, variables and registers work as usual. The two cores appear as
  *core 0* and *core 1*. Before that, the extension reminds you of
  `set(CMAKE_BUILD_TYPE Debug)` (appendix F of the book) and adds the line if
  you like.
- **Profiler.** Command *PBC+: Profiler: Where Does the Time Go?*: the program
  runs with device-accurate timing. When you close the PBConPC window, a table
  shows how much time each function takes. A click jumps to the source.
- **Pins explained.** Hover over the 26 in `gpio_init(26)` to see what is
  connected: *GP26 – Backlight, PWM*.
- **Common pitfalls.** A warning appears when the serial port (UART0) is
  switched on at GP0/GP1 – that is where the PBC+ joystick is connected.
- **Snippets:** `pbc-main`, `pbc-button`, `pbc-text`, `pbc-tone` and `pbc-led`.

## Installation

1. Download `pbcplus-….vsix` from the
   [releases](https://github.com/hcl1981/pbc-vscode/releases/latest).
2. In VS Code open **Extensions**, click **…** at the top and choose
   **Install from VSIX…**. Or drag the file onto the extensions list. Or in a
   terminal: `code --install-extension pbcplus-0.2.3.vsix`
   The *Raspberry Pi Pico* extension is installed along with it; this needs
   internet once.
3. [Install PBConPC](https://github.com/hcl1981/PBConPC/releases/latest). On
   Linux with the .deb package the extension finds it by itself. Otherwise it
   asks for the program on first use; on Windows that is `pbconpc.exe` from
   the unpacked ZIP.
4. For the debugger on Linux, run `sudo apt install gdb-multiarch` once. On
   Windows the Pico extension brings the debugger along.

To update, install the new version the same way; it replaces the old one.

## Settings

| Setting | Meaning |
|---|---|
| `pbcplus.pbconpcPath` | path to PBConPC if it is not found automatically |
| `pbcplus.gdbPath` | path to the GDB debugger |
| `pbcplus.usbTerminal` | show what the program prints with `printf` in the PBConPC window |
| `pbcplus.exactTiming` | device-accurate timing when running (`--exact-bus`), slower |
| `pbcplus.templateUrl` | where the project template comes from |

## Good to know

- To put your program on the PBC+ itself, use the Pico extension as usual
  (**Run** in the status bar) or copy the `.uf2` to the drive in BOOT mode.
- In Restricted Mode (an untrusted folder) only the new-project command and
  the editor help work. Click **Restricted Mode** in the status bar and trust
  the folder to build, run and debug.
- PBConPC is available for Windows, Linux and Android, not yet for the Mac.
  Without PBConPC only the project template and the editor help work.

## Language

The extension is in English and switches to German when VS Code is set to
German (German Language Pack).

## Licence

MIT, © Jan Schulz. The bundled project template (`template/pbc-vorlage.zip`)
is the same as on pbcplus.de; the notes in `pbc/LIZENZEN.txt` apply to the
library and fonts inside it.
