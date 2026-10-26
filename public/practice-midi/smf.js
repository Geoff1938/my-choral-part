/**
 * Standard MIDI File reader and writer
 * Works at the level of raw events so that nothing in a source file (lyrics,
 * text, event order, tempo map) is lost on the way through. Pure JavaScript
 * with no DOM or Node dependencies: runs in the browser, in Jest and on the
 * server.
 */

export class MidiParseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MidiParseError';
    }
}

// Meta event types
export const META = {
    TEXT: 0x01,
    COPYRIGHT: 0x02,
    TRACK_NAME: 0x03,
    INSTRUMENT_NAME: 0x04,
    LYRIC: 0x05,
    MARKER: 0x06,
    CUE: 0x07,
    CHANNEL_PREFIX: 0x20,
    PORT: 0x21,
    END_OF_TRACK: 0x2f,
    TEMPO: 0x51,
    SMPTE_OFFSET: 0x54,
    TIME_SIGNATURE: 0x58,
    KEY_SIGNATURE: 0x59,
    SEQUENCER_SPECIFIC: 0x7f
};

// Data bytes that follow each channel message status (high nibble)
const CHANNEL_DATA_LENGTH = {
    0x8: 2, 0x9: 2, 0xa: 2, 0xb: 2, 0xc: 1, 0xd: 1, 0xe: 2
};

const CHANNEL_TYPE = {
    0x8: 'noteOff',
    0x9: 'noteOn',
    0xa: 'polyAftertouch',
    0xb: 'controller',
    0xc: 'program',
    0xd: 'channelAftertouch',
    0xe: 'pitchBend'
};

const STATUS_FOR_TYPE = Object.fromEntries(
    Object.entries(CHANNEL_TYPE).map(([nibble, type]) => [type, Number(nibble)])
);

/**
 * Decode text from a meta event. MIDI does not specify an encoding: try
 * UTF-8 and fall back to Latin-1 (what most notation programs write).
 * @param {Uint8Array} bytes - Meta event data
 * @returns {string} Decoded text
 */
export function decodeText(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
        return String.fromCharCode(...bytes);
    }
}

/**
 * Encode text for a meta event as UTF-8
 * @param {string} text - Text to encode
 * @returns {Uint8Array} Encoded bytes
 */
export function encodeText(text) {
    return new TextEncoder().encode(text);
}

/**
 * Read a Standard MIDI File
 * Each track is a list of events with an absolute `tick`. Channel events carry
 * `type`, `channel` and their data; a note-on with velocity 0 is read as a
 * note-off. Meta events are `{ type: 'meta', metaType, data }` and system
 * exclusive events `{ type: 'sysex', status, data }`, with data as raw bytes.
 * @param {ArrayBuffer|Uint8Array} input - File contents
 * @returns {{format: number, ticksPerQuarter: number, tracks: Array<{events: Array<Object>}>}} Parsed file
 * @throws {MidiParseError} If the file is not a readable MIDI file
 */
