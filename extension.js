'use strict';
// PBC+ für VS Code: Projekte aus der Buchvorlage, Starten, Debuggen und
// Profilieren im Emulator PBConPC. Baut auf der Raspberry-Pi-Pico-Erweiterung auf.
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const https = require('https');
const zip = require('./lib/zip');
const { PINS } = require('./lib/pins');

const PICO = 'raspberry-pi.raspberry-pi-pico';
const CORTEX = 'marus25.cortex-debug';
const PBCONPC_SEITE = 'https://pbcplus.de/geraet/am-pc/';
const DEBUG_NAME = 'PBC+ im PBConPC';

let ausgabe;              // Ausgabekanal „PBC+“
let emulator = null;      // laufender PBConPC-Prozess
let diagnose;             // Hinweise zu typischen Fallen
const statusleiste = [];

// ---------------------------------------------------------------- Hilfen

function einstellung(name) {
    return vscode.workspace.getConfiguration('pbcplus').get(name);
}

function log(text) {
    ausgabe.appendLine(text);
}

function wurzel() {
    const ordner = vscode.workspace.workspaceFolders;
    return ordner && ordner.length ? ordner[0] : null;
}

function istPbcProjekt(ordner) {
    if (!ordner) return false;
    try {
        const cmake = fs.readFileSync(path.join(ordner.uri.fsPath, 'CMakeLists.txt'), 'utf8');
        return /pbc_plus/.test(cmake) || fs.existsSync(path.join(ordner.uri.fsPath, 'pbc', 'pbc.h'));
    } catch {
        return false;
    }
}

function imPfad(programm) {
    const endungen = process.platform === 'win32' ? ['.exe', ''] : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        for (const e of endungen) {
            const p = path.join(dir, programm + e);
            try {
                if (fs.statSync(p).isFile()) return p;
            } catch { /* weiter */ }
        }
    }
    return null;
}

function hatErweiterung(id) {
    return !!vscode.extensions.getExtension(id);
}

async function picoBefehl(befehl, ...args) {
    if (!hatErweiterung(PICO)) return undefined;
    try {
        return await vscode.commands.executeCommand('raspberry-pi-pico.' + befehl, ...args);
    } catch (e) {
        log(`Pico-Erweiterung, ${befehl}: ${e.message || e}`);
        return undefined;
    }
}

function freierPort() {
    return new Promise((ok, fehler) => {
        const s = net.createServer();
        s.unref();
        s.on('error', fehler);
        s.listen(0, '127.0.0.1', () => {
            const port = s.address().port;
            s.close(() => ok(port));
        });
    });
}

// Wartet, bis PBConPC eine Zeile mit `text` ausgibt. Nicht per Verbindung
// prüfen: Jede Verbindung zum GDB-Port gilt als Debugger und lässt die
// Maschine danach weiterlaufen.
function warteAufAusgabe(p, text, ms) {
    return new Promise((ok, fehler) => {
        let puffer = '';
        const zeit = setTimeout(() => fehler(new Error('PBConPC antwortet nicht')), ms);
        const lesen = d => {
            puffer += d.toString();
            if (puffer.includes(text)) { clearTimeout(zeit); ok(); }
        };
        p.stdout.on('data', lesen);
        p.stderr.on('data', lesen);
        p.once('exit', () => { clearTimeout(zeit); fehler(new Error('PBConPC wurde beendet')); });
    });
}

// ---------------------------------------------------------------- PBConPC finden

async function pbconpcPfad(fragen = true) {
    const gesetzt = einstellung('pbconpcPfad');
    if (gesetzt) {
        if (fs.existsSync(gesetzt)) return gesetzt;
        vscode.window.showWarningMessage(`PBConPC nicht gefunden: ${gesetzt}`);
    } else {
        const gefunden = imPfad('pbconpc');
        if (gefunden) return gefunden;
    }
    if (!fragen) return null;
    const wahl = await vscode.window.showInformationMessage(
        'Wo liegt PBConPC? Unter Windows ist es die Datei pbconpc.exe aus dem entpackten ZIP.',
        'Programm auswählen', 'PBConPC herunterladen');
    if (wahl === 'PBConPC herunterladen') {
        vscode.env.openExternal(vscode.Uri.parse(PBCONPC_SEITE));
        return null;
    }
    if (wahl === 'Programm auswählen') return pbconpcWaehlen();
    return null;
}

