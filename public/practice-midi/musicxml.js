/**
 * Read a MusicXML score into the same neutral form as a parsed MIDI file
 * (format 1: a conductor track, then one track per line), so it goes through
 * the same classifier and recipe as MIDI.
 *
 * Choices:
 * - Repeats are not expanded: the score plays straight through as written.
 * - Pitches are taken as written in <pitch>. A <transpose> octave shift is
 *   applied only when the clef does not declare the same shift, because
 *   Sibelius writes both for tenor parts while the notes are already at
 *   sounding pitch.
 * - A voice part whose stave holds two voices is split into two lines; where
 *   only one voice sings in a measure, both lines get its notes (unison).
 * - Cue and grace notes are not played.
 */

import { META, encodeText } from './smf.js';
import { parseXml, child, children, textOf, XmlParseError } from './xml.js';
import { extractZipEntry, ZipError } from './zip.js';
import { parseName, isChoirName } from './classify.js';
import { DEFAULT_VELOCITY } from './recipe.js';

export class MusicXmlError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'MusicXmlError';
        this.code = code;
    }
}

// Largest uncompressed size accepted for a .mxl score
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

// Written dynamics as velocities: mp, mf, f and ff are the reference file's levels
export const DYNAMIC_VELOCITY = {
    pppp: 16, ppp: 24, pp: 36, p: 48, mp: 60, mf: 75, f: 92, ff: 108, fff: 118, ffff: 127,
    fp: 48, sfp: 48, pf: 92, sf: 92, sfz: 92, fz: 92, rf: 92, rfz: 92, sffz: 108, sfpp: 36
};

// A second voice on a vocal stave is a separate part when it has at least
// this share of the stave's notes; otherwise it is divisi in the main line
const SPLIT_SHARE = 0.15;

// Most lines one part is split into (closed score SATB on two staves)
const MAX_LINES_PER_PART = 4;

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Program (0-based) for accompaniment parts that don't name one
const PROGRAM_BY_WORD = [
    [/organ|orgel|orgue|pedal|manual/i, 19],
    [/harpsichord|cembalo|clavecin|continuo/i, 6],
    [/violin|violino/i, 40],
    [/viola/i, 41],
    [/cello|violoncello/i, 42],
    [/contrabass|double ?bass|violone/i, 43],
    [/strings?/i, 48],
    [/flute|flauto/i, 73],
    [/oboe/i, 68],
    [/bassoon|fagott/i, 70],
    [/trumpet|tromba/i, 56],
    [/horn|corno/i, 60],
    [/timpani/i, 47],
    [/harp/i, 46]
];

const MAX_TICKS_PER_QUARTER = 15360;
const FALLBACK_TICKS_PER_QUARTER = 960;

function gcd(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
}

function number(text, fallback = 0) {
    const value = Number(text);
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Decode XML bytes, honouring a byte order mark or declared encoding
 */
function decodeXml(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    const declared = head.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i);
    try {
        return new TextDecoder(declared ? declared[1] : 'utf-8').decode(bytes);
    } catch (error) {
        return new TextDecoder('utf-8').decode(bytes);
    }
}

/**
 * Get the score document from a .mxl archive
 * @param {Uint8Array} bytes - Archive contents
 * @param {Array<Object>} entries - Its directory (readZipDirectory)
 * @returns {Promise<Uint8Array>} The score's XML
 */
async function scoreFromArchive(bytes, entries) {
    const total = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
    if (total > MAX_UNCOMPRESSED_BYTES) {
        throw new MusicXmlError('The archive is too large when uncompressed', 'mxl-too-large');
    }
    try {
        let path = null;
        const container = entries.find(e => e.name === 'META-INF/container.xml');
        if (container) {
            const root = parseXml(decodeXml(await extractZipEntry(bytes, container, MAX_UNCOMPRESSED_BYTES)));
            const rootfile = children(child(root, 'rootfiles'), 'rootfile')[0];
            path = rootfile ? rootfile.attrs['full-path'] : null;
        }
        const entry = entries.find(e => e.name === path)
            || entries.find(e => !e.name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(e.name));
        if (!entry) {
            throw new MusicXmlError('The archive contains no score', 'mxl-broken');
        }
        return await extractZipEntry(bytes, entry, MAX_UNCOMPRESSED_BYTES);
    } catch (error) {
        if (error instanceof ZipError) {
            throw new MusicXmlError(error.message, error.code === 'zip-too-large' ? 'mxl-too-large' : error.code === 'no-decompression' ? 'no-decompression' : 'mxl-broken');
        }
        if (error instanceof XmlParseError) {
            throw new MusicXmlError(error.message, 'mxl-broken');
        }
        throw error;
    }
}

