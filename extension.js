'use strict';
// PBC+ for VS Code: projects from the book template, run, debug and profile
// in the PBConPC emulator. Builds on the Raspberry Pi Pico extension.
// User-facing strings go through vscode.l10n.t (German: l10n/bundle.l10n.de.json).
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const https = require('https');
const zip = require('./lib/zip');
const { pin } = require('./lib/pins');

const t = (...a) => vscode.l10n.t(...a);
const PICO = 'raspberry-pi.raspberry-pi-pico';
const CORTEX = 'marus25.cortex-debug';
const DEBUG_NAME = 'PBC+ in PBConPC';

let output;               // output channel "PBC+"
let emulator = null;      // running PBConPC process
let diagnostics;          // hints about common pitfalls
const statusItems = [];

// ---------------------------------------------------------------- helpers

function setting(name) {
    return vscode.workspace.getConfiguration('pbcplus').get(name);
}

function log(text) {
    output.appendLine(text);
}

function german() {
    return vscode.env.language.toLowerCase().startsWith('de');
}

function pbconpcPage() {
    return german() ? 'https://pbcplus.de/geraet/am-pc/' : 'https://github.com/hcl1981/PBConPC/releases/latest';
}

function rootFolder() {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length ? folders[0] : null;
}

function isPbcProject(folder) {
    if (!folder) return false;
    try {
        const cmake = fs.readFileSync(path.join(folder.uri.fsPath, 'CMakeLists.txt'), 'utf8');
        return /pbc_plus/.test(cmake) || fs.existsSync(path.join(folder.uri.fsPath, 'pbc', 'pbc.h'));
    } catch {
        return false;
    }
}

function onPath(program) {
    const suffixes = process.platform === 'win32' ? ['.exe', ''] : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        for (const s of suffixes) {
            const p = path.join(dir, program + s);
            try {
                if (fs.statSync(p).isFile()) return p;
            } catch { /* next */ }
        }
    }
    return null;
}

function hasExtension(id) {
    return !!vscode.extensions.getExtension(id);
}

async function picoCommand(command, ...args) {
    if (!hasExtension(PICO)) return undefined;
    try {
        return await vscode.commands.executeCommand('raspberry-pi-pico.' + command, ...args);
    } catch (e) {
        log(`Pico extension, ${command}: ${e.message || e}`);
        return undefined;
    }
}

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.unref();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const port = s.address().port;
            s.close(() => resolve(port));
        });
    });
}

// Waits until PBConPC prints a line containing `text`. Do not probe the port:
// every connection to the GDB port counts as a debugger, and the machine runs
// on once it disconnects.
function waitForOutput(p, text, ms) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        const timer = setTimeout(() => reject(new Error(t('PBConPC does not respond'))), ms);
        const read = d => {
            buffer += d.toString();
            if (buffer.includes(text)) { clearTimeout(timer); resolve(); }
        };
        p.stdout.on('data', read);
        p.stderr.on('data', read);
        p.once('exit', () => { clearTimeout(timer); reject(new Error(t('PBConPC has exited'))); });
    });
}

// ---------------------------------------------------------------- finding PBConPC

async function pbconpcPath(ask = true) {
    const configured = setting('pbconpcPath');
    if (configured) {
        if (fs.existsSync(configured)) return configured;
        vscode.window.showWarningMessage(t('PBConPC not found: {0}', configured));
    } else {
        const found = onPath('pbconpc');
        if (found) return found;
    }
    if (!ask) return null;
    const choose = t('Choose program');
    const download = t('Download PBConPC');
    const choice = await vscode.window.showInformationMessage(
        t('Where is PBConPC? On Windows it is pbconpc.exe from the unpacked ZIP.'), choose, download);
    if (choice === download) {
        vscode.env.openExternal(vscode.Uri.parse(pbconpcPage()));
        return null;
    }
    if (choice === choose) return choosePbconpc();
    return null;
}