async function pbconpcWaehlen() {
    const filter = process.platform === 'win32' ? { 'PBConPC': ['exe'] } : undefined;
    const datei = await vscode.window.showOpenDialog({
        canSelectMany: false, openLabel: 'PBConPC verwenden', title: 'PBConPC auswählen', filters: filter,
    });
    if (!datei) return null;
    const p = datei[0].fsPath;
    await vscode.workspace.getConfiguration('pbcplus').update('pbconpcPfad', p, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`PBConPC: ${p}`);
    return p;
}

// ---------------------------------------------------------------- Bauen

function projektName(root) {
    try {
        const cmake = fs.readFileSync(path.join(root, 'CMakeLists.txt'), 'utf8');
        const m = cmake.match(/^\s*project\s*\(\s*([A-Za-z0-9_.+-]+)/m);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

function aufgabeAusfuehren(name, befehl, args, cwd) {
    const task = new vscode.Task({ type: 'pbcplus' }, vscode.TaskScope.Workspace, name, 'PBC+',
        new vscode.ProcessExecution(befehl, args, { cwd }), ['$gcc']);
    return new Promise(async (ok) => {
        const weg = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution.task === task) { weg.dispose(); ok(e.exitCode === 0); }
        });
        try {
            await vscode.tasks.executeTask(task);
        } catch (e) {
            weg.dispose();
            log(`Bauen: ${e.message || e}`);
            ok(false);
        }
    });
}

// Baut das Projekt und liefert { elf, uf2 } oder null.
async function bauen() {
    const ordner = wurzel();
    if (!ordner) {
        vscode.window.showErrorMessage('Öffne zuerst einen Projektordner.');
        return null;
    }
    const root = ordner.uri.fsPath;
    await vscode.workspace.saveAll(false);

    let elf = null;
    if (hatErweiterung(PICO) && fs.existsSync(path.join(root, '.vscode', 'tasks.json'))) {
        // Die Pico-Erweiterung baut und nennt den Pfad der .elf-Datei.
        try {
            elf = await vscode.commands.executeCommand('raspberry-pi-pico.launchTargetPath');
        } catch (e) {
            vscode.window.showErrorMessage('Das Bauen hat nicht geklappt. Die Fehlermeldung steht im Terminal.');
            return null;
        }
    } else {
        const name = projektName(root);
        if (!name || !fs.existsSync(path.join(root, 'build'))) {
            const wahl = await vscode.window.showErrorMessage(
                'Das Projekt ist noch nicht eingerichtet. Importiere es einmal mit der Raspberry-Pi-Pico-Erweiterung.',
                'Projekt importieren');
            if (wahl) importieren(ordner.uri);
            return null;
        }
        const cmake = imPfad('cmake') || 'cmake';
        if (!await aufgabeAusfuehren('Bauen', cmake, ['--build', 'build'], root)) {
            vscode.window.showErrorMessage('Das Bauen hat nicht geklappt. Die Fehlermeldung steht im Terminal.');
            return null;
        }
        elf = path.join(root, 'build', name + '.elf');
    }
    if (!elf || !fs.existsSync(elf)) {
        vscode.window.showErrorMessage('Nach dem Bauen fehlt die Datei ' + (elf || '.elf') + '.');
        return null;
    }
    const uf2 = elf.replace(/\.elf$/i, '.uf2');
    if (!fs.existsSync(uf2)) {
        vscode.window.showErrorMessage('Nach dem Bauen fehlt die Datei ' + uf2 + '. Steht pico_add_extra_outputs in CMakeLists.txt?');
        return null;
    }
    return { elf, uf2, root };
}

