/**
 * InstrumentLoader
 * Maps MIDI tracks and program numbers to General MIDI instrument names
 * (used to identify the voice parts - piccolo = soprano, etc.)
 */

import { GM_INSTRUMENTS } from '../constants.js';

export class InstrumentLoader {
    /**
     * Get instrument name from MIDI track
     * @param {Object} track - MIDI track object
     * @returns {string} Instrument name
     */
    getInstrumentName(track) {
        if (track.instrument) {
            const program = track.instrument.number;
            return this.midiProgramToInstrument(program);
        }
        return 'acoustic_grand_piano';
    }

    /**
     * Map MIDI program number to instrument name
     * @param {number} program - MIDI program number (0-127)
     * @returns {string} Instrument name
     */
    midiProgramToInstrument(program) {
        if (program >= 0 && program < GM_INSTRUMENTS.length) {
            return GM_INSTRUMENTS[program];
        }
        return 'acoustic_grand_piano';
    }
}