async function choosePbconpc() {
    const filters = process.platform === 'win32' ? { 'PBConPC': ['exe'] } : undefined;
    const file = await vscode.window.showOpenDialog({
        canSelectMany: false, openLabel: t('Use PBConPC'), title: t('Choose PBConPC'), filters,
    });
    if (!file) return null;
    const p = file[0].fsPath;
    await vscode.workspace.getConfiguration('pbcplus').update('pbconpcPath', p, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(t('PBConPC: {0}', p));
    return p;
}

// ---------------------------------------------------------------- building

function projectName(root) {
    try {
        const cmake = fs.readFileSync(path.join(root, 'CMakeLists.txt'), 'utf8');
        const m = cmake.match(/^\s*project\s*\(\s*([A-Za-z0-9_.+-]+)/m);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

function runTask(name, command, args, cwd) {
    const task = new vscode.Task({ type: 'pbcplus' }, vscode.TaskScope.Workspace, name, 'PBC+',
        new vscode.ProcessExecution(command, args, { cwd }), ['$gcc']);
    return new Promise(async (resolve) => {
        const done = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution.task === task) { done.dispose(); resolve(e.exitCode === 0); }
        });
        try {
            await vscode.tasks.executeTask(task);
        } catch (e) {
            done.dispose();
            log(`Build: ${e.message || e}`);
            resolve(false);
        }
    });
}

// Builds the project and returns { elf, uf2, root }, or null.
async function build() {
    const folder = rootFolder();
    if (!folder) {
        vscode.window.showErrorMessage(t('Open a project folder first.'));
        return null;
    }
    const root = folder.uri.fsPath;
    await vscode.workspace.saveAll(false);
    const failed = () => vscode.window.showErrorMessage(t('The build failed. The error message is in the terminal.'));

    let elf = null;
    if (hasExtension(PICO) && fs.existsSync(path.join(root, '.vscode', 'tasks.json'))) {
        // The Pico extension builds and returns the path of the .elf file.
        try {
            elf = await vscode.commands.executeCommand('raspberry-pi-pico.launchTargetPath');
        } catch {
            failed();
            return null;
        }
    } else {
        const name = projectName(root);
        if (!name || !fs.existsSync(path.join(root, 'build'))) {
            const importIt = t('Import project');
            const choice = await vscode.window.showErrorMessage(
                t('This project is not set up yet. Import it once with the Raspberry Pi Pico extension.'), importIt);
            if (choice === importIt) importProject(folder.uri);
            return null;
        }
        if (!await runTask(t('Build'), onPath('cmake') || 'cmake', ['--build', 'build'], root)) {
            failed();
            return null;
        }
        elf = path.join(root, 'build', name + '.elf');
    }
    if (!elf || !fs.existsSync(elf)) {
        vscode.window.showErrorMessage(t('After building, the file {0} is missing.', elf || '.elf'));
        return null;
    }
    const uf2 = elf.replace(/\.elf$/i, '.uf2');
    if (!fs.existsSync(uf2)) {
        vscode.window.showErrorMessage(t('After building, the file {0} is missing. Is pico_add_extra_outputs in CMakeLists.txt?', uf2));
        return null;
    }
    return { elf, uf2, root };
}

function isDebugBuild(root) {
    try {
        return /^\s*set\s*\(\s*CMAKE_BUILD_TYPE\s+Debug\s*\)/m.test(fs.readFileSync(path.join(root, 'CMakeLists.txt'), 'utf8'));
    } catch {
        return false;
    }
}

function addDebugBuild(root) {
    const file = path.join(root, 'CMakeLists.txt');
    const text = fs.readFileSync(file, 'utf8');
    const changed = text.replace(/^(\s*include\s*\(\s*pico_sdk_import\.cmake\s*\))/m, 'set(CMAKE_BUILD_TYPE Debug)\n$1');
    if (changed === text) return false;
    fs.writeFileSync(file, changed);
    return true;
}

// ---------------------------------------------------------------- running the emulator

function stopEmulator() {
    if (emulator) {
        try { emulator.kill(); } catch { /* already gone */ }
        emulator = null;
    }
}

function startEmulator(program, args, cwd, onExit) {
    stopEmulator();
    log(`> ${program} ${args.join(' ')}`);
    const p = cp.spawn(program, args, { cwd, windowsHide: false });
    emulator = p;
    p.stdout.on('data', d => output.append(d.toString()));
    p.stderr.on('data', d => output.append(d.toString()));
    p.on('error', e => {
        log(`PBConPC: ${e.message}`);
        vscode.window.showErrorMessage(t('PBConPC could not be started: {0}', e.message));
    });
    p.on('exit', code => {
        log(`PBConPC exited (${code})`);
        if (emulator === p) emulator = null;
        if (onExit) onExit(code);
    });
    return p;
}

function baseArgs() {
    const args = ['--flash', 'none'];
    if (setting('usbTerminal')) args.push('--usb-terminal');
    return args;
}

async function run() {
    const program = await pbconpcPath();
    if (!program) return;
    const b = await build();
    if (!b) return;
    const args = baseArgs();
    if (setting('exactTiming')) args.push('--exact-bus');
    args.push(b.uf2);
    startEmulator(program, args, b.root);
}

// ---------------------------------------------------------------- debugging

async function gdbPath() {
    const configured = setting('gdbPath');
    if (configured) return configured;
    if (process.platform !== 'win32') {
        const multi = onPath('gdb-multiarch');
        if (multi) return multi;
    }
    const pico = await picoCommand('getGDBPath');
    if (pico && fs.existsSync(pico)) return pico;
    return onPath('arm-none-eabi-gdb');
}

async function toolchainDir() {
    const gcc = await picoCommand('getCompilerPath');
    if (gcc && fs.existsSync(gcc)) return path.dirname(gcc);
    const found = onPath('arm-none-eabi-gcc');
    return found ? path.dirname(found) : undefined;
}

async function debug() {
    if (!hasExtension(CORTEX)) {
        const install = t('Install Cortex-Debug');
        const choice = await vscode.window.showErrorMessage(
            t('Debugging needs the Cortex-Debug extension. It usually comes with the Raspberry Pi Pico extension.'), install);
        if (choice === install) vscode.commands.executeCommand('workbench.extensions.installExtension', CORTEX);
        return;
    }
    const program = await pbconpcPath();
    if (!program) return;
    const gdb = await gdbPath();
    if (!gdb) {
        vscode.window.showErrorMessage(process.platform === 'linux'
            ? t('The debugger GDB is missing. Install it in a terminal with: sudo apt install gdb-multiarch')
            : t('The debugger GDB is missing. It comes with the Raspberry Pi Pico extension (arm-none-eabi-gdb).'));
        return;
    }
    const folder = rootFolder();
    if (folder && !isDebugBuild(folder.uri.fsPath) && !setting('hideDebugBuildHint')) {
        const add = t('Add it');
        const keep = t('Leave as is');
        const never = t('Don\'t ask again');
        const choice = await vscode.window.showInformationMessage(
            t('The template builds optimised: in the debugger, lines jump around and some variables are missing. For debugging, add "set(CMAKE_BUILD_TYPE Debug)" (appendix F of the C book).'),
            add, keep, never);
        if (choice === undefined) return;
        if (choice === add && !addDebugBuild(folder.uri.fsPath)) {
            vscode.window.showWarningMessage(t('Could not find include(pico_sdk_import.cmake) in CMakeLists.txt. Please add set(CMAKE_BUILD_TYPE Debug) by hand.'));
        }
        if (choice === never) {
            await vscode.workspace.getConfiguration('pbcplus').update('hideDebugBuildHint', true, vscode.ConfigurationTarget.Global);
        }
    }
    const b = await build();
    if (!b) return;

    const port = await freePort();
    const args = baseArgs();
    args.push(`--gdb-wait=127.0.0.1:${port}`, b.uf2);
    let session = null;
    const p = startEmulator(program, args, b.root, () => {
        if (session) vscode.debug.stopDebugging(session);
    });
    try {
        await waitForOutput(p, 'gdb: waiting on port', 15000);
    } catch (e) {
        vscode.window.showErrorMessage(t('PBConPC: {0}. More in the "PBC+" output panel.', e.message));
        output.show(true);
        stopEmulator();
        return;
    }

    const config = {
        name: DEBUG_NAME,
        type: 'cortex-debug',
        request: 'launch',
        servertype: 'external',
        gdbTarget: `127.0.0.1:${port}`,
        executable: b.elf,
        gdbPath: gdb,
        cwd: b.root,
        runToEntryPoint: 'main',
        // PBConPC already has the firmware in flash and holds at the first
        // instruction: no "load" and no "monitor reset halt".
        overrideLaunchCommands: [],
        overrideRestartCommands: ['monitor reset'],
        showDevDebugOutput: 'none',
    };
    const tc = await toolchainDir();
    if (tc) config.armToolchainPath = tc;

    const started = vscode.debug.onDidStartDebugSession(s => {
        if (s.name === DEBUG_NAME) session = s;
    });
    const ended = vscode.debug.onDidTerminateDebugSession(s => {
        if (s === session || (session === null && s.name === DEBUG_NAME)) {
            ended.dispose();
            started.dispose();
            stopEmulator();
        }
    });
    log('Debugger: ' + JSON.stringify(config));
    const ok = await vscode.debug.startDebugging(folder, config);
    log('Debugger started: ' + ok);
    if (!ok) {
        ended.dispose();
        started.dispose();
        stopEmulator();
    }
}

// ---------------------------------------------------------------- profiler

function parseReport(text) {
    const cores = [];
    let core = null;
    for (const line of text.split(/\r?\n/)) {
        let m = line.match(/^core\s+(\d+):\s*busy\s+([\d.]+)\s*%,\s*sleeping[^0-9]*([\d.]+)\s*%,\s*off\s+([\d.]+)\s*%/);
        if (m) {
            core = { nr: +m[1], busy: +m[2], sleeping: +m[3], off: +m[4], rows: [] };
            cores.push(core);
            continue;
        }
        m = line.match(/^\s*([\d.]+)\s+([\d.]+)\s+([0-9a-fA-F]{6,8})\s+(.+?)\s*$/);
        if (m && core) {
            const name = m[4].replace(/\s*\[[^\]]*\]\s*$/, '');
            core.rows.push({ time: +m[1], busy: +m[2], address: m[3], name });
        }
    }
    return cores;
}

