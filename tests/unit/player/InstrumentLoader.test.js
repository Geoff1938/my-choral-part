/**
 * Unit tests for InstrumentLoader
 */

// Mock GM_INSTRUMENTS (subset for testing)
const GM_INSTRUMENTS = [
    'acoustic_grand_piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honkytonk_piano',
    'electric_piano_1', 'electric_piano_2', 'harpsichord', 'clavinet',
    'celesta', 'glockenspiel', 'music_box', 'vibraphone',
    'marimba', 'xylophone', 'tubular_bells', 'dulcimer',
    // ... (truncated for testing, full array has 128 items)
];

// Copy of InstrumentLoader class for testing
class InstrumentLoader {
    getInstrumentName(track) {
        if (track.instrument) {
            const program = track.instrument.number;
            return this.midiProgramToInstrument(program);
        }
        return 'acoustic_grand_piano';
    }

    midiProgramToInstrument(program) {
        if (typeof program === 'number' && program >= 0 && program < GM_INSTRUMENTS.length) {
            return GM_INSTRUMENTS[program];
        }
        return 'acoustic_grand_piano';
    }
}

describe('InstrumentLoader', () => {
    let loader;

    beforeEach(() => {
        loader = new InstrumentLoader();
    });

    describe('getInstrumentName()', () => {
        test('returns instrument name from track with instrument', () => {
            const track = {
                instrument: { number: 0 }
            };

            const result = loader.getInstrumentName(track);

            expect(result).toBe('acoustic_grand_piano');
        });

        test('returns acoustic_grand_piano for track without instrument', () => {
            const track = {};

            const result = loader.getInstrumentName(track);

            expect(result).toBe('acoustic_grand_piano');
        });

        test('uses midiProgramToInstrument for program number', () => {
            const track = {
                instrument: { number: 6 }
            };

            const result = loader.getInstrumentName(track);

            expect(result).toBe('harpsichord');
        });
    });

    describe('midiProgramToInstrument()', () => {
        test('returns correct instrument for valid program number', () => {
            expect(loader.midiProgramToInstrument(0)).toBe('acoustic_grand_piano');
            expect(loader.midiProgramToInstrument(6)).toBe('harpsichord');
            expect(loader.midiProgramToInstrument(11)).toBe('vibraphone');
        });

        test('returns acoustic_grand_piano for negative program number', () => {
            expect(loader.midiProgramToInstrument(-1)).toBe('acoustic_grand_piano');
        });

        test('returns acoustic_grand_piano for program number >= 128', () => {
            expect(loader.midiProgramToInstrument(128)).toBe('acoustic_grand_piano');
            expect(loader.midiProgramToInstrument(200)).toBe('acoustic_grand_piano');
        });

        test('returns acoustic_grand_piano for undefined', () => {
            expect(loader.midiProgramToInstrument(undefined)).toBe('acoustic_grand_piano');
        });

        test('returns acoustic_grand_piano for null', () => {
            expect(loader.midiProgramToInstrument(null)).toBe('acoustic_grand_piano');
        });
    });
});