/**
 * Rearrange a timewise score (measures containing parts) as partwise
 * (parts containing measures)
 */
function partwise(root) {
    if (root.name !== 'score-timewise') return root;
    const parts = new Map();
    for (const measure of children(root, 'measure')) {
        for (const part of children(measure, 'part')) {
            if (!parts.has(part.attrs.id)) {
                parts.set(part.attrs.id, { name: 'part', attrs: { id: part.attrs.id }, children: [] });
            }
            parts.get(part.attrs.id).children.push({ name: 'measure', attrs: measure.attrs, children: part.children });
        }
    }
    const header = root.children.filter(c => typeof c !== 'string' && c.name !== 'measure');
    return { name: 'score-partwise', attrs: root.attrs, children: [...header, ...parts.values()] };
}

function titleCase(text) {
    return text === text.toUpperCase() ? text.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) : text;
}

/**
 * Title, composer and rights from the score header
 */
function scoreMetadata(root) {
    const work = textOf(root, 'work', 'work-title') || '';
    let movement = textOf(root, 'movement-title') || '';
    const identification = child(root, 'identification');
    const creator = children(identification, 'creator').find(c => c.attrs.type === 'composer');
    const composer = creator ? textOf(creator) : '';
    const rights = children(identification, 'rights').map(r => textOf(r)).filter(Boolean);

    // Without a movement title, a centred credit on the first page that is
    // not the work title, composer or copyright is usually the movement
    if (!movement) {
        const credits = children(root, 'credit').flatMap(c => children(c, 'credit-words'))
            .filter(w => w.attrs.justify === 'center')
            .map(w => textOf(w))
            .filter(t => t && t.length > 2 && !/^\d+$/.test(t) && !/©|copyright/i.test(t) && t !== work && t !== composer);
        movement = credits[0] ? titleCase(credits[0]) : '';
    }
    if (movement && /^[\w\s.-]+\.(xml|musicxml|mxl)$/i.test(movement)) {
        movement = '';
    }
    const title = work && movement && work !== movement ? `${work}: ${movement}` : (movement || work);
    return { title, composer, rights };
}

/**
 * Part names, programs and channels from the part list
 */
function partList(root) {
    const parts = new Map();
    for (const scorePart of children(child(root, 'part-list'), 'score-part')) {
        const partName = textOf(scorePart, 'part-name') || '';
        const instrumentName = textOf(scorePart, 'score-instrument', 'instrument-name') || '';
        // Notation programs write placeholders like "MusicXML Part" or "P7" when a part has no name
        const placeholder = !partName || /^(musicxml part|p\d+|part \d+|staff \d*)$/i.test(partName);
        const name = (placeholder || (parseName(partName).kind === 'unknown' && parseName(instrumentName).kind !== 'unknown'))
            && instrumentName ? instrumentName : partName;
        const midiProgram = textOf(scorePart, 'midi-instrument', 'midi-program');
        parts.set(scorePart.attrs.id, {
            name,
            program: midiProgram ? Math.min(127, Math.max(0, number(midiProgram, 1) - 1)) : null
        });
    }
    return parts;
}

/**
 * Walk one part's measures: notes, dynamics, tempo and attributes, with
 * positions as (measure index, offset in quarter notes)
 */