function sourceLines(elf, addresses, tc) {
    const a2l = tc ? path.join(tc, 'arm-none-eabi-addr2line' + (process.platform === 'win32' ? '.exe' : '')) : null;
    const program = a2l && fs.existsSync(a2l) ? a2l : onPath('arm-none-eabi-addr2line');
    if (!program || !addresses.length) return {};
    try {
        const r = cp.spawnSync(program, ['-e', elf, ...addresses.map(a => '0x' + a)], { encoding: 'utf8' });
        const lines = (r.stdout || '').split(/\r?\n/);
        const result = {};
        addresses.forEach((a, i) => {
            const m = (lines[i] || '').match(/^(.*):(\d+)/);
            if (m && m[1] !== '??' && +m[2] > 0) result[a] = { file: m[1], line: +m[2] };
        });
        return result;
    } catch {
        return {};
    }
}

function html(text) {
    return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function showReport(cores, sources, raw, root) {
    const panel = vscode.window.createWebviewPanel('pbcplusProfiler', 'PBC+ Profiler', vscode.ViewColumn.Beside,
        { enableScripts: true });
    const sections = cores.map(k => {
        const top = Math.max(0.01, ...k.rows.map(z => z.time));
        const rows = k.rows.slice(0, 40).map(z => {
            const q = sources[z.address];
            const own = q && root && path.resolve(q.file).startsWith(path.resolve(root));
            const name = q
                ? `<a href="#" data-file="${html(q.file)}" data-line="${q.line}">${html(z.name)}</a>`
                : html(z.name);
            return `<tr class="${own ? 'own' : ''}"><td class="num">${z.time.toFixed(1)} %</td>
                <td class="bar"><div style="width:${(100 * z.time / top).toFixed(1)}%"></div></td>
                <td>${name}${q ? `<span class="loc">${html(path.basename(q.file))}:${q.line}</span>` : ''}</td></tr>`;
        }).join('');
        return `<h2>${html(t('Core {0}', k.nr))}</h2>
            <p>${html(t('busy {0} %, sleeping {1} %, off {2} %', k.busy, k.sleeping, k.off))}</p>
            ${k.off >= 99.9 ? '' : `<table>${rows}</table>`}`;
    }).join('');
    panel.webview.html = `<!doctype html><html lang="${german() ? 'de' : 'en'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 1em 2em; }
table { border-collapse: collapse; width: 100%; }
td { padding: 2px 10px 2px 0; vertical-align: middle; }
td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 5em; }
td.bar { width: 160px; min-width: 160px; }
td.bar div { height: 10px; background: var(--vscode-charts-blue, #3794ff); border-radius: 2px; min-width: 1px; }
tr.own td:last-child { font-weight: 600; }
.loc { opacity: .6; margin-left: .6em; font-size: 90%; }
a { color: var(--vscode-textLink-foreground); text-decoration: none; }
a:hover { text-decoration: underline; }
details { margin-top: 2em; } pre { font-size: 90%; }
</style></head><body>
<h1>${html(t('Where does the time go?'))}</h1>
<p>${html(t('Share of time for each function, measured in PBConPC with device-accurate timing. Bold: functions from your project. A click opens the place in the source code.'))}</p>
${sections || `<p>${html(t('The report contains no measurements.'))}</p>`}
<details><summary>${html(t('Report as text'))}</summary><pre>${html(raw)}</pre></details>
<script>
const vscode = acquireVsCodeApi();
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-file]');
  if (!a) return;
  e.preventDefault();
  vscode.postMessage({ file: a.dataset.file, line: +a.dataset.line });
});
</script></body></html>`;
    panel.webview.onDidReceiveMessage(async m => {
        try {
            const doc = await vscode.workspace.openTextDocument(m.file);
            const pos = new vscode.Position(Math.max(0, m.line - 1), 0);
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(pos, pos) });
        } catch {
            vscode.window.showWarningMessage(t('File not found: {0}', m.file));
        }
    });
}