function istDebugBau(root) {
    try {
        return /^\s*set\s*\(\s*CMAKE_BUILD_TYPE\s+Debug\s*\)/m.test(fs.readFileSync(path.join(root, 'CMakeLists.txt'), 'utf8'));
    } catch {
        return false;
    }
}

async function debugBauEintragen(root) {
    const datei = path.join(root, 'CMakeLists.txt');
    const text = fs.readFileSync(datei, 'utf8');
    const neu = text.replace(/^(\s*include\s*\(\s*pico_sdk_import\.cmake\s*\))/m, 'set(CMAKE_BUILD_TYPE Debug)\n$1');
    if (neu === text) return false;
    fs.writeFileSync(datei, neu);
    return true;
}

// ---------------------------------------------------------------- Emulator starten

function emulatorBeenden() {
    if (emulator) {
        try { emulator.kill(); } catch { /* schon weg */ }
        emulator = null;
    }
}

function emulatorStarten(programm, args, cwd, beimEnde) {
    emulatorBeenden();
    log(`> ${programm} ${args.join(' ')}`);
    const p = cp.spawn(programm, args, { cwd, windowsHide: false });
    emulator = p;
    p.stdout.on('data', d => ausgabe.append(d.toString()));
    p.stderr.on('data', d => ausgabe.append(d.toString()));
    p.on('error', e => {
        log(`PBConPC lässt sich nicht starten: ${e.message}`);
        vscode.window.showErrorMessage(`PBConPC lässt sich nicht starten: ${e.message}`);
    });
    p.on('exit', code => {
        log(`PBConPC beendet (${code})`);
        if (emulator === p) emulator = null;
        if (beimEnde) beimEnde(code);
    });
    return p;
}

function grundArgumente() {
    const args = ['--flash', 'none'];
    if (einstellung('usbTerminal')) args.push('--usb-terminal');
    return args;
}

async function starten() {
    const programm = await pbconpcPfad();
    if (!programm) return;
    const bau = await bauen();
    if (!bau) return;
    const args = grundArgumente();
    if (einstellung('genaueZeiten')) args.push('--exact-bus');
    args.push(bau.uf2);
    emulatorStarten(programm, args, bau.root);
}

// ---------------------------------------------------------------- Debuggen

async function gdbPfad() {
    const gesetzt = einstellung('gdbPfad');
    if (gesetzt) return gesetzt;
    if (process.platform !== 'win32') {
        const multi = imPfad('gdb-multiarch');
        if (multi) return multi;
    }
    const pico = await picoBefehl('getGDBPath');
    if (pico && fs.existsSync(pico)) return pico;
    return imPfad('arm-none-eabi-gdb');
}

async function toolchainOrdner() {
    const gcc = await picoBefehl('getCompilerPath');
    if (gcc && fs.existsSync(gcc)) return path.dirname(gcc);
    const imP = imPfad('arm-none-eabi-gcc');
    return imP ? path.dirname(imP) : undefined;
}

