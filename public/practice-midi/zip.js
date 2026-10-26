/**
 * Just enough zip support to open compressed MusicXML (.mxl): list the
 * archive's directory and extract one entry, inflating with the platform's
 * DecompressionStream (browsers and Node 18+) rather than a library.
 */

export class ZipError extends Error {
    constructor(message, code = 'zip-broken') {
        super(message);
        this.name = 'ZipError';
        this.code = code;
    }
}

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * List the files in a zip archive from its central directory, without
 * extracting anything (so the uncompressed size can be checked first)
 * @param {Uint8Array} bytes - Zip file contents
 * @returns {Array<{name: string, method: number, compressedSize: number, uncompressedSize: number, localHeaderOffset: number}>|null}
 *     Entries, or null if not a readable zip
 */
export function readZipDirectory(bytes) {
    if (bytes.length < 22) return null;
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
        const nameLength = view.getUint16(pos + 28, true);
        const extraLength = view.getUint16(pos + 30, true);
        const commentLength = view.getUint16(pos + 32, true);
        if (pos + 46 + nameLength > bytes.length) return null;
        entries.push({
            name: new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength)),
            method: view.getUint16(pos + 10, true),
            compressedSize: view.getUint32(pos + 20, true),
            uncompressedSize: view.getUint32(pos + 24, true),
            localHeaderOffset: view.getUint32(pos + 42, true)
        });
        pos += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/**
 * Inflate raw deflate data, stopping if the output passes a size limit
 * (the sizes in a zip directory can lie)
 */
async function inflateRaw(data, maxBytes) {
    if (typeof DecompressionStream === 'undefined') {
        throw new ZipError('Decompression is not available', 'no-decompression');
    }
    let stream;
    try {
        stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    } catch (error) {
        throw new ZipError('Decompression is not available', 'no-decompression');
    }
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > maxBytes) {
                await reader.cancel();
                throw new ZipError('The archive is too large when uncompressed', 'zip-too-large');
            }
            chunks.push(value);
        }
    } catch (error) {
        if (error instanceof ZipError) throw error;
        throw new ZipError('The archive is damaged');
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const chunk of chunks) {
        out.set(chunk, pos);
        pos += chunk.length;
    }
    return out;
}

/**
 * Extract one entry from a zip archive
 * @param {Uint8Array} bytes - Zip file contents
 * @param {Object} entry - Entry from readZipDirectory
 * @param {number} maxBytes - Largest uncompressed size accepted
 * @returns {Promise<Uint8Array>} Uncompressed contents
 * @throws {ZipError} If the entry is damaged, too large or uses an unsupported method
 */
export async function extractZipEntry(bytes, entry, maxBytes) {
    if (entry.uncompressedSize > maxBytes) {
        throw new ZipError('The archive is too large when uncompressed', 'zip-too-large');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pos = entry.localHeaderOffset;
    if (pos + 30 > bytes.length || view.getUint32(pos, true) !== 0x04034b50) {
        throw new ZipError('The archive is damaged');
    }
    const start = pos + 30 + view.getUint16(pos + 26, true) + view.getUint16(pos + 28, true);
    const end = start + entry.compressedSize;
    if (end > bytes.length) {
        throw new ZipError('The archive is damaged');
    }
    const data = bytes.subarray(start, end);
    if (entry.method === METHOD_STORED) {
        return data;
    }
    if (entry.method === METHOD_DEFLATE) {
        return inflateRaw(data, maxBytes);
    }
    throw new ZipError('The archive uses an unsupported compression method');
}