async function profile() {
    const program = await pbconpcPath();
    if (!program) return;
    const folder = rootFolder();
    if (folder && isDebugBuild(folder.uri.fsPath)) {
        const anyway = t('Measure anyway');
        const choice = await vscode.window.showWarningMessage(
            t('CMakeLists.txt contains "set(CMAKE_BUILD_TYPE Debug)". For the profiler, better build without this line, the way the program runs on the PBC+.'),
            anyway);
        if (choice !== anyway) return;
    }
    const b = await build();
    if (!b) return;
    const report = path.join(os.tmpdir(), `pbcplus-profile-${process.pid}-${Date.now()}.txt`);
    const args = baseArgs();
    args.push('--exact-bus', `--profile=${report}`, `--profile-elf=${b.elf}`, b.uf2);
    vscode.window.showInformationMessage(
        t('The profiler measures while the program runs. Let it run for a few seconds, then close the PBConPC window.'));
    startEmulator(program, args, b.root, async () => {
        let raw;
        try {
            raw = fs.readFileSync(report, 'utf8');
            fs.unlinkSync(report);
        } catch {
            vscode.window.showErrorMessage(t('PBConPC did not write a report. More in the "PBC+" output panel.'));
            return;
        }
        const cores = parseReport(raw);
        const addresses = [...new Set(cores.flatMap(k => k.rows.slice(0, 40).map(z => z.address)))];
        const sources = sourceLines(b.elf, addresses, await toolchainDir());
        showReport(cores, sources, raw, b.root);
    });
}