export function readMidi(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let pos = 0;

    function need(count) {
        if (pos + count > bytes.length) {
            throw new MidiParseError('The MIDI file ends unexpectedly');
        }
    }

    function readUint32() {
        need(4);
        const value = ((bytes[pos] << 24) >>> 0) + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3];
        pos += 4;
        return value;
    }

    function readUint16() {
        need(2);
        const value = (bytes[pos] << 8) + bytes[pos + 1];
        pos += 2;
        return value;
    }

    function readChunkId() {
        need(4);
        const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
        pos += 4;
        return id;
    }

    function readVarLen(end) {
        let value = 0;
        for (let i = 0; i < 4; i++) {
            if (pos >= end) {
                throw new MidiParseError('A MIDI track ends unexpectedly');
            }
            const b = bytes[pos++];
            value = (value << 7) | (b & 0x7f);
            if (!(b & 0x80)) {
                return value;
            }
        }
        throw new MidiParseError('The MIDI file contains an invalid length');
    }

    if (readChunkId() !== 'MThd') {
        throw new MidiParseError('This is not a MIDI file');
    }
    const headerLength = readUint32();
    if (headerLength < 6) {
        throw new MidiParseError('The MIDI file header is invalid');
    }
    const format = readUint16();
    const trackCount = readUint16();
    const division = readUint16();
    pos += headerLength - 6;
    if (format > 2) {
        throw new MidiParseError('Unsupported MIDI file format');
    }
    if (division & 0x8000) {
        throw new MidiParseError('MIDI files timed in SMPTE frames are not supported');
    }
    if (division === 0) {
        throw new MidiParseError('The MIDI file header is invalid');
    }

    const tracks = [];
    while (tracks.length < trackCount && pos + 8 <= bytes.length) {
        const id = readChunkId();
        const length = readUint32();
        // A truncated last track is read as far as it goes
        const end = Math.min(pos + length, bytes.length);
        if (id !== 'MTrk') {
            // Unknown chunks are skipped, as the specification requires
            pos = end;
            continue;
        }

        const events = [];
        let tick = 0;
        let runningStatus = null;
        while (pos < end) {
            tick += readVarLen(end);
            if (pos >= end) {
                throw new MidiParseError('A MIDI track ends unexpectedly');
            }
            let status = bytes[pos];

            if (status === 0xff) {
                pos++;
                need(1);
                const metaType = bytes[pos++];
                const length = readVarLen(end);
                if (pos + length > end) {
                    throw new MidiParseError('A MIDI track ends unexpectedly');
                }
                const data = bytes.slice(pos, pos + length);
                pos += length;
                if (metaType === META.END_OF_TRACK) {
                    events.push({ tick, type: 'meta', metaType, data });
                    break;
                }
                events.push({ tick, type: 'meta', metaType, data });
                continue;
            }

            if (status === 0xf0 || status === 0xf7) {
                pos++;
                const length = readVarLen(end);
                if (pos + length > end) {
                    throw new MidiParseError('A MIDI track ends unexpectedly');
                }
                events.push({ tick, type: 'sysex', status, data: bytes.slice(pos, pos + length) });
                pos += length;
                runningStatus = null;
                continue;
            }

            if (status & 0x80) {
                pos++;
                runningStatus = status;
            } else if (runningStatus === null) {
                throw new MidiParseError('The MIDI file contains invalid data');
            } else {
                status = runningStatus;
            }

            const nibble = status >> 4;
            const dataLength = CHANNEL_DATA_LENGTH[nibble];
            if (dataLength === undefined) {
                // System common and real-time messages have no place in a file
                throw new MidiParseError('The MIDI file contains invalid data');
            }
            if (pos + dataLength > end) {
                throw new MidiParseError('A MIDI track ends unexpectedly');
            }
            const d1 = bytes[pos] & 0x7f;
            const d2 = dataLength === 2 ? bytes[pos + 1] & 0x7f : 0;
            pos += dataLength;

            const channel = status & 0x0f;
            const type = CHANNEL_TYPE[nibble];
            if (type === 'noteOn' || type === 'noteOff') {
                const isOff = type === 'noteOff' || d2 === 0;
                events.push({ tick, type: isOff ? 'noteOff' : 'noteOn', channel, note: d1, velocity: d2 });
            } else if (type === 'polyAftertouch') {
                events.push({ tick, type, channel, note: d1, pressure: d2 });
            } else if (type === 'controller') {
                events.push({ tick, type, channel, controller: d1, value: d2 });
            } else if (type === 'program') {
                events.push({ tick, type, channel, program: d1 });
            } else if (type === 'channelAftertouch') {
                events.push({ tick, type, channel, pressure: d1 });
            } else {
                events.push({ tick, type, channel, value: (d2 << 7) | d1 });
            }
        }
        pos = end;
        tracks.push({ events });
    }

    if (tracks.length === 0) {
        throw new MidiParseError('The MIDI file contains no tracks');
    }
    return { format, ticksPerQuarter: division, tracks };
}

/**
 * Sort order for events at the same tick: note-offs first (so a repeated note
 * is released before it sounds again), then everything else in its original
 * order, then note-ons.
 */
function eventRank(event) {
    if (event.type === 'noteOff') return 0;
    if (event.type === 'noteOn') return 2;
    return 1;
}

