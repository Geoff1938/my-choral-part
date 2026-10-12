/**
 * Unit tests for InstrumentLoader (General MIDI instrument names)
 */

const { InstrumentLoader } = require('../../../public/player/InstrumentLoader.js');
const { GM_INSTRUMENTS } = require('../../../public/constants.js');

describe('InstrumentLoader', () => {
    let loader;

    beforeEach(() => {
        loader = new InstrumentLoader();
    });

    describe('getInstrumentName()', () => {
        test('returns instrument name from track with instrument', () => {
            expect(loader.getInstrumentName({ instrument: { number: 0 } })).toBe('acoustic_grand_piano');
        });

        test('returns acoustic_grand_piano for track without instrument', () => {
            expect(loader.getInstrumentName({})).toBe('acoustic_grand_piano');
        });

        test('maps the voice-part instruments used by the rehearsal files', () => {
            expect(loader.getInstrumentName({ instrument: { number: 72 } })).toBe('piccolo');
            expect(loader.getInstrumentName({ instrument: { number: 71 } })).toBe('clarinet');
            expect(loader.getInstrumentName({ instrument: { number: 60 } })).toBe('french_horn');
            expect(loader.getInstrumentName({ instrument: { number: 70 } })).toBe('bassoon');
        });
    });

    describe('midiProgramToInstrument()', () => {
        test('returns correct instrument for valid program numbers', () => {
            expect(loader.midiProgramToInstrument(0)).toBe('acoustic_grand_piano');
            expect(loader.midiProgramToInstrument(6)).toBe('harpsichord');
            expect(loader.midiProgramToInstrument(127)).toBe(GM_INSTRUMENTS[127]);
        });

        test('covers all 128 General MIDI programs', () => {
            expect(GM_INSTRUMENTS).toHaveLength(128);
        });

        test('returns acoustic_grand_piano for out-of-range program numbers', () => {
            expect(loader.midiProgramToInstrument(-1)).toBe('acoustic_grand_piano');
            expect(loader.midiProgramToInstrument(128)).toBe('acoustic_grand_piano');
        });

        test('returns acoustic_grand_piano for missing or non-integer program numbers', () => {
            expect(loader.midiProgramToInstrument(undefined)).toBe('acoustic_grand_piano');
            expect(loader.midiProgramToInstrument(null)).toBe('acoustic_grand_piano');
            expect(loader.midiProgramToInstrument(1.5)).toBe('acoustic_grand_piano');
            expect(loader.midiProgramToInstrument('6')).toBe('acoustic_grand_piano');
        });
    });
});
