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

    const suggested = suggestMetadata(song, filename);
    const classified = classifyParts(song);
    const { parts } = classified;
    if (parts.length === 0) {
        return rejected('midi', [message.noNotes()], suggested);
    }

    const voices = groupVoices(parts);
    if (Object.keys(voices).length === 0) {
        // A part playing chords across several voices' range is probably the voices merged together
        const merged = parts.some(looksLikeMergedVoices);
        return rejected('midi', [merged ? message.voicesMerged() : message.noVoices()], suggested);
    }
    if (classified.doubleChoir) {
        return rejected('midi', [message.doubleChoir()], suggested);
    }
    for (const [section, group] of Object.entries(voices)) {
        if (group.length > MAX_PER_SECTION) {
            return rejected('midi', [message.tooManyVoices(section)], suggested);
        }
    }
    const accompanimentChannels = assignAccompanimentChannels(parts.filter(p => p.role === 'accompaniment' || p.role === 'solo'));
    if (!accompanimentChannels) {
        return rejected('midi', [message.tooManyAccompaniment()], suggested);
    }

    const built = buildPracticeSong(song, classified, voices, accompanimentChannels);
    const midi = writeMidi(built.song);
    const audit = auditMidi(built.song);

    const voiceOutputs = built.outputParts.filter(o => o.part.role === 'voice');
    const otherOutputs = built.outputParts.filter(o => o.part.role !== 'voice');
    const messages = [];
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
        format: 'midi',
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
 * @returns {Object} Result: status, format, summary, messages, suggested, midi
 */
export function convertFile(input, filename = '') {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > LIMITS.MAX_FILE_BYTES) {
        return rejected(null, [message.tooLarge(bytes.length)]);
    }
    const { format } = detectFormat(bytes, filename);
    switch (format) {
        case 'midi':
            return convertMidi(bytes, filename);
        case 'musicxml':
        case 'mxl':
            return rejected(format, [message.musicXmlNotYet()], { title: titleFromFilename(filename), composer: '' });
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
