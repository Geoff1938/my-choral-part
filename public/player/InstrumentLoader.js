/**
 * InstrumentLoader
 * Handles loading, caching, and mapping of MIDI instruments
 */

import { TIMEOUTS, GM_INSTRUMENTS } from '../constants.js';

export class InstrumentLoader {
    /**
     * @param {number} maxCacheSize - Maximum number of instruments to cache
     */
    constructor(maxCacheSize = 15) {
        this.instrumentCache = new Map();
        this.maxCacheSize = maxCacheSize;
    }

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

    /**
     * Load a Soundfont instrument
     * @param {AudioContext} audioContext - Web Audio API context
     * @param {string} instrumentName - Name of instrument to load
     * @param {GainNode} gainNode - Gain node to connect to
     * @returns {Promise<Object>} Loaded instrument
     */
    async loadInstrument(audioContext, instrumentName, gainNode) {
        const loadOptions = {
            soundfont: 'FluidR3_GM',
            destination: gainNode,
            nameToUrl: (name, soundfont, format) => {
                format = format === 'ogg' ? format : 'mp3';
                return `https://gleitz.github.io/midi-js-soundfonts/${soundfont}/${name}-${format}.js`;
            }
        };

        try {
            const instrument = await Soundfont.instrument(audioContext, instrumentName, loadOptions);
            // Add to cache (note: this is for tracking, actual HTTP cache happens in browser)
            this.addToCache(instrumentName, instrument);
            return { instrument, instrumentName, isFallback: false };
        } catch (error) {
            console.error(`Failed to load ${instrumentName}, falling back to piano:`, error);

            // Fallback to piano
            try {
                const instrument = await Soundfont.instrument(audioContext, 'acoustic_grand_piano', loadOptions);
                return { instrument, instrumentName: 'acoustic_grand_piano', isFallback: true };
            } catch (fallbackError) {
                console.error(`Even piano fallback failed:`, fallbackError);
                throw fallbackError;
            }
        }
    }

    /**
     * Add instrument to cache with LRU eviction
     * @param {string} instrumentName - Name of instrument
     * @param {Object} instrument - Soundfont instrument object
     */
    addToCache(instrumentName, instrument) {
        if (this.instrumentCache.size >= this.maxCacheSize) {
            const firstKey = this.instrumentCache.keys().next().value;
            this.instrumentCache.delete(firstKey);
        }
        this.instrumentCache.set(instrumentName, instrument);
    }

    /**
     * Check if instrument is cached
     * @param {string} instrumentName - Name of instrument
     * @returns {boolean} True if cached
     */
    isCached(instrumentName) {
        return this.instrumentCache.has(instrumentName);
    }

    /**
     * Pre-load common instruments in the background
     * @param {AudioContext} audioContext - Web Audio API context
     * @param {Array<string>} commonInstruments - List of instrument names to preload
     * @returns {Promise<void>}
     */
    async preloadCommonInstruments(audioContext, commonInstruments = [
        'acoustic_grand_piano',
        'piccolo',
        'clarinet',
        'french_horn',
        'bassoon'
    ]) {
        // Don't await - let this happen in the background
        (async () => {
            for (const instrumentName of commonInstruments) {
                try {
                    if (this.isCached(instrumentName)) {
                        continue;
                    }

                    // Create silent gain node just for caching
                    const tempGainNode = audioContext.createGain();
                    tempGainNode.connect(audioContext.destination);
                    tempGainNode.gain.value = 0;

                    const loadPromise = Soundfont.instrument(audioContext, instrumentName, {
                        soundfont: 'FluidR3_GM',
                        destination: tempGainNode,
                        nameToUrl: (name, soundfont, format) => {
                            format = format === 'ogg' ? format : 'mp3';
                            return `https://gleitz.github.io/midi-js-soundfonts/${soundfont}/${name}-${format}.js`;
                        }
                    });

                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Preload timeout')), TIMEOUTS.INSTRUMENT_LOAD)
                    );

                    await Promise.race([loadPromise, timeoutPromise]);
                    tempGainNode.disconnect();

                    // Small delay between loads
                    await new Promise(resolve => setTimeout(resolve, 500));

                } catch (error) {
                    console.log(`Pre-load of ${instrumentName} failed, will load on demand:`, error.message);
                }
            }
        })();
    }

    /**
     * Clear the instrument cache
     */
    clearCache() {
        this.instrumentCache.clear();
    }
}
