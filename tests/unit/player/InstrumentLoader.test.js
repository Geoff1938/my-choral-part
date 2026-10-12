/**
 * Unit tests for InstrumentLoader
 */

const { InstrumentLoader, loadSoundfontInstrument } = require('../../../public/player/InstrumentLoader.js');
const { SOUNDFONT_URLS, TIMEOUTS } = require('../../../public/constants.js');

// Let pending promise callbacks run (setImmediate is left real under fake timers below)
const flushPromises = () => new Promise(resolve => setImmediate(resolve));

describe('InstrumentLoader', () => {
    let loader;
    let mockAudioContext;
    let mockGainNode;

    beforeEach(() => {
        loader = new InstrumentLoader();

        // Mock AudioContext and GainNode
        mockGainNode = {
            connect: jest.fn(),
            disconnect: jest.fn(),
            gain: { value: 0 }
        };

        mockAudioContext = {
            createGain: jest.fn(() => mockGainNode),
            destination: {}
        };

        // Mock console methods
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});

        // Mock global Soundfont
        global.Soundfont = {
            instrument: jest.fn()
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('constructor', () => {
        test('initializes with default max cache size of 15', () => {
            expect(loader.maxCacheSize).toBe(15);
        });

        test('initializes with custom max cache size', () => {
            const customLoader = new InstrumentLoader(50);
            expect(customLoader.maxCacheSize).toBe(50);
        });

        test('initializes empty cache', () => {
            expect(loader.instrumentCache.size).toBe(0);
        });
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

        test('returns acoustic_grand_piano for non-integer program numbers', () => {
            expect(loader.midiProgramToInstrument(1.5)).toBe('acoustic_grand_piano');
            expect(loader.midiProgramToInstrument('6')).toBe('acoustic_grand_piano');
        });

        test('maps the last GM program (127)', () => {
            expect(loader.midiProgramToInstrument(127)).toBe('gunshot');
        });
    });

    describe('loadInstrument()', () => {
        test('loads instrument successfully', async () => {
            const mockInstrument = { play: jest.fn() };
            Soundfont.instrument.mockResolvedValue(mockInstrument);

            const result = await loader.loadInstrument(mockAudioContext, 'piano', mockGainNode);

            expect(result).toEqual({
                instrument: mockInstrument,
                instrumentName: 'piano',
                isFallback: false
            });
            expect(Soundfont.instrument).toHaveBeenCalledWith(
                mockAudioContext,
                'piano',
                expect.objectContaining({
                    soundfont: 'FluidR3_GM',
                    destination: mockGainNode
                })
            );
        });

        test('adds loaded instrument to cache', async () => {
            const mockInstrument = { play: jest.fn() };
            Soundfont.instrument.mockResolvedValue(mockInstrument);

            await loader.loadInstrument(mockAudioContext, 'piano', mockGainNode);

            expect(loader.isCached('piano')).toBe(true);
        });

        test('falls back to piano when instrument load fails', async () => {
            const pianoInstrument = { play: jest.fn() };
            Soundfont.instrument
                .mockRejectedValueOnce(new Error('Load failed'))
                .mockRejectedValueOnce(new Error('Load failed'))
                .mockResolvedValueOnce(pianoInstrument);

            const result = await loader.loadInstrument(mockAudioContext, 'invalid_instrument', mockGainNode);

            expect(result).toEqual({
                instrument: pianoInstrument,
                instrumentName: 'acoustic_grand_piano',
                isFallback: true
            });
            expect(console.error).toHaveBeenCalled();
        });

        test('throws error when both instrument and fallback fail', async () => {
            Soundfont.instrument.mockRejectedValue(new Error('Load failed'));

            await expect(
                loader.loadInstrument(mockAudioContext, 'invalid_instrument', mockGainNode)
            ).rejects.toThrow('Load failed');

            expect(console.error).toHaveBeenCalledTimes(2);
        });

        test('uses correct URL generator for mp3 format', async () => {
            const mockInstrument = { play: jest.fn() };
            Soundfont.instrument.mockResolvedValue(mockInstrument);

            await loader.loadInstrument(mockAudioContext, 'piano', mockGainNode);

            const options = Soundfont.instrument.mock.calls[0][2];
            const url = options.nameToUrl('piano', 'FluidR3_GM', 'mp3');
            expect(url).toBe('https://pub-8f69698b476240b0b34d5e8a46b69a65.r2.dev/FluidR3_GM/piano-mp3.js');
        });

        test('uses correct URL generator for ogg format', async () => {
            const mockInstrument = { play: jest.fn() };
            Soundfont.instrument.mockResolvedValue(mockInstrument);

            await loader.loadInstrument(mockAudioContext, 'piano', mockGainNode);

            const options = Soundfont.instrument.mock.calls[0][2];
            const url = options.nameToUrl('piano', 'FluidR3_GM', 'ogg');
            expect(url).toBe('https://pub-8f69698b476240b0b34d5e8a46b69a65.r2.dev/FluidR3_GM/piano-ogg.js');
        });

        test('falls back to the second soundfont host when the first fails', async () => {
            const mockInstrument = { play: jest.fn() };
            Soundfont.instrument
                .mockRejectedValueOnce(new Error('R2 unavailable'))
                .mockResolvedValueOnce(mockInstrument);

            const result = await loader.loadInstrument(mockAudioContext, 'piano', mockGainNode);

            expect(result).toEqual({
                instrument: mockInstrument,
                instrumentName: 'piano',
                isFallback: false
            });
            const options = Soundfont.instrument.mock.calls[1][2];
            const url = options.nameToUrl('piano', 'FluidR3_GM', 'mp3');
            expect(url).toBe('https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/piano-mp3.js');
            expect(console.warn).toHaveBeenCalledTimes(1);
        });
    });

    describe('addToCache()', () => {
        test('adds instrument to cache', () => {
            const mockInstrument = { play: jest.fn() };

            loader.addToCache('piano', mockInstrument);

            expect(loader.instrumentCache.get('piano')).toBe(mockInstrument);
            expect(loader.instrumentCache.size).toBe(1);
        });

        test('evicts oldest entry when cache is full (LRU)', () => {
            const smallLoader = new InstrumentLoader(3);

            smallLoader.addToCache('instrument1', { id: 1 });
            smallLoader.addToCache('instrument2', { id: 2 });
            smallLoader.addToCache('instrument3', { id: 3 });
            smallLoader.addToCache('instrument4', { id: 4 });

            expect(smallLoader.instrumentCache.size).toBe(3);
            expect(smallLoader.instrumentCache.has('instrument1')).toBe(false);
            expect(smallLoader.instrumentCache.has('instrument2')).toBe(true);
            expect(smallLoader.instrumentCache.has('instrument3')).toBe(true);
            expect(smallLoader.instrumentCache.has('instrument4')).toBe(true);
        });

        test('allows duplicate entries (updates existing)', () => {
            loader.addToCache('piano', { version: 1 });
            loader.addToCache('piano', { version: 2 });

            expect(loader.instrumentCache.size).toBe(1);
            expect(loader.instrumentCache.get('piano')).toEqual({ version: 2 });
        });
    });

    describe('isCached()', () => {
        test('returns true for cached instrument', () => {
            loader.addToCache('piano', { play: jest.fn() });

            expect(loader.isCached('piano')).toBe(true);
        });

        test('returns false for non-cached instrument', () => {
            expect(loader.isCached('violin')).toBe(false);
        });

        test('returns false after cache is cleared', () => {
            loader.addToCache('piano', { play: jest.fn() });
            loader.clearCache();

            expect(loader.isCached('piano')).toBe(false);
        });
    });

    describe('clearCache()', () => {
        test('clears all cached instruments', () => {
            loader.addToCache('piano', { id: 1 });
            loader.addToCache('violin', { id: 2 });
            loader.addToCache('flute', { id: 3 });

            loader.clearCache();

            expect(loader.instrumentCache.size).toBe(0);
        });

        test('allows adding instruments after clearing', () => {
            loader.addToCache('piano', { id: 1 });
            loader.clearCache();
            loader.addToCache('violin', { id: 2 });

            expect(loader.instrumentCache.size).toBe(1);
            expect(loader.isCached('violin')).toBe(true);
        });
    });

    describe('loadSoundfontInstrument()', () => {
        test('tries every soundfont host and rethrows the last error', async () => {
            Soundfont.instrument
                .mockRejectedValueOnce(new Error('first'))
                .mockRejectedValueOnce(new Error('second'));

            await expect(
                loadSoundfontInstrument(mockAudioContext, 'piano', {})
            ).rejects.toThrow('second');

            expect(Soundfont.instrument).toHaveBeenCalledTimes(SOUNDFONT_URLS.full.length);
            expect(console.warn).toHaveBeenCalledTimes(SOUNDFONT_URLS.full.length);
        });
    });

    describe('preloadCommonInstruments()', () => {
        beforeEach(() => {
            jest.useFakeTimers({ doNotFake: ['setImmediate'] });
        });

        afterEach(() => {
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        test('skips already cached instruments', async () => {
            Soundfont.instrument.mockResolvedValue({ play: jest.fn() });
            loader.addToCache('acoustic_grand_piano', { cached: true });

            loader.preloadCommonInstruments(mockAudioContext, ['acoustic_grand_piano', 'piccolo']);
            await flushPromises();

            expect(Soundfont.instrument).toHaveBeenCalledTimes(1);
            expect(Soundfont.instrument.mock.calls[0][1]).toBe('piccolo');
        });

        test('handles preload failures gracefully', async () => {
            Soundfont.instrument.mockRejectedValue(new Error('Preload failed'));

            await expect(
                loader.preloadCommonInstruments(mockAudioContext, ['invalid_instrument'])
            ).resolves.toBeUndefined();
            await flushPromises();

            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('Pre-load of invalid_instrument failed'),
                'Preload failed'
            );
        });

        test('gives up on an instrument after the preload timeout', async () => {
            Soundfont.instrument.mockReturnValue(new Promise(() => {}));

            loader.preloadCommonInstruments(mockAudioContext, ['piano']);
            await flushPromises();
            jest.advanceTimersByTime(TIMEOUTS.INSTRUMENT_LOAD);
            await flushPromises();

            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('Pre-load of piano failed'),
                'Preload timeout'
            );
        });

        test('creates silent gain nodes for preloading', async () => {
            Soundfont.instrument.mockResolvedValue({ play: jest.fn() });
            mockGainNode.gain.value = 1;

            loader.preloadCommonInstruments(mockAudioContext, ['piano']);
            await flushPromises();

            expect(mockAudioContext.createGain).toHaveBeenCalledTimes(1);
            expect(mockGainNode.connect).toHaveBeenCalledWith(mockAudioContext.destination);
            expect(mockGainNode.gain.value).toBe(0);
            expect(mockGainNode.disconnect).toHaveBeenCalled();
            expect(Soundfont.instrument).toHaveBeenCalledWith(
                mockAudioContext,
                'piano',
                expect.objectContaining({ destination: mockGainNode })
            );
        });
    });
});
