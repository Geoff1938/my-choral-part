/**
 * The practice MIDI recipe, transcribed from the gold-standard rehearsal file
 * (Bach, B minor Mass, Gloria, from learnchoralmusic.co.uk).
 *
 * Program numbers are the 0-based MIDI program byte, as written in the file.
 * Printed General MIDI tables number from 1 (Piccolo appears there as 73).
 */

export const PROGRAM = {
    PICCOLO: 72,
    CLARINET: 71,
    FRENCH_HORN: 60,
    BASSOON: 70
};

// Controller numbers
export const CC = {
    BANK_SELECT: 0,
    VOLUME: 7,
    PAN: 10,
    BANK_SELECT_LSB: 32,
    REVERB: 91,
    CHORUS: 93
};

/**
 * Voice slots in output order. `section` is the player's voice part,
 * `number` the 1-based position within the section. A section with a single
 * part uses the first slot and is named without a number.
 */
export const VOICE_SLOTS = [
    { section: 'soprano', number: 1, program: PROGRAM.PICCOLO, channel: 0, pan: 127 },
    { section: 'soprano', number: 2, program: PROGRAM.PICCOLO, channel: 4, pan: 127 },
    { section: 'alto', number: 1, program: PROGRAM.CLARINET, channel: 5, pan: 84 },
    { section: 'alto', number: 2, program: PROGRAM.CLARINET, channel: 1, pan: 84 },
    { section: 'tenor', number: 1, program: PROGRAM.FRENCH_HORN, channel: 6, pan: 42 },
    { section: 'tenor', number: 2, program: PROGRAM.FRENCH_HORN, channel: 2, pan: 42 },
    { section: 'bass', number: 1, program: PROGRAM.BASSOON, channel: 7, pan: 1 },
    { section: 'bass', number: 2, program: PROGRAM.BASSOON, channel: 3, pan: 1 }
];

export const SECTIONS = ['soprano', 'alto', 'tenor', 'bass'];

export const SECTION_NAMES = {
    soprano: 'Soprano',
    alto: 'Alto',
    tenor: 'Tenor',
    bass: 'Bass'
};

// Parts per section: two is the usual layout (and parts are moved between
// neighbouring sections to keep it, see classify.js); a third is allowed when
// the piece needs it (e.g. Tenor 1, 2 and 3), on a spare channel
export const PREFERRED_PER_SECTION = 2;
export const MAX_PER_SECTION = 3;

// Channels for accompaniment, in order of use. Channel 9 is percussion and is never used.
export const ACCOMPANIMENT_CHANNELS = [8, 10, 11, 12, 13, 14, 15];

// Set at the start of every channel
export const START_VOLUME = 64;
export const REVERB = 127;
export const CHORUS = 127;
export const ACCOMPANIMENT_PAN = 64;

// Velocity used when the source has no dynamics (the reference file's commonest, mf)
export const DEFAULT_VELOCITY = 75;

/**
 * Output track name for a voice part, in the form the player recognises
 * @param {string} section - 'soprano', 'alto', 'tenor' or 'bass'
 * @param {number} number - 1-based position within the section
 * @param {number} sectionSize - Number of parts in the section
 * @returns {string} Track name, e.g. 'Soprano 1' or 'Alto'
 */
export function voiceTrackName(section, number, sectionSize) {
    return sectionSize > 1 ? `${SECTION_NAMES[section]} ${number}` : SECTION_NAMES[section];
}

/**
 * Choose the channel, program and pan for every voice part, and the channels
 * left for accompaniment. First and second parts use the recipe's slots;
 * a third part takes a spare channel - a voice channel the piece doesn't
 * use, or else an accompaniment channel. Accompaniment gets the usual
 * accompaniment channels plus any voice channels left unused.
 * @param {Object<string, Array<Object>>} voices - Voice parts by section, in order (groupVoices)
 * @returns {{slots: Map<Object, {channel: number, program: number, pan: number}>, accompanimentChannels: number[]}}
 */
export function planChannels(voices) {
    const slots = new Map();
    const usedVoiceChannels = new Set();
    const extras = [];
    for (const section of SECTIONS) {
        (voices[section] || []).forEach((part, i) => {
            const slot = voiceSlot(section, i + 1);
            if (slot) {
                slots.set(part, { channel: slot.channel, program: slot.program, pan: slot.pan });
                usedVoiceChannels.add(slot.channel);
            } else {
                extras.push({ part, section });
            }
        });
    }
    const spareVoiceChannels = VOICE_SLOTS.map(slot => slot.channel).filter(c => !usedVoiceChannels.has(c));
    const free = [...spareVoiceChannels, ...ACCOMPANIMENT_CHANNELS];
    for (const { part, section } of extras) {
        const first = voiceSlot(section, 1);
        slots.set(part, { channel: free.shift(), program: first.program, pan: first.pan });
    }
    // Accompaniment: the usual channels first, then unused voice channels
    const accompanimentChannels = [...ACCOMPANIMENT_CHANNELS, ...spareVoiceChannels].filter(c => free.includes(c));
    return { slots, accompanimentChannels };
}

/**
 * Find the recipe slot for a voice part
 * @param {string} section - Voice section
 * @param {number} number - 1-based position within the section
 * @returns {Object|undefined} Slot from VOICE_SLOTS
 */
export function voiceSlot(section, number) {
    return VOICE_SLOTS.find(slot => slot.section === section && slot.number === number);
}
