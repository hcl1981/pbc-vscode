'use strict';
// Small ZIP reader for the project template: "stored" and "deflate" only,
// no third-party packages.
const zlib = require('zlib');

function entries(buffer) {
    let end = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('not a ZIP file');
    const count = buffer.readUInt16LE(end + 10);
    let pos = buffer.readUInt32LE(end + 16);
    const list = [];
    for (let n = 0; n < count; n++) {
        if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('ZIP directory damaged');
        const method = buffer.readUInt16LE(pos + 10);
        const packed = buffer.readUInt32LE(pos + 20);
        const nameLength = buffer.readUInt16LE(pos + 28);
        const extraLength = buffer.readUInt16LE(pos + 30);
        const commentLength = buffer.readUInt16LE(pos + 32);
        const header = buffer.readUInt32LE(pos + 42);
        const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLength);
        pos += 46 + nameLength + extraLength + commentLength;

        if (buffer.readUInt32LE(header) !== 0x04034b50) throw new Error('ZIP entry damaged: ' + name);
        const start = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28);
        const raw = buffer.subarray(start, start + packed);
        const directory = name.endsWith('/');
        let data = null;
        if (!directory) {
            if (method === 0) data = Buffer.from(raw);
            else if (method === 8) data = zlib.inflateRawSync(raw);
            else throw new Error(`unsupported compression method ${method}: ${name}`);
        }
        list.push({ name, directory, data });
    }
    return list;
}

module.exports = { entries };
