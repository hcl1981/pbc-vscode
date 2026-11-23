# PBC+ für VS Code

*[English](README.md)*

Programmieren in C für den **PicoBoy Color Plus**, so wie im Handbuch
[Programmieren in C](https://pbcplus.de/programmieren/c/). Die Erweiterung legt
Projekte aus der Buchvorlage an und startet, debuggt und misst sie im Emulator
[PBConPC](https://pbcplus.de/geraet/am-pc/), ganz ohne Gerät. Sie baut auf der
Erweiterung [Raspberry Pi Pico](https://marketplace.visualstudio.com/items?itemName=raspberry-pi.raspberry-pi-pico)
auf, die sich um SDK, Compiler und das Aufspielen auf den PBC+ kümmert.

## Was sie kann

- **Neues Projekt aus der Buchvorlage.** Befehl *PBC+: Neues Projekt aus der
  Buchvorlage*: Die Erweiterung holt die aktuelle Vorlage von pbcplus.de (ohne
  Internet nimmt sie ihre mitgelieferte), warnt vor Leerzeichen und Umlauten
  im Pfad und öffnet gleich den Import der Pico-Erweiterung.
- **Im PBConPC starten.** Ein Klick auf **▷ PBConPC** in der Statusleiste baut
  das Projekt und startet es im Emulator. PBConPC bekommt dabei einen eigenen,
  leeren Speicher: Was du sonst im Emulator hast, bleibt unberührt.
- **Debuggen.** **Debuggen** in der Statusleiste baut, startet PBConPC und
  verbindet den Debugger. Das Programm hält am Anfang von `main`; danach gehen
  Haltepunkte, Einzelschritt, Variablen und Register wie gewohnt. Die beiden
  Kerne erscheinen als *core 0* und *core 1*. Vorher erinnert die Erweiterung
  an `set(CMAKE_BUILD_TYPE Debug)` (Anhang F des Buchs) und trägt die Zeile auf
  Wunsch ein.
- **Profiler.** Befehl *PBC+: Profiler: Wo bleibt die Zeit?*: Das Programm läuft
  mit gerätegenauen Zeiten. Nach dem Schließen des PBConPC-Fensters zeigt eine
  Tabelle, welche Funktion wie viel Zeit braucht. Ein Klick führt zur Stelle
  im Quelltext.
- **Pins erklärt.** Fährst du in `gpio_init(26)` mit der Maus über die 26,
  steht dort, was am Pin hängt: *GP26 – Hintergrundlicht, PWM*.
- **Typische Fallen.** Eine Warnung erscheint, wenn die serielle Schnittstelle
  (UART0) auf GP0/GP1 eingeschaltet wird – dort hängt beim PBC+ der Joystick.
- **Vorlagen zum Tippen:** `pbc-main`, `pbc-button`, `pbc-text`, `pbc-tone`
  und `pbc-led`.

## Installieren

1. Die Datei `pbcplus-….vsix` von den
   [Releases](https://github.com/hcl1981/pbc-vscode/releases/latest) herunterladen.
2. In VS Code links die **Erweiterungen** öffnen, oben auf **…** klicken und
   **Aus VSIX installieren…** wählen. Oder die Datei in die Liste der
   Erweiterungen ziehen. Oder im Terminal:
   `code --install-extension pbcplus-0.2.1.vsix`
   Die Erweiterung *Raspberry Pi Pico* kommt dabei automatisch mit; dafür
   braucht es einmal Internet.
3. [PBConPC installieren](https://pbcplus.de/geraet/am-pc/). Unter Linux mit
   dem .deb-Paket findet die Erweiterung es von selbst. Sonst fragt sie beim
   ersten Start nach dem Programm, unter Windows ist das `pbconpc.exe` aus dem
   entpackten ZIP.
4. Für den Debugger unter Linux einmal `sudo apt install gdb-multiarch`. Unter
   Windows bringt die Pico-Erweiterung den Debugger mit.

Eine neue Fassung installierst du genauso; die alte wird dabei ersetzt.

## Einstellungen

| Einstellung | Bedeutung |
|---|---|
| `pbcplus.pbconpcPath` | Pfad zu PBConPC, wenn es nicht von selbst gefunden wird |
| `pbcplus.gdbPath` | Pfad zum Debugger GDB |
| `pbcplus.usbTerminal` | im PBConPC-Fenster zeigen, was das Programm mit `printf` ausgibt |
| `pbcplus.exactTiming` | beim Starten gerätegenaue Zeiten (`--exact-bus`), langsamer |
| `pbcplus.templateUrl` | woher die Projektvorlage kommt |

## Gut zu wissen

- Auf den PBC+ selbst spielst du dein Programm wie gewohnt mit der
  Pico-Erweiterung auf (**Run** in der Statusleiste) oder kopierst die `.uf2`
  im BOOT-Modus auf das Laufwerk.
- Im eingeschränkten Modus (Restricted Mode, Ordner ohne Vertrauen) gehen nur
  „Neues Projekt“ und die Hilfen im Editor. Zum Bauen, Starten und Debuggen
  unten links auf **Restricted Mode** klicken und dem Ordner vertrauen.
- PBConPC gibt es für Windows, Linux und Android, für den Mac noch nicht.
  Ohne PBConPC funktionieren nur die Projektvorlage und die Hilfen im Editor.

## Sprache

Die Erweiterung ist auf Englisch und schaltet auf Deutsch um, wenn VS Code auf
Deutsch eingestellt ist (Sprachpaket „German Language Pack“).

## Lizenz

MIT, © Jan Schulz. Die mitgelieferte Projektvorlage (`template/pbc-vorlage.zip`)
ist dieselbe wie auf pbcplus.de; für die Bibliothek und die Schriften darin
gelten die Angaben in `pbc/LIZENZEN.txt`.