function readPart(part) {
    const notes = [];
    const dynamics = [];
    const tempos = [];
    const timeSignatures = [];
    const keySignatures = [];
    const measureLengths = [];
    const divisionsUsed = new Set();
    // "measure:staff:voice" for every voice with anything (note or rest) written in a measure
    const written = new Set();
    let divisions = 1;
    let transposeSemitones = 0;
    let transposeOctaves = 0;
    const clefOctaves = {};

    children(part, 'measure').forEach((measure, measureIndex) => {
        let pos = 0; // in divisions
        let maxPos = 0;
        let lastStart = 0;
        const at = offsetDivisions => ({ measureIndex, quarters: (pos + offsetDivisions) / divisions });

        for (const element of children(measure)) {
            switch (element.name) {
                case 'attributes': {
                    const div = textOf(element, 'divisions');
                    if (div) {
                        divisions = number(div, 1) || 1;
                        divisionsUsed.add(divisions);
                    }
                    for (const clef of children(element, 'clef')) {
                        clefOctaves[clef.attrs.number || '1'] = number(textOf(clef, 'clef-octave-change'));
                    }
                    const transpose = child(element, 'transpose');
                    if (transpose) {
                        transposeSemitones = number(textOf(transpose, 'chromatic'));
                        transposeOctaves = number(textOf(transpose, 'octave-change'));
                    }
                    const time = child(element, 'time');
                    if (time && textOf(time, 'beats') && textOf(time, 'beat-type')) {
                        const beats = textOf(time, 'beats').split('+').reduce((sum, b) => sum + number(b), 0);
                        timeSignatures.push({ ...at(0), beats, beatType: number(textOf(time, 'beat-type'), 4) });
                    }
                    const key = child(element, 'key');
                    if (key && textOf(key, 'fifths') !== null) {
                        keySignatures.push({ ...at(0), fifths: number(textOf(key, 'fifths')), minor: textOf(key, 'mode') === 'minor' });
                    }
                    break;
                }
                case 'direction': {
                    const offset = number(textOf(element, 'offset'));
                    for (const type of children(element, 'direction-type')) {
                        const dyn = child(type, 'dynamics');
                        if (dyn) {
                            for (const mark of children(dyn)) {
                                if (DYNAMIC_VELOCITY[mark.name] !== undefined) {
                                    dynamics.push({ ...at(offset), velocity: DYNAMIC_VELOCITY[mark.name] });
                                }
                            }
                        }
                    }
                    const sound = child(element, 'sound');
                    if (sound && sound.attrs.tempo) {
                        tempos.push({ ...at(offset), bpm: number(sound.attrs.tempo) });
                    } else {
                        // A metronome mark without playback tempo
                        const metronome = children(element, 'direction-type').map(t => child(t, 'metronome')).find(Boolean);
                        const perMinute = metronome && number(textOf(metronome, 'per-minute'));
                        if (perMinute > 0) {
                            const unit = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[textOf(metronome, 'beat-unit')] || 1;
                            const dotted = child(metronome, 'beat-unit-dot') ? 1.5 : 1;
                            tempos.push({ ...at(offset), bpm: perMinute * unit * dotted });
                        }
                    }
                    break;
                }
                case 'sound':
                    if (element.attrs.tempo) {
                        tempos.push({ ...at(0), bpm: number(element.attrs.tempo) });
                    }
                    break;
                case 'backup':
                    pos = Math.max(0, pos - number(textOf(element, 'duration')));
                    break;
                case 'forward':
                    pos += number(textOf(element, 'duration'));
                    maxPos = Math.max(maxPos, pos);
                    break;
                case 'note': {
                    if (child(element, 'grace')) break;
                    const duration = number(textOf(element, 'duration'));
                    const staff = textOf(element, 'staff') || '1';
                    const voice = textOf(element, 'voice') || '1';
                    if (!child(element, 'cue')) {
                        written.add(`${measureIndex}:${staff}:${voice}`);
                    }
                    const isChord = child(element, 'chord') !== null;
                    const start = isChord ? lastStart : pos;
                    if (!isChord) {
                        lastStart = pos;
                        pos += duration;
                        maxPos = Math.max(maxPos, pos);
                    }
                    const pitch = child(element, 'pitch');
                    if (!pitch || child(element, 'cue')) break;
                    const octaveShift = transposeOctaves !== 0 && transposeOctaves === clefOctaves[staff] ? 0 : transposeOctaves;
                    const midi = (number(textOf(pitch, 'octave'), 4) + 1) * 12
                        + (STEP_SEMITONES[textOf(pitch, 'step')] ?? 0)
                        + Math.round(number(textOf(pitch, 'alter')))
                        + transposeSemitones + 12 * octaveShift;
                    if (midi < 0 || midi > 127) break;
                    const ties = children(element, 'tie').map(t => t.attrs.type);
                    const lyric = children(element, 'lyric').find(l => !l.attrs.number || l.attrs.number === '1') || child(element, 'lyric');
                    let lyricText = null;
                    if (lyric && textOf(lyric, 'text')) {
                        const syllabic = textOf(lyric, 'syllabic');
                        lyricText = textOf(lyric, 'text') + (syllabic === 'begin' || syllabic === 'middle' ? '-' : '');
                    }
                    notes.push({
                        measureIndex,
                        quarters: start / divisions,
                        lengthQuarters: duration / divisions,
                        pitch: midi,
                        staff,
                        voice,
                        tieStart: ties.includes('start'),
                        tieStop: ties.includes('stop'),
                        lyric: lyricText
                    });
                    break;
                }
                default:
                    break;
            }
        }
        measureLengths.push(maxPos / divisions);
    });

    return { notes, dynamics, tempos, timeSignatures, keySignatures, measureLengths, divisionsUsed, written };
}