function pushVarLen(out, value) {
    const groups = [value & 0x7f];
    value >>>= 7;
    while (value > 0) {
        groups.unshift((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    out.push(...groups);
}

function pushBytes(out, data) {
    for (let i = 0; i < data.length; i++) {
        out.push(data[i]);
    }
}

/**
 * Encode one track's events (absolute ticks) as an MTrk chunk body.
 * Events are stably sorted by tick and rank; any end-of-track events are
 * dropped and a single one written at the end.
 * @param {Array<Object>} events - Track events
 * @returns {number[]} Encoded bytes
 */
function encodeTrack(events) {
    const sorted = events
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => !(event.type === 'meta' && event.metaType === META.END_OF_TRACK))
        .sort((a, b) => (a.event.tick - b.event.tick)
            || (eventRank(a.event) - eventRank(b.event))
            || (a.index - b.index))
        .map(({ event }) => event);

    const endTick = events.reduce((max, e) => Math.max(max, e.tick), 0);
    const out = [];
    let lastTick = 0;
    for (const event of sorted) {
        pushVarLen(out, event.tick - lastTick);
        lastTick = event.tick;
        if (event.type === 'meta') {
            out.push(0xff, event.metaType);
            pushVarLen(out, event.data.length);
            pushBytes(out, event.data);
        } else if (event.type === 'sysex') {
            out.push(event.status);
            pushVarLen(out, event.data.length);
            pushBytes(out, event.data);
        } else {
            const status = (STATUS_FOR_TYPE[event.type] << 4) | event.channel;
            switch (event.type) {
                case 'noteOn':
                case 'noteOff':
                    out.push(status, event.note, event.velocity);
                    break;
                case 'polyAftertouch':
                    out.push(status, event.note, event.pressure);
                    break;
                case 'controller':
                    out.push(status, event.controller, event.value);
                    break;
                case 'program':
                    out.push(status, event.program);
                    break;
                case 'channelAftertouch':
                    out.push(status, event.pressure);
                    break;
                case 'pitchBend':
                    out.push(status, event.value & 0x7f, (event.value >> 7) & 0x7f);
                    break;
                default:
                    throw new Error(`Unknown MIDI event type: ${event.type}`);
            }
        }
    }
    pushVarLen(out, endTick - lastTick);
    out.push(0xff, META.END_OF_TRACK, 0);
    return out;
}

/**
 * Write a Standard MIDI File
 * Note-offs are written as real note-off messages (no running status).
 * @param {{format: number, ticksPerQuarter: number, tracks: Array<{events: Array<Object>}>}} song - File to write
 * @returns {Uint8Array} File contents
 */
export function writeMidi(song) {
    const out = [];
    pushBytes(out, encodeText('MThd'));
    out.push(0, 0, 0, 6);
    out.push(0, song.format, (song.tracks.length >> 8) & 0xff, song.tracks.length & 0xff);
    out.push((song.ticksPerQuarter >> 8) & 0x7f, song.ticksPerQuarter & 0xff);
    for (const track of song.tracks) {
        const body = encodeTrack(track.events);
        pushBytes(out, encodeText('MTrk'));
        const n = body.length;
        out.push((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
        pushBytes(out, body);
    }
    return Uint8Array.from(out);
}

/**
 * Pair note-on and note-off events into notes
 * A note-off ends the earliest sounding note of the same channel and pitch.
 * Notes still sounding at the end of the track end at the track's last tick.
 * @param {Array<Object>} events - One track's events
 * @returns {Array<{tick: number, duration: number, channel: number, note: number, velocity: number, offVelocity: number}>} Notes in onset order
 */
export function extractNotes(events) {
    const sounding = new Map();
    const notes = [];
    let lastTick = 0;
    for (const event of events) {
        lastTick = Math.max(lastTick, event.tick);
        if (event.type === 'noteOn') {
            const key = event.channel * 128 + event.note;
            const note = { tick: event.tick, duration: 0, channel: event.channel, note: event.note, velocity: event.velocity, offVelocity: 0 };
            if (!sounding.has(key)) sounding.set(key, []);
            sounding.get(key).push(note);
            notes.push(note);
        } else if (event.type === 'noteOff') {
            const queue = sounding.get(event.channel * 128 + event.note);
            if (queue && queue.length > 0) {
                const note = queue.shift();
                note.duration = event.tick - note.tick;
                note.offVelocity = event.velocity;
            }
        }
    }
    for (const queue of sounding.values()) {
        for (const note of queue) {
            note.duration = lastTick - note.tick;
        }
    }
    return notes;
}

/**
 * Get the text of the first meta event of a type in a track
 * @param {{events: Array<Object>}} track - Track
 * @param {number} metaType - Meta type (e.g. META.TRACK_NAME)
 * @returns {string|null} Text, or null if there is none
 */
export function metaText(track, metaType) {
    const event = track.events.find(e => e.type === 'meta' && e.metaType === metaType);
    return event ? decodeText(event.data) : null;
}
