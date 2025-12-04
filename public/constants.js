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
    MB_PER_INSTRUMENT: 35,       // Estimated MB per decoded instrument (~30-50MB typical)
    MAX_INSTRUMENTS_4GB: 8,      // Max instruments for 4GB device
    MAX_INSTRUMENTS_DEFAULT: 20, // Max instruments for normal devices
};

// Soundfont Mode Settings
export const SOUNDFONT_MODE = {
    STANDARD: 'standard',        // SpessaSynth + GeneralUser GS (~10MB download, ~31MB RAM, good quality) - DEFAULT
    HIGH_QUALITY: 'highQuality', // FluidR3_GM (high quality, high memory - recommended for powerful devices)
};

// Soundfont URLs
export const SOUNDFONT_URLS = {
    full: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM',
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

// General MIDI Instrument Names (Program 0-127)
export const GM_INSTRUMENTS = [
    'acoustic_grand_piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honkytonk_piano',
    'electric_piano_1', 'electric_piano_2', 'harpsichord', 'clavinet',
    'celesta', 'glockenspiel', 'music_box', 'vibraphone',
    'marimba', 'xylophone', 'tubular_bells', 'dulcimer',
    'drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ',
    'reed_organ', 'accordion', 'harmonica', 'tango_accordion',
    'acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_jazz', 'electric_guitar_clean',
    'electric_guitar_muted', 'overdriven_guitar', 'distortion_guitar', 'guitar_harmonics',
    'acoustic_bass', 'electric_bass_finger', 'electric_bass_pick', 'fretless_bass',
    'slap_bass_1', 'slap_bass_2', 'synth_bass_1', 'synth_bass_2',
    'violin', 'viola', 'cello', 'contrabass',
    'tremolo_strings', 'pizzicato_strings', 'orchestral_harp', 'timpani',
    'string_ensemble_1', 'string_ensemble_2', 'synth_strings_1', 'synth_strings_2',
    'choir_aahs', 'voice_oohs', 'synth_choir', 'orchestra_hit',
    'trumpet', 'trombone', 'tuba', 'muted_trumpet',
    'french_horn', 'brass_section', 'synth_brass_1', 'synth_brass_2',
    'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax',
    'oboe', 'english_horn', 'bassoon', 'clarinet',
    'piccolo', 'flute', 'recorder', 'pan_flute',
    'blown_bottle', 'shakuhachi', 'whistle', 'ocarina',
    'lead_1_square', 'lead_2_sawtooth', 'lead_3_calliope', 'lead_4_chiff',
    'lead_5_charang', 'lead_6_voice', 'lead_7_fifths', 'lead_8_bass_lead',
    'pad_1_new_age', 'pad_2_warm', 'pad_3_polysynth', 'pad_4_choir',
    'pad_5_bowed', 'pad_6_metallic', 'pad_7_halo', 'pad_8_sweep',
    'fx_1_rain', 'fx_2_soundtrack', 'fx_3_crystal', 'fx_4_atmosphere',
    'fx_5_brightness', 'fx_6_goblins', 'fx_7_echoes', 'fx_8_scifi',
    'sitar', 'banjo', 'shamisen', 'koto',
    'kalimba', 'bagpipe', 'fiddle', 'shanai',
    'tinkle_bell', 'agogo', 'steel_drums', 'woodblock',
    'taiko_drum', 'melodic_tom', 'synth_drum', 'reverse_cymbal',
    'guitar_fret_noise', 'breath_noise', 'seashore', 'bird_tweet',
    'telephone_ring', 'helicopter', 'applause', 'gunshot'
];