/**
 * Join tied notes into single notes: a note marked as the end of a tie
 * extends a tied note of the same pitch that ends where it starts, preferably
 * in the same stave and voice (another voice may have the same pitch at the
 * same time, as when a keyboard part doubles a line)
 */
function joinTies(notes) {
    const open = [];
    const result = [];
    for (const note of [...notes].sort((a, b) => a.tick - b.tick)) {
        if (note.tieStop) {
            const candidates = open.filter(p => p.pitch === note.pitch && p.tick + p.duration === note.tick);
            const pending = candidates.find(p => p.staff === note.staff && p.voice === note.voice) || candidates[0];
            if (pending) {
                pending.duration += note.duration;
                if (!note.tieStart) open.splice(open.indexOf(pending), 1);
                continue;
            }
        }
        result.push(note);
        if (note.tieStart) open.push(note);
    }
    return result;
}

/**
 * Split a vocal part into lines, one per staff and voice that carries a
 * substantial share of its notes (a shared stave such as "Soprano I & II",
 * or closed score). Notes of minor voices (occasional divisi) stay in the
 * main line of their staff. Where a line has nothing written in a measure,
 * it sings what the other voice on its staff sings there (unison is usually
 * written once). Instrumental parts, and unnamed parts on several staves
 * (probably a keyboard) unless named as a choir, stay as one line.
 * @param {Array<Object>} notes - The part's notes
 * @param {string} name - Part name
 * @param {Set<string>} written - "measure:staff:voice" keys with notes or rests
 * @returns {Array<Array<Object>>} Notes for each line, upper voice first
 */
