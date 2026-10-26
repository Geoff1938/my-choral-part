/**
 * Check a user's file and convert it into a practice MIDI.
 * Runs entirely in memory; nothing is stored.
 */

import { readMidi, writeMidi, MidiParseError } from './smf.js';
import { detectFormat, unwrapRiffMidi } from './detect.js';
import { classifyParts, groupVoices, looksLikeMergedVoices } from './classify.js';
import { assignAccompanimentChannels, buildPracticeSong } from './build.js';
import { auditMidi, tempoMap } from './audit.js';
import { suggestMetadata, titleFromFilename } from './metadata.js';
import { readMusicXml, MusicXmlError } from './musicxml.js';
import { LIMITS, message, overallStatus } from './checks.js';
import { MAX_PER_SECTION } from './recipe.js';

function rejected(format, messages, suggested = null) {
    return { status: 'rejected', format, summary: null, messages, suggested, midi: null };
}

/**
 * Convert a MIDI file into a practice MIDI
 * @param {Uint8Array} bytes - MIDI file contents
 * @param {string} [filename] - Original file name (for the suggested title)
 * @returns {Object} Result: status, format, summary, messages, suggested, midi
 */
export function convertMidi(bytes, filename = '') {
    let song;
    try {
        song = readMidi(unwrapRiffMidi(bytes));
    } catch (error) {
        if (error instanceof MidiParseError) {
            return rejected('midi', [message.unreadable(error.message)]);
        }
        throw error;
    }
    if (song.format === 2) {
        return rejected('midi', [message.format2()]);
    }
    return convertSong(song, 'midi', suggestMetadata(song, filename));
}

/**
 * Convert a MusicXML score into a practice MIDI, through the MIDI pipeline
 * @param {Uint8Array} bytes - File contents
 * @param {{format: string, zipEntries?: Array<Object>}} detected - Result of detectFormat
 * @param {string} [filename] - Original file name (the fallback title)
 * @returns {Promise<Object>} Result: status, format, summary, messages, suggested, midi
 */
export async function convertMusicXml(bytes, detected, filename = '') {
    let score;
    try {
        score = await readMusicXml(bytes, detected);
    } catch (error) {
        if (error instanceof MusicXmlError) {
            return rejected(detected.format, [message.musicXmlProblem(error.code, error.message)]);
        }
        throw error;
    }
    const suggested = { title: score.title || titleFromFilename(filename), composer: score.composer };
    return convertSong(score.song, detected.format, suggested, score.splitParts.map(name => message.voicesSplit(name)));
}

/**
 * Classify, check and convert a parsed song
 * @param {Object} song - Parsed MIDI file, or a score read as one
 * @param {string} format - Source format, for the result
 * @param {{title: string, composer: string}} suggested - Title and composer suggestions
 * @param {Array<Object>} [sourceWarnings] - Warnings from reading the source
 * @returns {Object} Result: status, format, summary, messages, suggested, midi
 */
function convertSong(song, format, suggested, sourceWarnings = []) {
    const classified = classifyParts(song);
    const { parts } = classified;
    if (parts.length === 0) {
        return rejected(format, [message.noNotes()], suggested);
    }

    const voices = groupVoices(parts);
    if (Object.keys(voices).length === 0) {
        // A part playing chords across several voices' range is probably the voices merged together
        const merged = parts.some(looksLikeMergedVoices);
        return rejected(format, [merged ? message.voicesMerged() : message.noVoices()], suggested);
    }
    if (classified.doubleChoir) {
        return rejected(format, [message.doubleChoir()], suggested);
    }
    for (const [section, group] of Object.entries(voices)) {
        if (group.length > MAX_PER_SECTION) {
            return rejected(format, [message.tooManyVoices(section)], suggested);
        }
    }
    const accompanimentChannels = assignAccompanimentChannels(parts.filter(p => p.role === 'accompaniment' || p.role === 'solo'));
    if (!accompanimentChannels) {
        return rejected(format, [message.tooManyAccompaniment()], suggested);
    }

    const built = buildPracticeSong(song, classified, voices, accompanimentChannels);
    const midi = writeMidi(built.song);
    const audit = auditMidi(built.song);

    const voiceOutputs = built.outputParts.filter(o => o.part.role === 'voice');
    const otherOutputs = built.outputParts.filter(o => o.part.role !== 'voice');
    const messages = [...sourceWarnings];
    if (audit.durationSeconds < LIMITS.SHORT_PIECE_SECONDS) {
        messages.push(message.short(audit.durationSeconds));
    }
    if (built.velocityScale !== null) {
        messages.push(message.noDynamics());
    }
    for (const output of voiceOutputs.filter(o => o.part.classifiedBy === 'pitch')) {
        messages.push(message.roleInferred(output.part.sourceName, output.name));
    }
    if (tempoMap(song).length === 0) {
        messages.push(message.noTempo());
    }
    messages.push(message.partsFound(voiceOutputs));
    if (otherOutputs.length) {
        messages.push(message.accompanimentKept(otherOutputs));
    }
    messages.push(message.timing(audit.durationSeconds, audit.initialBpm));

    return {
        status: overallStatus(messages),
        format,
        summary: {
            durationSeconds: audit.durationSeconds,
            initialBpm: audit.initialBpm,
            ticksPerQuarter: song.ticksPerQuarter,
            parts: built.outputParts.map(({ part, name, channel }) => ({
                sourceName: part.sourceName,
                name,
                role: part.role,
                section: part.section || null,
                classifiedBy: part.classifiedBy,
                lowestNote: part.lowestNote,
                highestNote: part.highestNote,
                noteCount: part.notes.length,
                channel
            }))
        },
        messages,
        suggested,
        midi
    };
}

/**
 * Check and convert any file a user picks
 * @param {ArrayBuffer|Uint8Array} input - File contents
 * @param {string} [filename] - Original file name
 * @returns {Promise<Object>} Result: status, format, summary, messages, suggested, midi
 */
export async function convertFile(input, filename = '') {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > LIMITS.MAX_FILE_BYTES) {
        return rejected(null, [message.tooLarge(bytes.length)]);
    }
    const detected = detectFormat(bytes, filename);
    const { format } = detected;
    switch (format) {
        case 'midi':
            return convertMidi(bytes, filename);
        case 'musicxml':
        case 'mxl':
            return convertMusicXml(bytes, detected, filename);
        case 'pdf':
            return rejected(format, [message.pdf()]);
        case 'musescore':
            return rejected(format, [message.musescore()]);
        case 'notation':
            return rejected(format, [message.notation()]);
        default:
            return rejected(format, [message.unknownFormat()]);
    }
}
