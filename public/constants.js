/**
 * Application Constants
 * Centralized configuration values used throughout the application
 */

// HTTP Request Timeouts (milliseconds)
export const TIMEOUTS = {
    MIDI_FETCH: 30000,           // 30 seconds for MIDI file download
    INSTRUMENT_LOAD: 10000,      // 10 seconds per instrument
    AUTO_PLAY_DELAY: 500,        // 500ms delay before auto-play
    RETRY_DELAY_BASE: 1000,      // Base delay for retry backoff (1 second)
    INSTRUMENT_PRELOAD_DELAY: 500, // Delay between sequential instrument loads
    REQUEST_DELAY: 500           // Delay between API requests to avoid rate limiting
};

// Audio Configuration
export const AUDIO = {
    // Volume in decibels
    MIN_VOLUME_DB: -60,          // Minimum volume (effectively silent)
    MAX_VOLUME_DB: 10,           // Maximum volume (amplified)
    DEFAULT_VOLUME_DB: -10,      // Default volume
    SILENT_DB: -Infinity,        // Complete silence

    // Volume percentages
    MIN_VOLUME_PERCENT: 0,
    MAX_VOLUME_PERCENT: 200,
    DEFAULT_VOLUME_PERCENT: 100,

    // Tempo/Speed
    MIN_TEMPO: 0.25,             // 25% speed
    MAX_TEMPO: 2.0,              // 200% speed
    DEFAULT_TEMPO: 1.0,          // 100% speed (normal)

    // Seeking
    SEEK_STEP_SECONDS: 10,       // Jump 10 seconds when seeking

    // Silence Detection
    SKIP_SILENCE_THRESHOLD: 0.5  // Skip leading silence if > 0.5 seconds
};

// Device Memory Thresholds (gigabytes)
export const MEMORY = {
    LOW_MEMORY_GB: 4,            // Desktop/laptop with ≤4GB considered low
    MOBILE_LOW_MEMORY_GB: 6,     // Mobile device with ≤6GB considered low
};

// Network & Retry Configuration
export const NETWORK = {
    MAX_RETRIES: 3,              // Maximum retry attempts for failed requests
    RETRY_STATUS_CODES: [502, 504], // HTTP status codes to retry
};

// Recent Works
export const RECENT_WORKS = {
    MAX_COUNT: 5                 // Maximum number of recent works to store
};

// Voice Part Mappings
export const VOICE_PARTS = {
    SOPRANO: 'soprano',
    ALTO: 'alto',
    TENOR: 'tenor',
    BASS: 'bass'
};

// Instrument Mappings (Standard voice part to instrument)
export const VOICE_TO_INSTRUMENT = {
    [VOICE_PARTS.SOPRANO]: 'piccolo',
    [VOICE_PARTS.ALTO]: 'clarinet',
    [VOICE_PARTS.TENOR]: 'french_horn',
    [VOICE_PARTS.BASS]: 'bassoon'
};

// Common instruments to pre-cache (based on MIDI file analysis)
export const CACHED_INSTRUMENTS = [
    'acoustic_grand_piano',  // 890 uses
    'piccolo',               // 3139 uses
    'clarinet',              // 3184 uses
    'bassoon',               // 3347 uses
    'french_horn',           // 3561 uses
    'string_ensemble_1'      // 5666 uses
];

// Base URLs
export const BASE_URL = 'https://www.learnchoralmusic.co.uk';
export const SOUNDFONT_BASE_URL = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';

// UI Update Intervals (milliseconds)
export const UI = {
    PROGRESS_UPDATE_INTERVAL: 100  // Update progress bar every 100ms
};

// Cache Configuration
export const CACHE = {
    VERSION: 'v1',
    NAME_PREFIX: 'choral-practice-soundfonts-'
};