export function splitLines(notes, name, written) {
    const parsed = parseName(name);
    const staves = new Set(notes.map(n => n.staff));
    const vocal = parsed.kind === 'voice' || parsed.kind === 'mixed' || isChoirName(name)
        || (parsed.kind === 'unknown' && staves.size === 1);
    if (!vocal) {
        return [notes];
    }

    const groups = new Map();
    for (const note of notes) {
        const key = `${note.staff}:${note.voice}`;
        if (!groups.has(key)) groups.set(key, { staff: note.staff, voice: note.voice, notes: [] });
        groups.get(key).notes.push(note);
    }
    const order = (a, b) => (Number(a.staff) - Number(b.staff)) || (Number(a.voice) - Number(b.voice));
    const main = [...groups.values()].filter(g => g.notes.length >= SPLIT_SHARE * notes.length).sort(order);
    if (main.length < 2 || main.length > MAX_LINES_PER_PART) {
        return [notes];
    }

    // Minor voices join the largest main line on their staff, or the first line
    for (const group of groups.values()) {
        if (main.includes(group)) continue;
        const sameStaff = main.filter(m => m.staff === group.staff).sort((a, b) => b.notes.length - a.notes.length);
        (sameStaff[0] || main[0]).notes.push(...group.notes);
    }

    return main.map(line => {
        const borrowed = [];
        for (const other of main) {
            if (other === line || other.staff !== line.staff) continue;
            for (const note of other.notes) {
                if (!written.has(`${note.measureIndex}:${line.staff}:${line.voice}`)) {
                    borrowed.push(note);
                }
            }
        }
        return [...line.notes, ...borrowed];
    });
}

/**
 * Read a MusicXML score
 * @param {Uint8Array} bytes - File contents (.musicxml/.xml, or .mxl archive)
 * @param {{format: string, zipEntries?: Array<Object>}} detected - Result of detectFormat
 * @returns {Promise<{song: Object, title: string, composer: string, splitParts: string[]}>}
 *     The score as a neutral MIDI song, metadata, and the names of parts whose shared stave was split
 * @throws {MusicXmlError} If the score can't be read
 */
export async function readMusicXml(bytes, detected) {
    const xmlBytes = detected.format === 'mxl' ? await scoreFromArchive(bytes, detected.zipEntries) : bytes;
    let root;
    try {
        root = parseXml(decodeXml(xmlBytes));
    } catch (error) {
        if (error instanceof XmlParseError) {
            throw new MusicXmlError(error.message, 'musicxml-unreadable');
        }
        throw error;
    }
    root = partwise(root);
    if (root.name !== 'score-partwise') {
        throw new MusicXmlError('Not a MusicXML score', 'musicxml-unreadable');
    }
    return scoreToSong(root);
}

/**
 * Convert a parsed partwise score to a neutral MIDI song
 */
