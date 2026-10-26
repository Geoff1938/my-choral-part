/**
 * Classify the parts of a MIDI file: voice parts (with their section),
 * accompaniment, solo parts, lyric-only tracks and conductor tracks.
 */

import { META, extractNotes, metaText } from './smf.js';

// Words in a part name that mean a voice section
const SECTION_WORDS = {
    soprano: ['soprano', 'sopranos', 'sopran', 'sopr', 'sop', 'treble', 'trebles', 'cantus', 'canto', 'superius', 'discantus', 'dessus'],
    alto: ['alto', 'altos', 'alt', 'altus', 'contralto', 'contratenor', 'countertenor', 'mezzo', 'haute'],
    tenor: ['tenor', 'tenors', 'tenore', 'tenori', 'taille'],
    bass: ['bass', 'basses', 'bassus', 'basse', 'basso', 'bassi', 'baritone', 'bariton', 'baritono']
};

// Single-letter abbreviations, accepted only when they are the whole name (e.g. "S", "S2", "T 1")
const SECTION_LETTERS = { s: 'soprano', a: 'alto', t: 'tenor', b: 'bass' };

// Words in a part name that mean an instrument
const INSTRUMENT_WORDS = new Set([
    'organ', 'organo', 'orgel', 'orgue', 'piano', 'pianoforte', 'klavier', 'keyboard', 'keys', 'harpsichord',
    'cembalo', 'clavecin', 'continuo', 'continue', 'bc', 'accomp', 'accompaniment', 'accompagnement', 'acc',
    'orchestra', 'orch', 'strings', 'string', 'violin', 'violins', 'violino', 'violini', 'vln', 'vl', 'vn',
    'viola', 'violas', 'viole', 'viol', 'viols', 'violone', 'cello', 'cellos', 'violoncello', 'vc', 'vlc',
    'contrabass', 'contrabasso', 'doublebass', 'double', 'bassoon', 'bassoons', 'fagotto', 'fagott', 'oboe',
    'oboes', 'flute', 'flutes', 'flauto', 'flauti', 'piccolo', 'recorder', 'recorders', 'clarinet', 'clarinets',
    'horn', 'horns', 'corno', 'corni', 'trumpet', 'trumpets', 'tromba', 'trombe', 'trombone', 'trombones', 'tuba',
    'cornett', 'anglais', 'sackbut', 'timpani', 'timp', 'drum', 'drums', 'percussion', 'perc', 'guitar', 'harp', 'lute',
    'theorbo', 'synth', 'instrument', 'instr', 'reduction', 'rh', 'lh'
]);

const SOLO_WORDS = new Set(['solo', 'soli', 'soloist']);
const CHOIR_WORDS = new Set(['choir', 'chor', 'chorus', 'coro', 'choeur']);

const NUMBER_WORDS = {
    1: 1, 2: 2, 3: 3, 4: 4, i: 1, ii: 2, iii: 3, iv: 4, one: 1, two: 2, three: 3,
    first: 1, second: 2, third: 3, primo: 1, secondo: 2
};

// Typical median pitch of each section (MIDI note numbers), used to place a
// part whose name does not say what it is
const TYPICAL_MEDIAN = { soprano: 72, alto: 65, tenor: 59, bass: 52 };

// A part is treated as chords when at least this share of its notes start
// while another of its notes is sounding
const CHORD_SHARE = 0.15;

// A part wider than this (in semitones) is not a single voice
const MAX_VOICE_RANGE = 30;

// Meta events that belong in the conductor track wherever they appear
const CONDUCTOR_META = new Set([META.TEMPO, META.TIME_SIGNATURE, META.SMPTE_OFFSET, META.COPYRIGHT, META.MARKER, META.CUE]);

// Meta events that are replaced or meaningless after conversion
const DROPPED_META = new Set([META.TRACK_NAME, META.INSTRUMENT_NAME, META.CHANNEL_PREFIX, META.PORT, META.END_OF_TRACK]);

/**
 * Split a part name into lower-case words, separating camel case
 * ("CantusOne"), numbers ("Soprano1", "S2") and ordinals ("1st")
 * @param {string} name - Part name
 * @returns {string[]} Words
 */
