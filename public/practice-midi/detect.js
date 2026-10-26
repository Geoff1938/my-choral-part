/**
 * Detect what kind of file a user picked, from its contents rather than its
 * name (phones are unreliable about file types). The name is used only to
 * give a more helpful message for notation program files.
 */

/**
 * List the files in a zip archive from its central directory, without
 * extracting anything (so the uncompressed size can be checked first)
 * @param {Uint8Array} bytes - Zip file contents
 * @returns {Array<{name: string, compressedSize: number, uncompressedSize: number}>|null} Entries, or null if not a readable zip
 */
export function readZipDirectory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // The end of central directory record is in the last 22 + 65535 bytes
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) return null;

    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count; i++) {
        if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) return null;
        const compressedSize = view.getUint32(pos + 20, true);
        const uncompressedSize = view.getUint32(pos + 24, true);
        const nameLength = view.getUint16(pos + 28, true);
        const extraLength = view.getUint16(pos + 30, true);
        const commentLength = view.getUint16(pos + 32, true);
        if (pos + 46 + nameLength > bytes.length) return null;
        const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
        entries.push({ name, compressedSize, uncompressedSize });
        pos += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/**
 * Name of the root element of an XML document, or null if it is not XML
 * @param {Uint8Array} bytes - File contents
 * @returns {string|null} Root element name
 */
export function xmlRootElement(bytes) {
    const head = bytes.subarray(0, 4096);
    let text;
    if (head[0] === 0xff && head[1] === 0xfe) {
        text = new TextDecoder('utf-16le').decode(head);
    } else if (head[0] === 0xfe && head[1] === 0xff) {
        text = new TextDecoder('utf-16be').decode(head);
    } else {
        text = new TextDecoder('utf-8').decode(head);
    }
    text = text.replace(/^﻿/, '')
        .replace(/<\?[\s\S]*?\?>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '')
        .trimStart();
    const match = text.match(/^<([A-Za-z_][\w.-]*)/);
    return match ? match[1] : null;
}

function startsWith(bytes, ascii) {
    for (let i = 0; i < ascii.length; i++) {
        if (bytes[i] !== ascii.charCodeAt(i)) return false;
    }
    return true;
}

/**
 * Detect a file's format
 * @param {Uint8Array} bytes - File contents
 * @param {string} [filename] - Original file name, for better messages
 * @returns {{format: string, zipEntries?: Array<Object>}} format is 'midi',
 *     'musicxml', 'mxl', or for unsupported files 'pdf', 'musescore',
 *     'notation' (Finale, Sibelius, Encore and the like) or 'unknown'
 */
export function detectFormat(bytes, filename = '') {
    if (startsWith(bytes, 'MThd')) {
        return { format: 'midi' };
    }
    if (startsWith(bytes, 'RIFF') && startsWith(bytes.subarray(8), 'RMID')) {
        // RIFF-wrapped MIDI: the standard file is inside
        return { format: 'midi' };
    }
    if (startsWith(bytes, '%PDF')) {
        return { format: 'pdf' };
    }
    if (startsWith(bytes, 'PK')) {
        const zipEntries = readZipDirectory(bytes);
        if (zipEntries && zipEntries.some(e => e.name === 'META-INF/container.xml')) {
            return { format: 'mxl', zipEntries };
        }
        if (zipEntries && zipEntries.some(e => /\.mscx$/i.test(e.name))) {
            return { format: 'musescore' };
        }
    }
    const root = xmlRootElement(bytes);
    if (root === 'score-partwise' || root === 'score-timewise') {
        return { format: 'musicxml' };
    }
    if (root === 'museScore') {
        return { format: 'musescore' };
    }
    if (/\.(mscz|mscx)$/i.test(filename)) {
        return { format: 'musescore' };
    }
    if (/\.(mus|musx|sib|enc|nwc|nwctxt|cap|capx|ly|dorico|sdx)$/i.test(filename)) {
        return { format: 'notation' };
    }
    return { format: 'unknown' };
}

/**
 * Extract the standard MIDI data from a RIFF RMID wrapper, or return the bytes unchanged
 * @param {Uint8Array} bytes - File contents
 * @returns {Uint8Array} Standard MIDI file data
 */
export function unwrapRiffMidi(bytes) {
    if (!(startsWith(bytes, 'RIFF') && startsWith(bytes.subarray(8), 'RMID'))) {
        return bytes;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 12;
    while (pos + 8 <= bytes.length) {
        const size = view.getUint32(pos + 4, true);
        if (startsWith(bytes.subarray(pos), 'data')) {
            return bytes.subarray(pos + 8, pos + 8 + size);
        }
        pos += 8 + size + (size & 1);
    }
    return bytes;
}