// ---------------------------------------------------------------- new project

function downloadTemplate(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { timeout: 8000, headers: { 'User-Agent': 'pbcplus-vscode' } }, response => {
            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error('HTTP ' + response.statusCode));
            }
            const parts = [];
            response.on('data', d => parts.push(d));
            response.on('end', () => resolve(Buffer.concat(parts)));
        });
        request.on('timeout', () => request.destroy(new Error('timeout')));
        request.on('error', reject);
    });
}

function unpackTemplate(buffer, target) {
    const list = zip.entries(buffer);
    // The template sits in one folder (pbc-projekt/); that level is dropped.
    const firsts = list.map(e => e.name.split('/')[0]);
    const common = firsts.every(n => n === firsts[0]) && list.some(e => e.name.includes('/')) ? firsts[0] + '/' : '';
    if (!list.some(e => e.name === common + 'CMakeLists.txt')) throw new Error('template without CMakeLists.txt');
    for (const e of list) {
        const rel = e.name.slice(common.length);
        if (!rel) continue;
        if (rel.split('/').includes('..') || path.isAbsolute(rel)) throw new Error('invalid path in template: ' + e.name);
        const p = path.join(target, ...rel.split('/').filter(Boolean));
        if (e.directory) fs.mkdirSync(p, { recursive: true });
        else {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, e.data);
        }
    }
}