function scoreToSong(root) {
    const metadata = scoreMetadata(root);
    const list = partList(root);
    const readParts = children(root, 'part').map(part => ({ id: part.attrs.id, ...readPart(part) }));
    if (readParts.length === 0) {
        throw new MusicXmlError('The score has no parts', 'musicxml-unreadable');
    }

    // Resolution: the smallest that represents every part's divisions exactly
    let ticksPerQuarter = 1;
    for (const part of readParts) {
        for (const d of part.divisionsUsed) {
            ticksPerQuarter = ticksPerQuarter * d / gcd(ticksPerQuarter, d);
        }
    }
    while (ticksPerQuarter < 96) ticksPerQuarter *= 2;
    if (ticksPerQuarter > MAX_TICKS_PER_QUARTER) ticksPerQuarter = FALLBACK_TICKS_PER_QUARTER;

    // Measures start at the same time in every part: each measure lasts as long as its longest part
    const measureCount = Math.max(...readParts.map(p => p.measureLengths.length));
    const measureStarts = [0];
    for (let m = 0; m < measureCount; m++) {
        const length = Math.max(0, ...readParts.map(p => p.measureLengths[m] || 0));
        measureStarts.push(measureStarts[m] + Math.round(length * ticksPerQuarter));
    }
    const tickOf = ({ measureIndex, quarters }) => measureStarts[measureIndex] + Math.round(quarters * ticksPerQuarter);

    // Conductor: title, copyright, tempo (first mark at each position wins),
    // time and key signatures from the first part
    const conductor = [];
    if (metadata.title) {
        conductor.push({ tick: 0, type: 'meta', metaType: META.TRACK_NAME, data: encodeText(metadata.title) });
    }
    for (const rights of metadata.rights) {
        conductor.push({ tick: 0, type: 'meta', metaType: META.COPYRIGHT, data: encodeText(rights) });
    }
    const tempoTicks = new Set();
    for (const tempo of readParts.flatMap(p => p.tempos).map(t => ({ tick: tickOf(t), bpm: t.bpm })).sort((a, b) => a.tick - b.tick)) {
        if (tempoTicks.has(tempo.tick) || !(tempo.bpm > 0)) continue;
        tempoTicks.add(tempo.tick);
        const us = Math.min(0xffffff, Math.round(60e6 / tempo.bpm));
        conductor.push({ tick: tempo.tick, type: 'meta', metaType: META.TEMPO, data: new Uint8Array([us >> 16, (us >> 8) & 0xff, us & 0xff]) });
    }
    let lastTime = '';
    for (const time of readParts[0].timeSignatures) {
        const key = `${time.beats}/${time.beatType}`;
        if (key === lastTime && time.measureIndex > 0) continue;
        lastTime = key;
        conductor.push({ tick: tickOf(time), type: 'meta', metaType: META.TIME_SIGNATURE, data: new Uint8Array([time.beats, Math.round(Math.log2(time.beatType)), 24, 8]) });
    }
    for (const key of readParts[0].keySignatures) {
        conductor.push({ tick: tickOf(key), type: 'meta', metaType: META.KEY_SIGNATURE, data: new Uint8Array([key.fifths & 0xff, key.minor ? 1 : 0]) });
    }
    conductor.push({ tick: measureStarts[measureCount], type: 'meta', metaType: META.END_OF_TRACK, data: new Uint8Array(0) });

    const tracks = [{ events: conductor }];
    const splitParts = [];
    let nextChannel = 0;
    // Channels only need to differ within a track; channel 9 is percussion, so skip it
    const takeChannel = () => {
        let channel = nextChannel++ % 16;
        if (channel === 9) channel = nextChannel++ % 16;
        return channel;
    };

    for (const part of readParts) {
        const info = list.get(part.id) || { name: part.id, program: null };
        const notes = part.notes.map(n => ({
            ...n,
            tick: tickOf(n),
            duration: Math.round(n.lengthQuarters * ticksPerQuarter)
        }));
        if (notes.length === 0) continue;

        // Velocity from the latest written dynamic in the part
        const dynamics = part.dynamics.map(d => ({ tick: tickOf(d), velocity: d.velocity })).sort((a, b) => a.tick - b.tick);
        for (const note of notes) {
            let velocity = DEFAULT_VELOCITY;
            for (const d of dynamics) {
                if (d.tick > note.tick) break;
                velocity = d.velocity;
            }
            note.velocity = velocity;
        }

        const lines = splitLines(notes, info.name, part.written);
        if (lines.length > 1) {
            splitParts.push(info.name);
        }

        lines.forEach((lineNotes, lineIndex) => {
            const channel = takeChannel();
            const name = lines.length > 1 ? `${info.name} (voice ${lineIndex + 1})` : info.name;
            const joined = joinTies(lineNotes.map(n => ({ ...n, line: lineIndex })));
            let program = info.program;
            if (program === null) {
                const match = PROGRAM_BY_WORD.find(([pattern]) => pattern.test(info.name));
                program = match ? match[1] : 0;
            }
            const events = [
                { tick: 0, type: 'meta', metaType: META.TRACK_NAME, data: encodeText(name) },
                { tick: 0, type: 'program', channel, program }
            ];
            const lyricTicks = new Set();
            for (const note of joined) {
                if (note.duration <= 0) continue;
                events.push({ tick: note.tick, type: 'noteOn', channel, note: note.pitch, velocity: note.velocity });
                events.push({ tick: note.tick + note.duration, type: 'noteOff', channel, note: note.pitch, velocity: 0 });
                if (note.lyric && !lyricTicks.has(note.tick)) {
                    lyricTicks.add(note.tick);
                    events.push({ tick: note.tick, type: 'meta', metaType: META.LYRIC, data: encodeText(note.lyric) });
                }
            }
            events.sort((a, b) => a.tick - b.tick);
            tracks.push({ events });
        });
    }

    return {
        song: { format: 1, ticksPerQuarter, tracks },
        title: metadata.title,
        composer: metadata.composer,
        splitParts
    };
}
