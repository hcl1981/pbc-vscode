'use strict';
// Kleiner ZIP-Leser für die Projektvorlage: nur „gespeichert“ und „deflate“,
// ohne fremde Pakete.
const zlib = require('zlib');

function eintraege(puffer) {
    let ende = -1;
    for (let i = puffer.length - 22; i >= Math.max(0, puffer.length - 22 - 0xffff); i--) {
        if (puffer.readUInt32LE(i) === 0x06054b50) { ende = i; break; }
    }
    if (ende < 0) throw new Error('keine ZIP-Datei');
    const anzahl = puffer.readUInt16LE(ende + 10);
    let pos = puffer.readUInt32LE(ende + 16);
    const liste = [];
    for (let n = 0; n < anzahl; n++) {
        if (puffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt');
        const methode = puffer.readUInt16LE(pos + 10);
        const gepackt = puffer.readUInt32LE(pos + 20);
        const namenLaenge = puffer.readUInt16LE(pos + 28);
        const extraLaenge = puffer.readUInt16LE(pos + 30);
        const kommentarLaenge = puffer.readUInt16LE(pos + 32);
        const kopf = puffer.readUInt32LE(pos + 42);
        const name = puffer.toString('utf8', pos + 46, pos + 46 + namenLaenge);
        pos += 46 + namenLaenge + extraLaenge + kommentarLaenge;

        if (puffer.readUInt32LE(kopf) !== 0x04034b50) throw new Error('ZIP-Eintrag beschädigt: ' + name);
        const start = kopf + 30 + puffer.readUInt16LE(kopf + 26) + puffer.readUInt16LE(kopf + 28);
        const roh = puffer.subarray(start, start + gepackt);
        const ordner = name.endsWith('/');
        let daten = null;
        if (!ordner) {
            if (methode === 0) daten = Buffer.from(roh);
            else if (methode === 8) daten = zlib.inflateRawSync(roh);
            else throw new Error(`Packverfahren ${methode} wird nicht unterstützt: ${name}`);
        }
        liste.push({ name, ordner, daten });
    }
    return liste;
}

module.exports = { eintraege };