async function newProject(context) {
    const place = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
        openLabel: t('Create here'), title: t('In which folder should the project be created?'),
    });
    if (!place) return;
    const parent = place[0].fsPath;
    const name = await vscode.window.showInputBox({
        title: t('Name of the project folder'), value: t('pbc-project'),
        prompt: t('Letters without accents, digits, - and _ only'),
        validateInput: v => {
            if (!/^[A-Za-z0-9_-]+$/.test(v)) return t('Please use only A–Z, a–z, 0–9, - and _, without spaces or accented letters.');
            if (fs.existsSync(path.join(parent, v))) return t('This folder already exists there.');
            return null;
        },
    });
    if (!name) return;
    const target = path.join(parent, name);
    if (/[^\x21-\x7e\\/:]/.test(parent)) {
        const anyway = t('Create here anyway');
        const choice = await vscode.window.showWarningMessage(
            t('The path "{0}" contains spaces or accented letters. This often causes build errors. A folder like C:\\PicoBoy is better.', parent),
            { modal: true }, anyway);
        if (choice !== anyway) return;
    }

    let buffer = null;
    let source = 'pbcplus.de';
    try {
        buffer = await downloadTemplate(setting('templateUrl'));
        zip.entries(buffer);
    } catch (e) {
        log(`Template not loaded from ${setting('templateUrl')} (${e.message}), using the bundled one.`);
        buffer = fs.readFileSync(path.join(context.extensionPath, 'template', 'pbc-vorlage.zip'));
        source = 'bundled';
    }
    try {
        fs.mkdirSync(target);
        unpackTemplate(buffer, target);
    } catch (e) {
        vscode.window.showErrorMessage(t('Could not create the project: {0}', e.message));
        return;
    }
    log(`New project ${target}, template: ${source}`);
    const uri = vscode.Uri.file(target);
    if (hasExtension(PICO)) {
        vscode.window.showInformationMessage(
            t('Project "{0}" created. Now import it once: choose SDK version 2.2.0 and click "Import".', name));
        importProject(uri);
    } else {
        const install = t('Install extension');
        const open = t('Open folder');
        const choice = await vscode.window.showWarningMessage(
            t('Project "{0}" created. Building still needs the "Raspberry Pi Pico" extension.', name), install, open);
        if (choice === install) vscode.commands.executeCommand('workbench.extensions.installExtension', PICO);
        if (choice === open) vscode.commands.executeCommand('vscode.openFolder', uri);
    }
}

function importProject(uri) {
    vscode.commands.executeCommand('raspberry-pi-pico.importProject', uri);
}

// ---------------------------------------------------------------- editor help

const PIN_CONTEXT = /gpio|pwm|adc|pin|spi|i2c|uart|pio/i;