async function debuggen() {
    if (!hatErweiterung(CORTEX)) {
        const wahl = await vscode.window.showErrorMessage(
            'Zum Debuggen braucht es die Erweiterung Cortex-Debug. Sie kommt normalerweise mit der Raspberry-Pi-Pico-Erweiterung.',
            'Cortex-Debug installieren');
        if (wahl) vscode.commands.executeCommand('workbench.extensions.installExtension', CORTEX);
        return;
    }
    const programm = await pbconpcPfad();
    if (!programm) return;
    const gdb = await gdbPfad();
    if (!gdb) {
        const linux = process.platform === 'linux';
        vscode.window.showErrorMessage(linux
            ? 'Der Debugger GDB fehlt. Installiere ihn im Terminal mit: sudo apt install gdb-multiarch'
            : 'Der Debugger GDB fehlt. Er kommt mit der Raspberry-Pi-Pico-Erweiterung (arm-none-eabi-gdb).');
        return;
    }
    const ordner = wurzel();
    if (ordner && !istDebugBau(ordner.uri.fsPath) && !einstellung('debugHinweisAus')) {
        const wahl = await vscode.window.showInformationMessage(
            'Die Vorlage baut optimiert: Im Debugger springen dann Zeilen, und manche Variable fehlt. Zum Fehlersuchen besser „set(CMAKE_BUILD_TYPE Debug)“ eintragen (Anhang F des C-Buchs).',
            'Eintragen', 'So lassen', 'Nicht mehr fragen');
        if (wahl === undefined) return;
        if (wahl === 'Eintragen' && !await debugBauEintragen(ordner.uri.fsPath)) {
            vscode.window.showWarningMessage('In CMakeLists.txt fehlt die Zeile include(pico_sdk_import.cmake). Bitte von Hand eintragen.');
        }
        if (wahl === 'Nicht mehr fragen') {
            await vscode.workspace.getConfiguration('pbcplus').update('debugHinweisAus', true, vscode.ConfigurationTarget.Global);
        }
    }
    const bau = await bauen();
    if (!bau) return;

    const port = await freierPort();
    const args = grundArgumente();
    args.push(`--gdb-wait=127.0.0.1:${port}`, bau.uf2);
    let sitzung = null;
    const p = emulatorStarten(programm, args, bau.root, () => {
        if (sitzung) vscode.debug.stopDebugging(sitzung);
    });
    try {
        await warteAufAusgabe(p, 'gdb: waiting on port', 15000);
    } catch (e) {
        vscode.window.showErrorMessage(`PBConPC: ${e.message}. Mehr im Ausgabefenster „PBC+“.`);
        ausgabe.show(true);
        emulatorBeenden();
        return;
    }

    const config = {
        name: DEBUG_NAME,
        type: 'cortex-debug',
        request: 'launch',
        servertype: 'external',
        gdbTarget: `127.0.0.1:${port}`,
        executable: bau.elf,
        gdbPath: gdb,
        cwd: bau.root,
        runToEntryPoint: 'main',
        // PBConPC hat die Firmware schon im Flash und hält am ersten Befehl:
        // kein „load“ und kein „monitor reset halt“.
        overrideLaunchCommands: [],
        overrideRestartCommands: ['monitor reset'],
        showDevDebugOutput: 'none',
    };
    const tc = await toolchainOrdner();
    if (tc) config.armToolchainPath = tc;

    const ende = vscode.debug.onDidTerminateDebugSession(s => {
        if (s === sitzung || (sitzung === null && s.name === DEBUG_NAME)) {
            ende.dispose();
            anfang.dispose();
            emulatorBeenden();
        }
    });
    const anfang = vscode.debug.onDidStartDebugSession(s => {
        if (s.name === DEBUG_NAME) sitzung = s;
    });
    log('Debugger: ' + JSON.stringify(config));
    const ok = await vscode.debug.startDebugging(ordner, config);
    log('Debugger gestartet: ' + ok);
    if (!ok) {
        ende.dispose();
        anfang.dispose();
        emulatorBeenden();
    }
}

// ---------------------------------------------------------------- Profiler

function berichtLesen(text) {
    const kerne = [];
    let kern = null;
    for (const zeile of text.split(/\r?\n/)) {
        let m = zeile.match(/^core\s+(\d+):\s*busy\s+([\d.]+)\s*%,\s*sleeping[^0-9]*([\d.]+)\s*%,\s*off\s+([\d.]+)\s*%/);
        if (m) {
            kern = { nr: +m[1], busy: +m[2], schlaf: +m[3], aus: +m[4], zeilen: [] };
            kerne.push(kern);
            continue;
        }
        m = zeile.match(/^\s*([\d.]+)\s+([\d.]+)\s+([0-9a-fA-F]{6,8})\s+(.+?)\s*$/);
        if (m && kern) {
            const name = m[4].replace(/\s*\[[^\]]*\]\s*$/, '');
            kern.zeilen.push({ zeit: +m[1], busy: +m[2], adresse: m[3], name });
        }
    }
    return kerne;
}