export function nameWords(name) {
    return (name || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b(\d+)(st|nd|rd|th)\b/gi, '$1')
        .replace(/\bd['’ ]?bass\b/gi, 'doublebass')
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/**
 * Work out what a part name says about the part
 * @param {string} name - Part name
 * @returns {{kind: string, section?: string, number?: number|null, choir?: number|null}}
 *     kind is 'instrument', 'solo', 'voice' or 'unknown'
 */
export function parseName(name) {
    const words = nameWords(name);
    if (words.some(w => INSTRUMENT_WORDS.has(w))) {
        return { kind: 'instrument' };
    }

    // A choir number ("Choir 2", "Coro II") is not a voice number
    let choir = null;
    const voiceWords = [];
    for (let i = 0; i < words.length; i++) {
        if (CHOIR_WORDS.has(words[i]) && NUMBER_WORDS[words[i + 1]] !== undefined) {
            choir = NUMBER_WORDS[words[i + 1]];
            i++;
        } else {
            voiceWords.push(words[i]);
        }
    }

    let section = null;
    if (voiceWords.length <= 2 && SECTION_LETTERS[voiceWords[0]] && (voiceWords.length === 1 || NUMBER_WORDS[voiceWords[1]] !== undefined)) {
        section = SECTION_LETTERS[voiceWords[0]];
    } else {
        // "Mezzo-soprano" is an alto part, so look for alto words first
        for (const candidate of ['alto', 'soprano', 'tenor', 'bass']) {
            if (voiceWords.some(w => SECTION_WORDS[candidate].includes(w))) {
                section = candidate;
                break;
            }
        }
        // "Counter tenor" written as two words
        if (section === 'tenor' && voiceWords.includes('counter')) {
            section = 'alto';
        }
    }

    if (!section) {
        return { kind: 'unknown', choir };
    }
    if (voiceWords.some(w => SOLO_WORDS.has(w))) {
        return { kind: 'solo', section, choir };
    }
    const numberWord = voiceWords.find(w => NUMBER_WORDS[w] !== undefined);
    return { kind: 'voice', section, number: numberWord ? NUMBER_WORDS[numberWord] : null, choir };
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Share of a part's notes that start while another of its notes is sounding
 * @param {Array<{tick: number, duration: number}>} notes - Notes in onset order
 * @returns {number} Share between 0 and 1
 */
export function chordShare(notes) {
    if (notes.length === 0) return 0;
    let overlapping = 0;
    let soundingUntil = -1;
    let lastOnset = -1;
    for (const note of notes) {
        if (note.tick < soundingUntil || note.tick === lastOnset) {
            overlapping++;
        }
        soundingUntil = Math.max(soundingUntil, note.tick + note.duration);
        lastOnset = note.tick;
    }
    return overlapping / notes.length;
}

/**
 * Whether a part plays chords over a wider range than one voice, as when all
 * the voices of a score are merged onto one track
 * @param {Object} part - Classified part
 * @returns {boolean} True if the part looks like merged voices
 */
export function looksLikeMergedVoices(part) {
    return part.chordShare >= CHORD_SHARE && part.highestNote - part.lowestNote > MAX_VOICE_RANGE;
}

/**
 * Classify the parts of a parsed MIDI file
 * A part is the notes of one channel within one track. Tracks without notes
 * are lyric carriers (their lyrics go to the nearest preceding part, as
 * LilyPond writes them) or conductor tracks.
 * @param {{format: number, ticksPerQuarter: number, tracks: Array<{events: Array<Object>}>}} song - Parsed MIDI file
 * @returns {{parts: Array<Object>, conductorEvents: Array<Object>, conductorName: string|null, doubleChoir: boolean}}
 */
export function classifyParts(song) {
    const parts = [];
    const conductorEvents = [];
    const lyricCarriers = [];
    let conductorName = null;

    song.tracks.forEach((track, trackIndex) => {
        const notes = extractNotes(track.events);
        const name = metaText(track, META.TRACK_NAME) || metaText(track, META.INSTRUMENT_NAME) || '';

        if (notes.length === 0) {
            const hasLyrics = track.events.some(e => e.type === 'meta' && e.metaType === META.LYRIC);
            if (hasLyrics) {
                lyricCarriers.push({ trackIndex, events: track.events.filter(e => e.type === 'meta' && !DROPPED_META.has(e.metaType)) });
                return;
            }
            if (trackIndex === 0 && name) {
                conductorName = name;
            }
            // Channel events in a track with no notes would act on channels that are about to be renumbered
            conductorEvents.push(...track.events.filter(e => (e.type === 'meta' && !DROPPED_META.has(e.metaType)) || e.type === 'sysex'));
            return;
        }

        const channels = [...new Set(notes.map(n => n.channel))].sort((a, b) => a - b);
        const trackParts = channels.map(channel => {
            const partNotes = notes.filter(n => n.channel === channel);
            const pitches = partNotes.map(n => n.note);
            return {
                trackIndex,
                sourceChannel: channel,
                sourceName: name,
                notes: partNotes,
                // Channel events other than notes, still on the source channel
                controlEvents: track.events.filter(e => e.channel === channel && e.type !== 'noteOn' && e.type !== 'noteOff'),
                otherEvents: [],
                lowestNote: Math.min(...pitches),
                highestNote: Math.max(...pitches),
                medianNote: median(pitches),
                chordShare: chordShare(partNotes)
            };
        });
        for (const event of track.events) {
            if (event.type !== 'meta') continue;
            if (CONDUCTOR_META.has(event.metaType)) {
                conductorEvents.push(event);
            } else if (!DROPPED_META.has(event.metaType)) {
                trackParts[0].otherEvents.push(event);
            }
        }
        parts.push(...trackParts);
    });

    // Lyrics go to the nearest part at or before their track (LilyPond writes
    // each voice's lyrics on the track that follows it), or else the first part
    for (const carrier of lyricCarriers) {
        const owner = [...parts].reverse().find(p => p.trackIndex < carrier.trackIndex) || parts[0];
        if (owner) {
            owner.otherEvents.push(...carrier.events);
        }
    }

    let doubleChoir = false;
    for (const part of parts) {
        const parsed = parseName(part.sourceName);
        if (parsed.choir && parsed.choir > 1) {
            doubleChoir = true;
        }
        if (part.sourceChannel === 9) {
            Object.assign(part, { role: 'percussion', classifiedBy: 'channel' });
        } else if (parsed.kind === 'instrument') {
            Object.assign(part, { role: 'accompaniment', classifiedBy: 'name' });
        } else if (parsed.kind === 'solo') {
            Object.assign(part, { role: 'solo', section: parsed.section, classifiedBy: 'name' });
        } else if (parsed.kind === 'voice') {
            Object.assign(part, { role: 'voice', section: parsed.section, nameNumber: parsed.number, classifiedBy: 'name' });
        } else if (part.chordShare >= CHORD_SHARE) {
            Object.assign(part, { role: 'accompaniment', classifiedBy: 'chords' });
        } else if (part.highestNote - part.lowestNote > MAX_VOICE_RANGE) {
            Object.assign(part, { role: 'accompaniment', classifiedBy: 'range' });
        } else {
            part.role = 'unknown';
        }
    }

    // Place unnamed parts by pitch, against the named parts where there are any
    const reference = { ...TYPICAL_MEDIAN };
    for (const section of Object.keys(reference)) {
        const named = parts.filter(p => p.role === 'voice' && p.section === section);
        if (named.length) {
            reference[section] = median(named.map(p => p.medianNote));
        }
    }
    for (const part of parts.filter(p => p.role === 'unknown')) {
        let best = null;
        for (const [section, typical] of Object.entries(reference)) {
            if (best === null || Math.abs(part.medianNote - typical) < Math.abs(part.medianNote - reference[best])) {
                best = section;
            }
        }
        Object.assign(part, { role: 'voice', section: best, nameNumber: null, classifiedBy: 'pitch' });
    }

    return { parts, conductorEvents, conductorName, doubleChoir };
}

/**
 * Number the voice parts within each section: by the number in their names
 * where every part has a distinct one, otherwise highest first
 * @param {Array<Object>} parts - Classified parts
 * @returns {Object<string, Array<Object>>} Voice parts by section, in order
 */
export function groupVoices(parts) {
    const sections = {};
    for (const part of parts.filter(p => p.role === 'voice')) {
        (sections[part.section] = sections[part.section] || []).push(part);
    }
    for (const group of Object.values(sections)) {
        const numbers = group.map(p => p.nameNumber);
        const useNames = numbers.every(n => n !== null) && new Set(numbers).size === numbers.length;
        group.sort(useNames
            ? (a, b) => a.nameNumber - b.nameNumber
            : (a, b) => (b.medianNote - a.medianNote) || (a.trackIndex - b.trackIndex));
    }
    return sections;
}
