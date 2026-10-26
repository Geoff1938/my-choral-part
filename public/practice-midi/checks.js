/**
 * Report messages, written for singers. Each has a stable code (for tests and
 * the front end) and a level: 'reject' (no file produced), 'warning'
 * (converted, with a caveat) or 'info'.
 */

// Limits, all adjustable
export const LIMITS = {
    MAX_FILE_BYTES: 5 * 1024 * 1024,
    SHORT_PIECE_SECONDS: 30
};

const SECTION_LABEL = { soprano: 'soprano', alto: 'alto', tenor: 'tenor', bass: 'bass' };

function formatDuration(seconds) {
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function quoted(name) {
    return name ? `"${name}"` : 'an unnamed part';
}

export const message = {
    tooLarge: bytes => ({
        level: 'reject', code: 'too-large',
        text: `This file is too large (${(bytes / 1048576).toFixed(1)} MB). The limit is ${LIMITS.MAX_FILE_BYTES / 1048576} MB.`
    }),
    pdf: () => ({
        level: 'reject', code: 'pdf',
        text: 'We can\'t read printed scores. Look for a MIDI or MusicXML version of the piece instead.'
    }),
    notation: () => ({
        level: 'reject', code: 'notation-file',
        text: 'We can\'t read files saved by notation programs directly. Export MusicXML from your notation program and upload that.'
    }),
    musescore: () => ({
        level: 'reject', code: 'musescore-file',
        text: 'We can\'t read MuseScore files directly. In MuseScore, use File > Export and choose MusicXML, then upload that.'
    }),
    unknownFormat: () => ({
        level: 'reject', code: 'unknown-format',
        text: 'This doesn\'t look like a MIDI or MusicXML file. Please choose a MIDI (.mid) or MusicXML (.musicxml, .xml or .mxl) file.'
    }),
    musicXmlProblem: (code, detail) => ({
        level: 'reject',
        code,
        text: {
            'mxl-too-large': 'This compressed MusicXML file is too large when unpacked (the limit is 50 MB).',
            'mxl-broken': 'This compressed MusicXML (.mxl) file is damaged or doesn\'t contain a score.',
            'no-decompression': 'Your browser can\'t open compressed MusicXML (.mxl) files. Update your browser, or export uncompressed MusicXML (.musicxml) and upload that.'
        }[code] || `This MusicXML file couldn't be read (${detail}). It may be damaged.`
    }),
    unreadable: reason => ({
        level: 'reject', code: 'unreadable',
        text: `This MIDI file couldn't be read (${reason.charAt(0).toLowerCase()}${reason.slice(1)}). It may be damaged.`
    }),
    format2: () => ({
        level: 'reject', code: 'unsupported-midi-format',
        text: 'This is a type 2 MIDI file (a set of separate patterns), which isn\'t supported.'
    }),
    noNotes: () => ({
        level: 'reject', code: 'no-notes',
        text: 'This MIDI file doesn\'t contain any notes.'
    }),
    voicesMerged: () => ({
        level: 'reject', code: 'voices-merged',
        text: 'All the voices in this file are played together as chords on a single track, so they can\'t be separated into parts. Look for a version with a separate track for each voice.'
    }),
    noVoices: () => ({
        level: 'reject', code: 'no-voices',
        text: 'We couldn\'t find any voice parts in this file, only instruments.'
    }),
    doubleChoir: () => ({
        level: 'reject', code: 'double-choir',
        text: 'This looks like music for double choir, which isn\'t supported yet.'
    }),
    tooManyVoices: section => ({
        level: 'reject', code: 'too-many-voices',
        text: `This file has more than two ${SECTION_LABEL[section]} parts. At most two parts per voice (soprano, alto, tenor, bass) are supported.`
    }),
    tooManyAccompaniment: () => ({
        level: 'reject', code: 'too-many-accompaniment',
        text: 'This file has more accompaniment parts than the player can handle (at most seven different instruments).'
    }),
    short: seconds => ({
        level: 'warning', code: 'short',
        text: `This piece is only ${Math.round(seconds)} seconds long, so it may be an excerpt.`
    }),
    noDynamics: () => ({
        level: 'warning', code: 'no-dynamics',
        text: 'The file has no dynamics (every note is equally loud), so a standard medium level has been used.'
    }),
    roleInferred: (sourceName, outputName) => ({
        level: 'warning', code: 'role-inferred',
        text: `We couldn't tell which voice ${quoted(sourceName)} is from its name, so it has been treated as ${outputName} because of its range. Please check this is right.`
    }),
    voicesSplit: partName => ({
        level: 'warning', code: 'voices-split',
        text: `The part ${quoted(partName)} had more than one voice on a stave, so it has been split into separate parts. Please check they are right.`
    }),
    noTempo: () => ({
        level: 'warning', code: 'no-tempo',
        text: 'The file doesn\'t set a tempo, so the standard MIDI tempo of 120 beats per minute has been used.'
    }),
    partsFound: outputParts => ({
        level: 'info', code: 'parts-found',
        text: `Voice parts: ${outputParts.map(o => (o.part.sourceName && o.part.sourceName !== o.name ? `${o.name} (from ${quoted(o.part.sourceName)})` : o.name)).join(', ')}.`
    }),
    accompanimentKept: outputParts => ({
        level: 'info', code: 'accompaniment-kept',
        text: `Accompaniment kept: ${outputParts.map(o => o.name).join(', ')}.`
    }),
    timing: (seconds, bpm) => ({
        level: 'info', code: 'timing',
        text: `Length ${formatDuration(seconds)}, starting tempo ${Math.round(bpm)} beats per minute.`
    })
};

/**
 * Overall status from a list of messages
 * @param {Array<{level: string}>} messages - Report messages
 * @returns {string} 'rejected', 'warning' or 'ok'
 */
export function overallStatus(messages) {
    if (messages.some(m => m.level === 'reject')) return 'rejected';
    if (messages.some(m => m.level === 'warning')) return 'warning';
    return 'ok';
}