function pinHover(doc, pos) {
    const range = doc.getWordRangeAtPosition(pos, /\b(?:GP)?\d{1,2}\b/);
    if (!range) return null;
    const word = doc.getText(range);
    const n = parseInt(word.replace(/^GP/, ''), 10);
    const p = pin(n, vscode.env.language);
    if (!p) return null;
    const line = doc.lineAt(pos.line).text;
    if (!word.startsWith('GP') && !PIN_CONTEXT.test(line)) return null;
    return new vscode.Hover(new vscode.MarkdownString(`**GP${n} – ${p[0]}** (PicoBoy Color Plus)\n\n${p[1]}`), range);
}

function check(doc) {
    if (!diagnostics) return;
    const name = path.basename(doc.fileName);
    const found = [];
    const text = doc.getText();
    const report = (re, message) => {
        for (const m of text.matchAll(re)) {
            const start = doc.positionAt(m.index);
            const end = doc.positionAt(m.index + m[0].length);
            const d = new vscode.Diagnostic(new vscode.Range(start, end), message, vscode.DiagnosticSeverity.Warning);
            d.source = 'PBC+';
            found.push(d);
        }
    };
    if (name === 'CMakeLists.txt') {
        report(/pico_enable_stdio_uart\s*\(\s*[^\s)]+\s+1\s*\)/g,
            t('The serial port (UART) is on GP0/GP1, where the joystick centre and right are connected. For printf, use pico_enable_stdio_usb instead.'));
    } else if (doc.languageId === 'c' || doc.languageId === 'cpp') {
        report(/\b(?:stdio_uart_init|uart_init\s*\(\s*uart0)\b[^;]*/g,
            t('UART0 is on GP0/GP1, where the joystick centre and right are connected. The joystick will then not work properly.'));
        report(/gpio_set_function\s*\(\s*[01]\s*,\s*GPIO_FUNC_UART\s*\)/g,
            t('On the PBC+, GP0/GP1 are the joystick (centre and right), not a serial port.'));
    }
    diagnostics.set(doc.uri, found);
}

// ---------------------------------------------------------------- start-up

function updateStatusBar() {
    const show = isPbcProject(rootFolder());
    for (const s of statusItems) show ? s.show() : s.hide();
    vscode.commands.executeCommand('setContext', 'pbcplus.project', show);
}

function importHint() {
    const folder = rootFolder();
    if (!folder || !isPbcProject(folder) || !hasExtension(PICO)) return;
    if (fs.existsSync(path.join(folder.uri.fsPath, '.vscode', 'tasks.json'))) return;
    const now = t('Import now');
    vscode.window.showInformationMessage(t('This PBC+ project is not set up for the Raspberry Pi Pico extension yet.'), now)
        .then(choice => { if (choice === now) importProject(folder.uri); });
}

function activate(context) {
    output = vscode.window.createOutputChannel('PBC+');
    diagnostics = vscode.languages.createDiagnosticCollection('pbcplus');
    const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
    reg('pbcplus.newProject', () => newProject(context));
    reg('pbcplus.run', run);
    reg('pbcplus.debug', debug);
    reg('pbcplus.profile', profile);
    reg('pbcplus.choosePbconpc', choosePbconpc);
    reg('pbcplus.stop', stopEmulator);

    const button = (text, command, tooltip, priority) => {
        const s = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
        s.text = text; s.command = command; s.tooltip = tooltip;
        statusItems.push(s);
        context.subscriptions.push(s);
    };
    button('$(play) PBConPC', 'pbcplus.run', t('Build and run in PBConPC'), 9);
    button('$(debug-alt) ' + t('Debug'), 'pbcplus.debug', t('Build and debug in PBConPC'), 8);
    updateStatusBar();
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(updateStatusBar));

    context.subscriptions.push(vscode.languages.registerHoverProvider(
        [{ language: 'c' }, { language: 'cpp' }], { provideHover: pinHover }));
    context.subscriptions.push(diagnostics);
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(check));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => check(e.document)));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(d => diagnostics.delete(d.uri)));
    vscode.workspace.textDocuments.forEach(check);
    importHint();
}

function deactivate() {
    stopEmulator();
}

module.exports = { activate, deactivate, parseReport, unpackTemplate };