function quellZeilen(elf, adressen, tc) {
    const a2l = tc ? path.join(tc, 'arm-none-eabi-addr2line' + (process.platform === 'win32' ? '.exe' : '')) : null;
    const programm = a2l && fs.existsSync(a2l) ? a2l : imPfad('arm-none-eabi-addr2line');
    if (!programm || !adressen.length) return {};
    try {
        const r = cp.spawnSync(programm, ['-e', elf, ...adressen.map(a => '0x' + a)], { encoding: 'utf8' });
        const zeilen = (r.stdout || '').split(/\r?\n/);
        const ergebnis = {};
        adressen.forEach((a, i) => {
            const m = (zeilen[i] || '').match(/^(.*):(\d+)/);
            if (m && m[1] !== '??' && +m[2] > 0) ergebnis[a] = { datei: m[1], zeile: +m[2] };
        });
        return ergebnis;
    } catch {
        return {};
    }
}

function html(text) {
    return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function berichtAnzeigen(kerne, quellen, roh, root) {
    const panel = vscode.window.createWebviewPanel('pbcplusProfiler', 'PBC+ Profiler', vscode.ViewColumn.Beside,
        { enableScripts: true });
    const teile = kerne.map(k => {
        const hoechster = Math.max(0.01, ...k.zeilen.map(z => z.zeit));
        const zeilen = k.zeilen.slice(0, 40).map(z => {
            const q = quellen[z.adresse];
            const eigen = q && root && path.resolve(q.datei).startsWith(path.resolve(root));
            const name = q
                ? `<a href="#" data-datei="${html(q.datei)}" data-zeile="${q.zeile}">${html(z.name)}</a>`
                : html(z.name);
            return `<tr class="${eigen ? 'eigen' : ''}"><td class="zahl">${z.zeit.toFixed(1)} %</td>
                <td class="balken"><div style="width:${(100 * z.zeit / hoechster).toFixed(1)}%"></div></td>
                <td>${name}${q ? `<span class="ort">${html(path.basename(q.datei))}:${q.zeile}</span>` : ''}</td></tr>`;
        }).join('');
        return `<h2>Kern ${k.nr}</h2>
            <p>rechnet ${k.busy} %, schläft ${k.schlaf} %, aus ${k.aus} %</p>
            ${k.aus >= 99.9 ? '' : `<table>${zeilen}</table>`}`;
    }).join('');
    panel.webview.html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 1em 2em; }
table { border-collapse: collapse; width: 100%; }
td { padding: 2px 10px 2px 0; vertical-align: middle; }
td.zahl { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 5em; }
td.balken { width: 160px; min-width: 160px; }
td.balken div { height: 10px; background: var(--vscode-charts-blue, #3794ff); border-radius: 2px; min-width: 1px; }
tr.eigen td:last-child { font-weight: 600; }
.ort { opacity: .6; margin-left: .6em; font-size: 90%; }
a { color: var(--vscode-textLink-foreground); text-decoration: none; }
a:hover { text-decoration: underline; }
details { margin-top: 2em; } pre { font-size: 90%; }
</style></head><body>
<h1>Wo bleibt die Zeit?</h1>
<p>Anteil jeder Funktion an der Zeit, gemessen im PBConPC mit gerätegenauen Zeiten. Fett: Funktionen aus deinem Projekt. Ein Klick öffnet die Stelle im Quelltext.</p>
${teile || '<p>Der Bericht enthält keine Messwerte.</p>'}
<details><summary>Bericht als Text</summary><pre>${html(roh)}</pre></details>
<script>
const vscode = acquireVsCodeApi();
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-datei]');
  if (!a) return;
  e.preventDefault();
  vscode.postMessage({ datei: a.dataset.datei, zeile: +a.dataset.zeile });
});
</script></body></html>`;
    panel.webview.onDidReceiveMessage(async m => {
        try {
            const doc = await vscode.workspace.openTextDocument(m.datei);
            const pos = new vscode.Position(Math.max(0, m.zeile - 1), 0);
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(pos, pos) });
        } catch {
            vscode.window.showWarningMessage(`Datei nicht gefunden: ${m.datei}`);
        }
    });
}

async function profiler() {
    const programm = await pbconpcPfad();
    if (!programm) return;
    const ordner = wurzel();
    if (ordner && istDebugBau(ordner.uri.fsPath)) {
        const wahl = await vscode.window.showWarningMessage(
            'In CMakeLists.txt steht „set(CMAKE_BUILD_TYPE Debug)“. Für den Profiler besser ohne diese Zeile bauen, so wie das Programm auf dem PBC+ läuft.',
            'Trotzdem messen');
        if (!wahl) return;
    }
    const bau = await bauen();
    if (!bau) return;
    const bericht = path.join(os.tmpdir(), `pbcplus-profil-${process.pid}-${Date.now()}.txt`);
    const args = grundArgumente();
    args.push('--exact-bus', `--profile=${bericht}`, `--profile-elf=${bau.elf}`, bau.uf2);
    vscode.window.showInformationMessage(
        'Der Profiler misst, solange das Programm läuft. Lass es ein paar Sekunden laufen und schließe dann das PBConPC-Fenster.');
    emulatorStarten(programm, args, bau.root, async () => {
        let roh;
        try {
            roh = fs.readFileSync(bericht, 'utf8');
            fs.unlinkSync(bericht);
        } catch {
            vscode.window.showErrorMessage('PBConPC hat keinen Bericht geschrieben. Mehr im Ausgabefenster „PBC+“.');
            return;
        }
        const kerne = berichtLesen(roh);
        const adressen = [...new Set(kerne.flatMap(k => k.zeilen.slice(0, 40).map(z => z.adresse)))];
        const quellen = quellZeilen(bau.elf, adressen, await toolchainOrdner());
        berichtAnzeigen(kerne, quellen, roh, bau.root);
    });
}

// ---------------------------------------------------------------- Neues Projekt

function vorlageLaden(url) {
    return new Promise((ok, fehler) => {
        const anfrage = https.get(url, { timeout: 8000, headers: { 'User-Agent': 'pbcplus-vscode' } }, antwort => {
            if (antwort.statusCode !== 200) {
                antwort.resume();
                return fehler(new Error('HTTP ' + antwort.statusCode));
            }
            const teile = [];
            antwort.on('data', d => teile.push(d));
            antwort.on('end', () => ok(Buffer.concat(teile)));
        });
        anfrage.on('timeout', () => anfrage.destroy(new Error('Zeitüberschreitung')));
        anfrage.on('error', fehler);
    });
}

function vorlageEntpacken(puffer, ziel) {
    const eintraege = zip.eintraege(puffer);
    // Die Vorlage liegt in einem Ordner (pbc-projekt/); der fällt weg.
    const erste = eintraege.map(e => e.name.split('/')[0]);
    const gemeinsam = erste.every(n => n === erste[0]) && eintraege.some(e => e.name.includes('/')) ? erste[0] + '/' : '';
    if (!eintraege.some(e => e.name === gemeinsam + 'CMakeLists.txt')) throw new Error('Vorlage ohne CMakeLists.txt');
    for (const e of eintraege) {
        const rel = e.name.slice(gemeinsam.length);
        if (!rel) continue;
        if (rel.split('/').includes('..') || path.isAbsolute(rel)) throw new Error('unzulässiger Pfad in der Vorlage: ' + e.name);
        const p = path.join(ziel, ...rel.split('/').filter(Boolean));
        if (e.ordner) fs.mkdirSync(p, { recursive: true });
        else {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, e.daten);
        }
    }
}

async function neuesProjekt(context) {
    const ort = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
        openLabel: 'Hier anlegen', title: 'In welchem Ordner soll das Projekt entstehen?',
    });
    if (!ort) return;
    const eltern = ort[0].fsPath;
    const name = await vscode.window.showInputBox({
        title: 'Name des Projektordners', value: 'pbc-projekt',
        prompt: 'Nur Buchstaben ohne Umlaute, Ziffern, - und _',
        validateInput: v => {
            if (!/^[A-Za-z0-9_-]+$/.test(v)) return 'Bitte nur A–Z, a–z, 0–9, - und _ verwenden, ohne Leerzeichen und Umlaute.';
            if (fs.existsSync(path.join(eltern, v))) return 'Diesen Ordner gibt es dort schon.';
            return null;
        },
    });
    if (!name) return;
    const ziel = path.join(eltern, name);
    if (/[^\x21-\x7e\\/:]/.test(eltern)) {
        const wahl = await vscode.window.showWarningMessage(
            `Im Pfad „${eltern}“ stehen Leerzeichen oder Umlaute. Damit gibt es beim Bauen oft Fehler. Besser ist ein Ordner wie C:\\PicoBoy.`,
            { modal: true }, 'Trotzdem hier anlegen');
        if (!wahl) return;
    }

    let puffer = null;
    let quelle = 'pbcplus.de';
    try {
        puffer = await vorlageLaden(einstellung('vorlageUrl'));
        zip.eintraege(puffer);
    } catch (e) {
        log(`Vorlage von ${einstellung('vorlageUrl')} nicht geladen (${e.message}), nehme die mitgelieferte.`);
        puffer = fs.readFileSync(path.join(context.extensionPath, 'vorlage', 'pbc-vorlage.zip'));
        quelle = 'der Erweiterung (ohne Internet)';
    }
    try {
        fs.mkdirSync(ziel);
        vorlageEntpacken(puffer, ziel);
    } catch (e) {
        vscode.window.showErrorMessage(`Das Projekt ließ sich nicht anlegen: ${e.message}`);
        return;
    }
    log(`Neues Projekt ${ziel}, Vorlage aus ${quelle}`);
    const uri = vscode.Uri.file(ziel);
    if (hatErweiterung(PICO)) {
        vscode.window.showInformationMessage(
            `Projekt „${name}“ angelegt. Jetzt einmal importieren: SDK-Version 2.2.0 wählen und auf „Import“ klicken.`);
        importieren(uri);
    } else {
        const wahl = await vscode.window.showWarningMessage(
            `Projekt „${name}“ angelegt. Zum Bauen fehlt noch die Erweiterung „Raspberry Pi Pico“.`,
            'Erweiterung installieren', 'Ordner öffnen');
        if (wahl === 'Erweiterung installieren') vscode.commands.executeCommand('workbench.extensions.installExtension', PICO);
        if (wahl === 'Ordner öffnen') vscode.commands.executeCommand('vscode.openFolder', uri);
    }
}

function importieren(uri) {
    vscode.commands.executeCommand('raspberry-pi-pico.importProject', uri);
}

// ---------------------------------------------------------------- Hilfen im Editor

const PIN_KONTEXT = /gpio|pwm|adc|pin|spi|i2c|uart|pio/i;

function pinHover(doc, pos) {
    const bereich = doc.getWordRangeAtPosition(pos, /\b(?:GP)?\d{1,2}\b/);
    if (!bereich) return null;
    const wort = doc.getText(bereich);
    const n = parseInt(wort.replace(/^GP/, ''), 10);
    const pin = PINS[n];
    if (!pin) return null;
    const zeile = doc.lineAt(pos.line).text;
    if (!wort.startsWith('GP') && !PIN_KONTEXT.test(zeile)) return null;
    const md = new vscode.MarkdownString(`**GP${n} – ${pin[0]}** (PicoBoy Color Plus)\n\n${pin[1]}`);
    return new vscode.Hover(md, bereich);
}

function pruefen(doc) {
    if (!diagnose) return;
    const name = path.basename(doc.fileName);
    const funde = [];
    const text = doc.getText();
    const melde = (re, nachricht) => {
        for (const m of text.matchAll(re)) {
            const start = doc.positionAt(m.index);
            const ende = doc.positionAt(m.index + m[0].length);
            const d = new vscode.Diagnostic(new vscode.Range(start, ende), nachricht, vscode.DiagnosticSeverity.Warning);
            d.source = 'PBC+';
            funde.push(d);
        }
    };
    if (name === 'CMakeLists.txt') {
        melde(/pico_enable_stdio_uart\s*\(\s*[^\s)]+\s+1\s*\)/g,
            'Die serielle Schnittstelle (UART) liegt auf GP0/GP1 – dort hängen Joystick Mitte und rechts. Für printf besser pico_enable_stdio_usb nehmen.');
    } else if (doc.languageId === 'c' || doc.languageId === 'cpp') {
        melde(/\b(?:stdio_uart_init|uart_init\s*\(\s*uart0)\b[^;]*/g,
            'UART0 liegt auf GP0/GP1 – dort hängen Joystick Mitte und rechts. Danach reagiert der Joystick nicht mehr richtig.');
        melde(/gpio_set_function\s*\(\s*[01]\s*,\s*GPIO_FUNC_UART\s*\)/g,
            'GP0/GP1 sind beim PBC+ der Joystick (Mitte und rechts), keine serielle Schnittstelle.');
    }
    diagnose.set(doc.uri, funde);
}

// ---------------------------------------------------------------- Start

function statusleisteAktualisieren() {
    const zeigen = istPbcProjekt(wurzel());
    for (const s of statusleiste) zeigen ? s.show() : s.hide();
    vscode.commands.executeCommand('setContext', 'pbcplus.projekt', zeigen);
}

function importHinweis() {
    const ordner = wurzel();
    if (!ordner || !istPbcProjekt(ordner) || !hatErweiterung(PICO)) return;
    if (fs.existsSync(path.join(ordner.uri.fsPath, '.vscode', 'tasks.json'))) return;
    vscode.window.showInformationMessage(
        'Dieses PBC+-Projekt ist noch nicht für die Raspberry-Pi-Pico-Erweiterung eingerichtet.', 'Jetzt importieren')
        .then(w => { if (w) importieren(ordner.uri); });
}

function activate(context) {
    ausgabe = vscode.window.createOutputChannel('PBC+');
    diagnose = vscode.languages.createDiagnosticCollection('pbcplus');
    const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
    reg('pbcplus.neuesProjekt', () => neuesProjekt(context));
    reg('pbcplus.starten', starten);
    reg('pbcplus.debuggen', debuggen);
    reg('pbcplus.profiler', profiler);
    reg('pbcplus.pbconpcWaehlen', pbconpcWaehlen);
    reg('pbcplus.beenden', emulatorBeenden);

    const knopf = (text, befehl, tip, prio) => {
        const s = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, prio);
        s.text = text; s.command = befehl; s.tooltip = tip;
        statusleiste.push(s);
        context.subscriptions.push(s);
    };
    knopf('$(play) PBConPC', 'pbcplus.starten', 'Bauen und im PBConPC starten', 9);
    knopf('$(debug-alt) Debuggen', 'pbcplus.debuggen', 'Bauen und im PBConPC debuggen', 8);
    statusleisteAktualisieren();
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(statusleisteAktualisieren));

    context.subscriptions.push(vscode.languages.registerHoverProvider(
        [{ language: 'c' }, { language: 'cpp' }], { provideHover: pinHover }));
    context.subscriptions.push(diagnose);
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(pruefen));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => pruefen(e.document)));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(d => diagnose.delete(d.uri)));
    vscode.workspace.textDocuments.forEach(pruefen);
    importHinweis();
}

function deactivate() {
    emulatorBeenden();
}

module.exports = { activate, deactivate, berichtLesen, vorlageEntpacken };
