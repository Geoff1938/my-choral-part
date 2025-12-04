// MIDI Player Application

// Import constants and utilities
import {
    BASE_URL,
    TIMEOUTS,
    AUDIO,
    MEMORY,
    VOICE_TO_INSTRUMENT,
    VOICE_PARTS,
    SOUNDFONT_MODE,
    SOUNDFONT_URLS
} from './constants.js';

import {
    MIDILoadError,
    InstrumentLoadError,
    MemoryError,
    NetworkError,
    CopyrightError,
    TimeoutError,
    PlaybackError
} from './errors.js';

import {
    isMobile,
    hasLimitedMemory,
    checkDeviceCapabilities
} from './utils/deviceDetection.js';

import {
    formatTime,
    volumePercentToDb
} from './utils/formatters.js';

import {
    escapeHtml,
    escapeHtmlAttribute,
    sanitizeDisplayString
} from './utils/validation.js';

// Import helper modules
import { InstrumentLoader } from './player/InstrumentLoader.js';
import { StatusManager } from './ui/StatusManager.js';
import { RecentWorksManager } from './api/RecentWorksManager.js';

class MIDIPlayer {
    constructor() {
        // Base URL for all MIDI files (stored separately to reduce JSON size)
        this.baseUrl = BASE_URL;

        this.midi = null;
        this.instruments = [];
        this.parts = [];
        this.isPlaying = false;
        this.wasPlayingBeforeDrag = false; // Track playing state before dragging progress bar
        this.currentTime = 0;
        this.duration = 0;
        this.originalDuration = 0; // Duration at original tempo
        this.tempoMultiplier = 1;
        this.channelVolumes = {};
        this.progressInterval = null;
        this.masterVolume = 1.0;
        this.balance = 0; // -100 to 100, 0 is equal
        this.voicePart = 'soprano'; // Default voice part
        this.selectedChannelIndex = null; // Specific channel index when multiple exist
        this.loopStart = 0;
        this.loopEnd = 0;
        this.repeatMode = false; // If true, repeat current movement; if false, auto-advance to next

        // Bar/measure tracking
        this.bars = []; // Array of bar positions in seconds
        this.timeSignature = { numerator: 4, denominator: 4 }; // Default 4/4
        this.timeSignatureOverrides = {}; // User overrides for ambiguous time signatures
        this.startingBarOffset = 0; // Offset to add to all bar numbers (e.g., if score starts at bar 262)

        // Instrument cache for reusing loaded Soundfont instruments
        // This significantly speeds up loading when switching between movements
        // We cache the instrument's internal buffers (decoded audio) so we can reuse them
        // without re-decoding when switching movements or works
        this.instrumentCache = new Map(); // Map<instrumentName, { buffers, instrument }>
        this.maxCacheSize = 15; // Keep up to 15 instruments cached (each ~30-50MB decoded)

        // Mapping of voice parts to MIDI instrument names
        this.voicePartInstruments = VOICE_TO_INSTRUMENT;

        // Soundfont mode - check URL parameters for /nofonts or /smallfonts
        this.soundfontMode = this.detectSoundfontMode();

        // Loading progress tracking
        this.loadingProgress = { current: 0, total: 0 };

        this.initializeElements();

        // Initialize helper modules
        this.instrumentLoader = new InstrumentLoader(this.maxCacheSize);
        this.statusManager = new StatusManager(this.loadingStatus);
        this.recentWorksManager = new RecentWorksManager();

        // Show soundfont mode warning if not in normal mode
        this.showSoundfontModeWarning();

        this.loadPreferences();
        this.attachEventListeners();
        this.populateTimeSignatureSettings(); // Initialize time signature section (will show "not loaded" initially)
        this.initializeAudioContext(); // Initialize audio context on first user interaction
        this.checkDeviceCapabilities(); // Check device memory and show warning if limited
        this.loadRecentWorks();
        this.initializeWork(); // Check URL route first, then load default if needed
    }

    async initializeWork() {
        // Check URL route first - if URL specifies a work, use that
        const hasURLRoute = await this.checkURLRoute();

        // Only load default/recent work if URL didn't specify one
        if (!hasURLRoute) {
            this.loadDefaultWork();
        }
    }

    async initializeAudioContext() {
        // Start audio context on first user interaction to comply with browser autoplay policies
        const startAudio = async () => {
            try {
                await Tone.start();
            } catch (error) {
                console.error('Error starting audio context:', error);
            }
            // Remove listeners after first interaction
            document.removeEventListener('click', startAudio);
            document.removeEventListener('keydown', startAudio);
            document.removeEventListener('touchstart', startAudio);
        };

        // Add listeners for first user interaction
        document.addEventListener('click', startAudio);
        document.addEventListener('keydown', startAudio);
        document.addEventListener('touchstart', startAudio);
    }

    checkDeviceCapabilities() {
        // Check device memory and show warning if limited
        // This helps prevent crashes on low-memory devices
        const capabilities = checkDeviceCapabilities();

        // Show warning if device seems limited
        if (capabilities.hasLimitedMemory && this.memoryWarning) {
            this.memoryWarning.style.display = 'block';
            console.warn('Limited device capabilities detected:', capabilities.info);
        } else if (capabilities.info) {
            console.log('Device capabilities:', capabilities.info);
        }

        // Store device info for error handling
        this.deviceInfo = capabilities;
    }

    /**
     * Detect soundfont mode from URL parameters
     * Default is STANDARD (SpessaSynth) for good quality with low memory
     * Use /fullfonts for high-quality soundfonts (high memory)
     * @returns {string} Soundfont mode: 'standard' or 'highQuality'
     */
    detectSoundfontMode() {
        const path = window.location.pathname.toLowerCase();
        const searchParams = new URLSearchParams(window.location.search);

        // Check URL path for high-quality mode
        if (path.includes('/fullfonts') || searchParams.has('fullfonts')) {
            console.log('[Soundfont] Mode: highQuality');
            return SOUNDFONT_MODE.HIGH_QUALITY;
        }

        // Default to standard mode (SpessaSynth + GeneralUser GS)
        console.log('[Soundfont] Mode: standard');
        return SOUNDFONT_MODE.STANDARD;
    }

    /**
     * Show soundfont mode info message
     * Called after statusManager is initialized
     */
    showSoundfontModeWarning() {
        if (this.soundfontMode === SOUNDFONT_MODE.HIGH_QUALITY) {
            this.showStatus('Audio mode: High quality (high memory usage)', 'info');
        }
        // Don't show message for standard mode - it's the default
    }

    /**
     * Get the soundfont URL base for the current mode
     * @returns {string|null} Soundfont URL base, or null if not using traditional soundfonts
     */
    getSoundfontUrl() {
        if (this.soundfontMode === SOUNDFONT_MODE.HIGH_QUALITY) {
            return SOUNDFONT_URLS.full;
        }
        // Standard mode uses SpessaSynth which loads its own soundfont
        return null;
    }

    /**
     * Check if memory is sufficient for loading the required number of instruments
     * @param {number} instrumentCount - Number of instruments to load
     * @returns {{canLoad: boolean, message: string, estimatedMB: number}}
     */
    checkMemoryForInstruments(instrumentCount) {
        const estimatedMB = instrumentCount * MEMORY.MB_PER_INSTRUMENT;
        const deviceMemoryGB = this.deviceInfo?.deviceMemory;

        // If we can't detect device memory, use a conservative limit
        let maxInstruments = MEMORY.MAX_INSTRUMENTS_DEFAULT;

        if (deviceMemoryGB !== undefined) {
            if (deviceMemoryGB <= 4) {
                maxInstruments = MEMORY.MAX_INSTRUMENTS_4GB;
            } else if (deviceMemoryGB <= 6) {
                maxInstruments = 12;
            } else if (deviceMemoryGB <= 8) {
                maxInstruments = 16;
            }
        } else if (this.deviceInfo?.hasLimitedMemory) {
            // Fallback for when deviceMemory API isn't available but we detected limited memory
            maxInstruments = MEMORY.MAX_INSTRUMENTS_4GB;
        }

        const canLoad = instrumentCount <= maxInstruments;

        let message = '';
        if (!canLoad) {
            message = `This movement requires ${instrumentCount} instruments (~${estimatedMB}MB). `;
            if (deviceMemoryGB !== undefined) {
                message += `Your device has ${deviceMemoryGB}GB RAM and can safely handle ${maxInstruments} instruments. `;
            } else {
                message += `Your device can safely handle ${maxInstruments} instruments. `;
            }
            message += 'Loading this movement may crash your browser. Try using /smallfonts or /nofonts in the URL, or select a simpler movement.';
        }

        return { canLoad, message, estimatedMB, maxInstruments, instrumentCount };
    }

    initializeElements() {
        // Tab elements
        this.tabButtons = document.querySelectorAll('.tab-button');
        this.tabContents = document.querySelectorAll('.tab-content');

        // MIDI selection elements
        this.composerSearch = document.getElementById('composer-search');
        this.composerResults = document.getElementById('composer-results');
        this.worksContainer = document.getElementById('works-container');
        this.worksList = document.getElementById('works-list');
        this.movementSelect = document.getElementById('movement-select');
        this.movementLoadingStatus = document.getElementById('movement-loading-status');
        this.loadingStatus = document.getElementById('loading-status');
        this.findMusicStatus = document.getElementById('find-music-status');

        // Search filter checkboxes
        this.searchComposersCheckbox = document.getElementById('search-composers');
        this.searchWorksCheckbox = document.getElementById('search-works');
        this.searchMovementsCheckbox = document.getElementById('search-movements');

        // Play tab elements
        this.currentWorkDisplay = document.getElementById('current-work-display');
        this.recentWorksDropdown = document.getElementById('recent-works-dropdown');
        this.recentWorksSelect = document.getElementById('recent-works-select');
        this.memoryWarning = document.getElementById('memory-warning');

        // Currently selected movement section
        this.movementChannelsSection = document.getElementById('movement-channels-section');
        this.currentMovementName = document.getElementById('current-movement-name');
        this.channelsTbody = document.getElementById('channels-tbody');
        this.channelsNotLoadedMsg = document.getElementById('channels-not-loaded-msg');
        this.channelsListContainer = document.getElementById('channels-list-container');

        // Time signature settings section
        this.timeSignatureSection = document.getElementById('time-signature-section');
        this.tsMovementName = document.getElementById('ts-movement-name');
        this.tsNotLoadedMsg = document.getElementById('ts-not-loaded-msg');
        this.tsSettingsContainer = document.getElementById('ts-settings-container');
        this.timeSigTbody = document.getElementById('time-sig-tbody');
        this.startingBarNumber = document.getElementById('starting-bar-number');
        this.applyStartingBarBtn = document.getElementById('apply-starting-bar-btn');

        // Help modal elements
        this.helpModal = document.getElementById('help-modal');
        this.helpModalTitle = document.getElementById('help-modal-title');
        this.helpModalText = document.getElementById('help-modal-text');
        this.helpModalClose = document.getElementById('help-modal-close');
        this.headerHelpBtn = document.getElementById('header-help-btn');

        // Settings tab elements
        this.voicePartSelect = document.getElementById('voice-part-settings');
        this.shareableUrlSectionSettings = document.getElementById('shareable-url-section-settings');
        this.shareableUrlInputSettings = document.getElementById('shareable-url-settings');
        this.copyUrlBtnSettings = document.getElementById('copy-url-btn-settings');
        this.noWorkSelectedMsg = document.getElementById('no-work-selected-msg');

        // Balance label elements
        this.balanceVoicePartSpan = document.getElementById('balance-voice-part');

        // State for current selection
        this.selectedComposer = null;
        this.selectedWork = null;
        this.searchTimeout = null;

        // Control section
        this.controlsSection = document.getElementById('controls-section');

        // Playback controls
        this.playBtn = document.getElementById('play-btn');
        this.pauseBtn = document.getElementById('pause-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.backwardBtn = document.getElementById('backward-btn');
        this.forwardBtn = document.getElementById('forward-btn');
        this.prevMovementBtn = document.getElementById('prev-movement-btn');
        this.nextMovementBtn = document.getElementById('next-movement-btn');
        this.repeatBtn = document.getElementById('repeat-btn');

        // Progress bar
        this.progressBar = document.getElementById('progress-bar');
        this.progressDuration = document.getElementById('progress-duration');
        this.currentTimeDisplay = document.getElementById('current-time');
        this.currentBarDisplay = document.getElementById('current-bar');
        this.barMarkersContainer = document.getElementById('bar-markers');

        // Loop controls
        this.loopStartMarker = document.getElementById('loop-start-marker');
        this.loopEndMarker = document.getElementById('loop-end-marker');
        this.loopHighlight = document.getElementById('loop-highlight');

        // Tempo controls
        this.tempoSlider = document.getElementById('tempo-slider');
        this.tempoValue = document.getElementById('tempo-value');

        // Volume controls
        this.balanceSlider = document.getElementById('balance-slider');
        this.balanceValue = document.getElementById('balance-value');

        // Master volume controls
        this.masterVolumeSlider = document.getElementById('master-volume-slider');
        this.masterVolumeValue = document.getElementById('master-volume-value');
    }

    loadPreferences() {
        // Load voice part from localStorage
        const savedVoicePart = localStorage.getItem('voicePart');
        if (savedVoicePart && this.voicePartSelect) {
            this.voicePart = savedVoicePart;
            this.voicePartSelect.value = savedVoicePart;
            this.updateBalanceLabel(); // Update balance label to show loaded voice part
        }

        // Load balance from localStorage
        const savedBalance = localStorage.getItem('balance');
        if (savedBalance !== null) {
            this.balance = parseInt(savedBalance);
            if (this.balanceSlider) {
                this.balanceSlider.value = this.balance;
            }
            if (this.balanceValue) {
                this.balanceValue.textContent = this.balance;
            }
        }

        // Load master volume from localStorage (default 80%)
        const savedMasterVolume = localStorage.getItem('masterVolume');
        this.masterVolume = savedMasterVolume !== null ? parseInt(savedMasterVolume) : 80;
        if (this.masterVolumeSlider) {
            this.masterVolumeSlider.value = this.masterVolume;
        }
        if (this.masterVolumeValue) {
            this.masterVolumeValue.textContent = this.masterVolume;
        }
    }

    savePreferences() {
        localStorage.setItem('voicePart', this.voicePart);
        localStorage.setItem('balance', this.balance);
        localStorage.setItem('masterVolume', this.masterVolume);
    }

    updateBalanceLabel() {
        // Update the balance label and dropdown to show voice part with current instrument
        // Format: "Tenor (french horn)" or "Tenor (clarinet)" if overridden
        const voicePartName = this.voicePart.charAt(0).toUpperCase() + this.voicePart.slice(1);
        const instrumentName = this.getCurrentInstrumentForVoicePart();
        const formattedInstrument = instrumentName.replace(/_/g, ' ');
        const displayText = `${voicePartName} (${formattedInstrument})`;

        // Update balance label in Play tab
        if (this.balanceVoicePartSpan) {
            this.balanceVoicePartSpan.textContent = displayText;
        }

        // Update the selected option text in the voice part dropdown in Settings
        if (this.voicePartSelect) {
            const selectedOption = this.voicePartSelect.querySelector(`option[value="${this.voicePart}"]`);
            if (selectedOption) {
                selectedOption.textContent = displayText;
            }
        }
    }

    getTracksWithNotes() {
        // Helper to get tracks with notes (same logic as updateChannelsList)
        if (!this.midi || !this.midi.tracks) return [];
        const tracks = [];
        for (let i = 0; i < this.midi.tracks.length; i++) {
            const track = this.midi.tracks[i];
            if (track.notes && track.notes.length > 0) {
                tracks.push({ track, trackIndex: i });
            }
        }
        return tracks;
    }

    getCurrentInstrumentForVoicePart() {
        // Returns the current instrument for the voice part
        // Either from manual channel override or from default mapping
        if (this.selectedChannelIndex !== null && this.midi) {
            const tracksWithNotes = this.getTracksWithNotes();
            if (this.selectedChannelIndex < tracksWithNotes.length) {
                const { track } = tracksWithNotes[this.selectedChannelIndex];
                return this.getInstrumentName(track);
            }
        }
        // Return default instrument for voice part
        return this.voicePartInstruments[this.voicePart];
    }

    getSelectedChannelInstrumentName() {
        // Returns the instrument name if a manual channel override is in effect
        // (different from default voice part instrument)
        if (this.selectedChannelIndex === null || !this.midi) {
            return null;
        }

        const tracksWithNotes = this.getTracksWithNotes();
        if (this.selectedChannelIndex >= tracksWithNotes.length) {
            return null;
        }

        const { track } = tracksWithNotes[this.selectedChannelIndex];
        const instrumentName = this.getInstrumentName(track);

        // Check if this is different from the default voice part instrument
        const defaultInstrument = this.voicePartInstruments[this.voicePart];
        if (instrumentName !== defaultInstrument) {
            return instrumentName;
        }
        return null;
    }

    normalizeChannelName(name) {
        // Normalize voice part synonyms in channel names
        if (!name) return name;

        // Case-insensitive replacements
        let normalized = name;

        // Treble -> Soprano
        normalized = normalized.replace(/\bTreble\b/gi, 'Soprano');

        // Counter-tenor / Countertenor / Counter tenor -> Alto
        normalized = normalized.replace(/\bCounter[-\s]?tenor\b/gi, 'Alto');

        return normalized;
    }

    getChannelOverrideKey() {
        // Generate a unique key for storing channel override per movement
        // Uses composer + work + movement to create unique key
        if (!this.selectedComposer || !this.selectedWork || !this.currentMovement) {
            return null;
        }
        return `channelOverride_${this.selectedComposer}_${this.selectedWork}_${this.currentMovement}_${this.voicePart}`;
    }

    saveChannelOverride() {
        // Save the current channel selection for this movement
        const key = this.getChannelOverrideKey();
        if (!key) return;

        if (this.selectedChannelIndex !== null) {
            // Store the channel index
            localStorage.setItem(key, this.selectedChannelIndex.toString());
        } else {
            // Remove the override if reset to auto
            localStorage.removeItem(key);
        }
    }

    loadChannelOverride() {
        // Load saved channel override for this movement
        const key = this.getChannelOverrideKey();
        if (!key) return;

        const savedIndex = localStorage.getItem(key);
        if (savedIndex !== null) {
            const index = parseInt(savedIndex);
            // Validate that the saved index is still valid for this MIDI file
            const tracksWithNotes = this.getTracksWithNotes();
            if (index >= 0 && index < tracksWithNotes.length) {
                this.selectedChannelIndex = index;
            }
        }
    }

    addSliderClickToJump(slider) {
        // Allow clicking anywhere on the slider track to jump to that position
        if (!slider) return;

        slider.addEventListener('mousedown', (e) => {
            // Check if click was on the track (not just dragging the thumb)
            const rect = slider.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = (clickX / rect.width) * 100;
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            const value = min + (percentage / 100) * (max - min);

            // Set the value and trigger input event
            slider.value = value;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });

        // Also support touch events for mobile
        slider.addEventListener('touchstart', (e) => {
            const rect = slider.getBoundingClientRect();
            const touch = e.touches[0];
            const clickX = touch.clientX - rect.left;
            const percentage = (clickX / rect.width) * 100;
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            const value = min + (percentage / 100) * (max - min);

            slider.value = value;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    calculateBars() {
        // Calculate bar positions from MIDI data, accounting for time signature and tempo changes
        // Key insight: 8/4 in MIDI often represents 2/2 (Alla Breve) in the score
        if (!this.midi || !this.midi.header) {
            this.bars = [];
            return;
        }

        // Get all time signatures and tempos
        const timeSignatures = this.midi.header.timeSignatures || [];
        const tempos = this.midi.header.tempos || [];

        // Set default time signature if none provided
        if (timeSignatures.length === 0) {
            timeSignatures.push({
                ticks: 0,
                timeSignature: [4, 4],
                measures: 0
            });
        }

        // Set default tempo if none provided
        if (tempos.length === 0) {
            tempos.push({
                ticks: 0,
                bpm: 120
            });
        }

        // Store current time signature for display (check for override on first bar)
        const firstBarOverride = this.timeSignatureOverrides['bar_1'];
        if (firstBarOverride === '2/2') {
            this.timeSignature = {
                numerator: 2,
                denominator: 2
            };
        } else {
            this.timeSignature = {
                numerator: timeSignatures[0].timeSignature[0] || 4,
                denominator: timeSignatures[0].timeSignature[1] || 4
            };
        }

        // Get PPQ (pulses per quarter note) for tick-to-time conversion
        const ppq = this.midi.header.ppq || 480;

        // Convert ticks to seconds for all events
        const timeSignaturesWithTime = timeSignatures.map(ts => ({
            ...ts,
            time: this.ticksToSeconds(ts.ticks, tempos, ppq)
        }));

        const temposWithTime = tempos.map(t => ({
            ...t,
            time: this.ticksToSeconds(t.ticks, tempos, ppq)
        }));

        // Generate bar positions based on time signature CHANGES, not arbitrary MIDI bars
        this.bars = [];
        let barNumber = 1;

        // Process each time signature section
        for (let tsIndex = 0; tsIndex < timeSignaturesWithTime.length; tsIndex++) {
            const currentTS = timeSignaturesWithTime[tsIndex];
            const nextTS = timeSignaturesWithTime[tsIndex + 1];

            const sectionStart = currentTS.time;
            const sectionEnd = nextTS ? nextTS.time : this.originalDuration;

            let numerator = currentTS.timeSignature[0] || 4;
            let denominator = currentTS.timeSignature[1] || 4;

            // Check for user override
            const barNumForOverride = tsIndex === 0 ? 1 : (currentTS.measures || tsIndex);
            const overrideKey = `bar_${barNumForOverride}`;
            const override = this.timeSignatureOverrides[overrideKey];

            // Calculate beats per bar (in quarter notes)
            // For 8/4 time: 8 * (4/4) = 8 quarter notes per bar
            // For 2/2 time (Alla Breve): Should be twice as long as what MIDI indicates
            let beatsPerBar = numerator * (4 / denominator);

            // Track the display time signature (may differ from MIDI if overridden)
            let displayNumerator = numerator;
            let displayDenominator = denominator;

            // Apply override if present
            if (override && override === '2/2') {
                // When overriding to 2/2 (Alla Breve), double the beats per bar
                // This is because 8/4 or 4/4 in MIDI often represents bars that should be
                // combined into longer 2/2 bars in the actual score
                beatsPerBar = beatsPerBar * 2;
                displayNumerator = 2;
                displayDenominator = 2;
            }

            // Determine how many bars to calculate in this section
            // The measures field indicates where the NEXT time signature starts (in bar numbers)
            let maxBarsInSection = Infinity;
            if (nextTS && nextTS.measures !== undefined && nextTS.measures > 0) {
                // nextTS.measures tells us the bar number where it starts
                // So this section should have (nextTS.measures - current barNumber + 1) bars
                maxBarsInSection = nextTS.measures - barNumber + 1;
            }

            // Calculate bars within this time signature section
            let currentTime = sectionStart;
            let currentTempoIndex = 0;
            let barsCreatedInSection = 0;

            // Find the tempo index at the start of this section
            for (let i = 0; i < temposWithTime.length; i++) {
                if (temposWithTime[i].time <= currentTime) {
                    currentTempoIndex = i;
                }
            }

            while (currentTime < sectionEnd &&
                   currentTime <= this.originalDuration &&
                   barsCreatedInSection < maxBarsInSection) {
                // Update tempo if we've crossed a tempo change
                while (currentTempoIndex < temposWithTime.length - 1 &&
                       currentTime >= temposWithTime[currentTempoIndex + 1].time) {
                    currentTempoIndex++;
                }

                const currentTempo = temposWithTime[currentTempoIndex];
                const bpm = currentTempo.bpm;

                // Store bar
                this.bars.push({
                    number: barNumber,
                    time: currentTime,
                    bpm: bpm,
                    timeSignature: `${displayNumerator}/${displayDenominator}`
                });

                // Calculate seconds for this bar
                const secondsPerBeat = 60 / bpm;
                const secondsPerBar = secondsPerBeat * beatsPerBar;

                currentTime += secondsPerBar;
                barNumber++;
                barsCreatedInSection++;
            }
        }

        // Update bar markers on progress bar
        this.updateBarMarkers();
    }

    ticksToSeconds(ticks, tempos, ppq) {
        // Convert MIDI ticks to seconds, accounting for tempo changes
        if (!tempos || tempos.length === 0) {
            // Default: 120 BPM
            return (ticks / ppq) * 0.5; // 60/120 = 0.5 seconds per quarter note
        }

        let time = 0;
        let lastTicks = 0;
        let lastTempo = tempos[0].bpm;

        for (let i = 0; i < tempos.length; i++) {
            const tempo = tempos[i];

            if (tempo.ticks > ticks) {
                // We've passed the target tick
                const tickDelta = ticks - lastTicks;
                const secondsPerBeat = 60 / lastTempo;
                time += (tickDelta / ppq) * secondsPerBeat;
                return time;
            }

            if (i > 0) {
                // Add time for the previous tempo segment
                const tickDelta = tempo.ticks - lastTicks;
                const secondsPerBeat = 60 / lastTempo;
                time += (tickDelta / ppq) * secondsPerBeat;
            }

            lastTicks = tempo.ticks;
            lastTempo = tempo.bpm;
        }

        // Handle remaining ticks after last tempo change
        const tickDelta = ticks - lastTicks;
        const secondsPerBeat = 60 / lastTempo;
        time += (tickDelta / ppq) * secondsPerBeat;

        return time;
    }

    // Load time signature overrides from localStorage
    loadTimeSignatureOverrides() {
        if (!this.selectedComposer || !this.selectedWork || !this.currentMovement) {
            return;
        }

        const key = `ts_override_${this.selectedComposer}_${this.selectedWork}_${this.currentMovement}`;
        const stored = localStorage.getItem(key);

        if (stored) {
            try {
                const data = JSON.parse(stored);
                this.timeSignatureOverrides = data.overrides || {};
                this.startingBarOffset = data.startingBarOffset || 0;
            } catch (e) {
                console.error('Error loading time signature overrides:', e);
                this.timeSignatureOverrides = {};
                this.startingBarOffset = 0;
            }
        } else {
            this.timeSignatureOverrides = {};
            this.startingBarOffset = 0;
        }
    }

    // Save time signature overrides to localStorage
    saveTimeSignatureOverrides() {
        if (!this.selectedComposer || !this.selectedWork || !this.currentMovement) {
            return;
        }

        const key = `ts_override_${this.selectedComposer}_${this.selectedWork}_${this.currentMovement}`;
        const data = {
            overrides: this.timeSignatureOverrides,
            startingBarOffset: this.startingBarOffset
        };

        localStorage.setItem(key, JSON.stringify(data));
    }

    // Send override to server for logging
    async sendOverrideToServer(barNumber, originalSig, overrideSig) {
        if (!this.selectedComposer || !this.selectedWork || !this.currentMovement) {
            return;
        }

        try {
            await fetch('/api/log-signature-override', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    composer: this.selectedComposer,
                    work: this.selectedWork,
                    movement: this.currentMovement,
                    barNumber: barNumber,
                    originalSignature: originalSig,
                    overrideSignature: overrideSig,
                    timestamp: new Date().toISOString()
                })
            });
        } catch (error) {
            console.error('Error sending override to server:', error);
            // Don't show error to user - this is just for logging
        }
    }

    // Populate time signature settings UI
    populateTimeSignatureSettings() {
        if (!this.midi || !this.midi.header) {
            // No MIDI loaded - show "not loaded" message
            if (this.tsNotLoadedMsg) {
                this.tsNotLoadedMsg.style.display = 'block';
            }
            if (this.tsSettingsContainer) {
                this.tsSettingsContainer.style.display = 'none';
            }
            return;
        }

        // Update movement name
        if (this.tsMovementName) {
            this.tsMovementName.textContent = this.currentMovement || '-';
        }

        // Hide "not loaded" message, show settings
        if (this.tsNotLoadedMsg) {
            this.tsNotLoadedMsg.style.display = 'none';
        }
        if (this.tsSettingsContainer) {
            this.tsSettingsContainer.style.display = 'block';
        }

        // Set starting bar number
        if (this.startingBarNumber) {
            this.startingBarNumber.value = this.startingBarOffset + 1;
        }

        // Get time signatures
        const timeSignatures = this.midi.header.timeSignatures || [];
        if (timeSignatures.length === 0) {
            timeSignatures.push({
                ticks: 0,
                timeSignature: [4, 4],
                measures: 0
            });
        }

        // Clear existing rows
        if (this.timeSigTbody) {
            this.timeSigTbody.innerHTML = '';
        }

        // Add rows for each time signature
        timeSignatures.forEach((ts, index) => {
            const numerator = ts.timeSignature[0] || 4;
            const denominator = ts.timeSignature[1] || 4;
            const barNum = index === 0 ? 1 : (ts.measures || index);

            // Determine if this is ambiguous (4/4 could be 2/2, or 8/4 could be 2/2)
            const isAmbiguous = (numerator === 4 && denominator === 4) || (numerator === 8 && denominator === 4);

            const row = document.createElement('tr');

            // Bar number cell
            const barCell = document.createElement('td');
            barCell.textContent = barNum + this.startingBarOffset;
            row.appendChild(barCell);

            // Time signature cell
            const sigCell = document.createElement('td');
            const sigText = `${numerator}/${denominator}`;
            sigCell.textContent = sigText;
            row.appendChild(sigCell);

            // Override cell
            const overrideCell = document.createElement('td');
            if (isAmbiguous) {
                const select = document.createElement('select');
                select.dataset.barIndex = index;
                select.dataset.barNumber = barNum;

                // Options
                const options = [
                    { value: 'default', label: `${numerator}/${denominator} (default)` },
                    { value: '2/2', label: '2/2 (Alla Breve)' }
                ];

                if (numerator === 8 && denominator === 4) {
                    options[0].label = '8/4 (as written)';
                }

                options.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label;
                    select.appendChild(option);
                });

                // Load saved override
                const overrideKey = `bar_${barNum}`;
                if (this.timeSignatureOverrides[overrideKey]) {
                    select.value = this.timeSignatureOverrides[overrideKey];
                }

                // Event listener
                select.addEventListener('change', (e) => {
                    const barNum = parseInt(e.target.dataset.barNumber);
                    const overrideKey = `bar_${barNum}`;
                    const value = e.target.value;
                    const originalSig = sigText;

                    if (value === 'default') {
                        delete this.timeSignatureOverrides[overrideKey];
                    } else {
                        this.timeSignatureOverrides[overrideKey] = value;
                    }

                    this.saveTimeSignatureOverrides();
                    this.sendOverrideToServer(barNum, originalSig, value);

                    // Recalculate bars
                    this.calculateBars();

                    // Update current bar display immediately
                    const currentBar = this.getCurrentBar();
                    if (currentBar && this.currentBarDisplay) {
                        this.currentBarDisplay.textContent = `Bar: ${currentBar}`;
                    }
                });

                overrideCell.appendChild(select);
            } else {
                overrideCell.textContent = '-';
            }
            row.appendChild(overrideCell);

            this.timeSigTbody.appendChild(row);
        });
    }

    showHelpModal(title, text, useHtml = false) {
        if (this.helpModal && this.helpModalTitle && this.helpModalText) {
            this.helpModalTitle.textContent = title || 'Help';
            if (useHtml) {
                this.helpModalText.innerHTML = text || 'No help available';
            } else {
                this.helpModalText.textContent = text || 'No help available';
            }
            this.helpModal.style.display = 'flex';
        }
    }

    hideHelpModal() {
        if (this.helpModal) {
            this.helpModal.style.display = 'none';
        }
    }

    showContextualHelp() {
        // Determine which tab is active
        const activeTab = document.querySelector('.tab-content.active');
        const activeTabId = activeTab ? activeTab.id : '';

        const tooltipHelp = '<strong>Tip:</strong> On desktop, hover over controls for tooltips. On phone/tablet, press and hold.';

        let title = 'Help';
        let content = '';

        if (activeTabId === 'find-music-tab') {
            title = 'Find Music - Help';
            content =
                tooltipHelp + '<br><br>' +
                '<strong>Search for music:</strong><br>' +
                '• Type in the search box to find composers, works, or movements<br>' +
                '• Use the checkboxes to filter what you search for<br>' +
                '• Click on a composer to see their works<br>' +
                '• Click on a work to select it for playback<br><br>' +
                '<strong>Search tips:</strong><br>' +
                '• Search matches the beginning of words (e.g., "bach" finds "Bach" and "Pachelbel")<br>' +
                '• You can search by composer name, work title, or movement name';
        } else if (activeTabId === 'play-music-tab') {
            title = 'Play Music - Help';
            content =
                tooltipHelp + '<br><br>' +
                '<strong>Playback controls:</strong><br>' +
                '• <strong>Stop</strong> - Stop and return to beginning<br>' +
                '• <strong>Play/Pause</strong> - Start or pause playback<br>' +
                '• <strong>Backward/Forward</strong> - Skip 10 seconds<br>' +
                '• <strong>Previous/Next</strong> - Change movement<br>' +
                '• <strong>Repeat</strong> - Loop current movement (highlighted) or auto-advance to next movement<br><br>' +
                '<strong>Progress bar:</strong><br>' +
                '• Drag the slider to jump to any point<br>' +
                '• Drag the triangles to set a loop range for practice<br><br>' +
                '<strong>Tempo &amp; Balance:</strong><br>' +
                '• Slow down the tempo for learning difficult passages<br>' +
                '• Adjust balance to hear your part more or less prominently';
        } else if (activeTabId === 'settings-tab') {
            title = 'Settings - Help';
            content =
                tooltipHelp + '<br><br>' +
                '<strong>Your voice part:</strong><br>' +
                '• Select your voice part (Soprano, Alto, Tenor, Bass)<br>' +
                '• This affects which part is highlighted by the Balance control<br><br>' +
                '<strong>Channel overrides:</strong><br>' +
                '• Some MIDI files may not correctly identify voice parts<br>' +
                '• Use this to manually assign which channel is your part<br><br>' +
                '<strong>Time signatures:</strong><br>' +
                '• Adjust bar numbering if your score starts at a different bar<br>' +
                '• Override time signatures if they are incorrectly detected<br><br>' +
                '<strong>Share:</strong><br>' +
                '• Copy the shareable URL to send to others';
        } else {
            title = 'Help';
            content =
                tooltipHelp + '<br><br>' +
                'Select a tab to see context-specific help.';
        }

        this.showHelpModal(title, content, true);
    }

    attachDoubleClickHelp() {
        // Get all elements with title attributes (these have help text)
        const elementsWithHelp = document.querySelectorAll('[title]');

        elementsWithHelp.forEach(element => {
            // Skip if already has double-click listener
            if (element.dataset.hasDoubleClickHelp) return;
            element.dataset.hasDoubleClickHelp = 'true';

            // For mobile: detect double-tap
            let lastTap = 0;
            element.addEventListener('touchend', (e) => {
                const currentTime = new Date().getTime();
                const tapLength = currentTime - lastTap;

                if (tapLength < 300 && tapLength > 0) {
                    // Double tap detected
                    e.preventDefault();
                    const title = element.getAttribute('aria-label') || element.textContent.trim().substring(0, 30) || 'Control';
                    const helpText = element.getAttribute('title');
                    this.showHelpModal(title, helpText);
                }
                lastTap = currentTime;
            });

            // For desktop: double-click
            element.addEventListener('dblclick', (e) => {
                e.preventDefault();
                const title = element.getAttribute('aria-label') || element.textContent.trim().substring(0, 30) || 'Control';
                const helpText = element.getAttribute('title');
                this.showHelpModal(title, helpText);
            });
        });
    }

    attachLongPressTooltips() {
        // Get all elements with title attributes
        const elementsWithHelp = document.querySelectorAll('[title]');
        let longPressTimer = null;
        let currentTooltip = null;

        const showTooltip = (element, x, y) => {
            // Remove any existing tooltip
            hideTooltip();

            const title = element.getAttribute('title');
            if (!title) return;

            // Create tooltip element
            currentTooltip = document.createElement('div');
            currentTooltip.className = 'touch-tooltip';
            currentTooltip.textContent = title;
            document.body.appendChild(currentTooltip);

            // Position tooltip above the touch point
            const tooltipRect = currentTooltip.getBoundingClientRect();
            let left = x - tooltipRect.width / 2;
            let top = y - tooltipRect.height - 20;

            // Keep within screen bounds
            if (left < 10) left = 10;
            if (left + tooltipRect.width > window.innerWidth - 10) {
                left = window.innerWidth - tooltipRect.width - 10;
            }
            if (top < 10) {
                top = y + 30; // Show below if not enough space above
            }

            currentTooltip.style.left = `${left}px`;
            currentTooltip.style.top = `${top}px`;
        };

        const hideTooltip = () => {
            if (currentTooltip) {
                currentTooltip.remove();
                currentTooltip = null;
            }
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };

        elementsWithHelp.forEach(element => {
            // Skip if already has long-press listener
            if (element.dataset.hasLongPressHelp) return;
            element.dataset.hasLongPressHelp = 'true';

            element.addEventListener('touchstart', (e) => {
                const touch = e.touches[0];
                longPressTimer = setTimeout(() => {
                    showTooltip(element, touch.clientX, touch.clientY);
                }, 500); // 500ms for long press
            }, { passive: true });

            element.addEventListener('touchend', () => {
                hideTooltip();
            });

            element.addEventListener('touchmove', () => {
                hideTooltip();
            });

            element.addEventListener('touchcancel', () => {
                hideTooltip();
            });
        });
    }

    updateBarMarkers() {
        // Clear existing markers
        if (this.barMarkersContainer) {
            this.barMarkersContainer.innerHTML = '';
        }

        if (!this.bars || this.bars.length === 0 || !this.originalDuration) {
            return;
        }

        // Calculate adaptive label interval based on available screen width
        const totalBars = this.bars.length;

        // Get the actual width of the progress bar in pixels
        const progressBarWidth = this.progressBar ? this.progressBar.offsetWidth : 600;

        // Each label needs approximately 35px of space (text + padding)
        const labelWidth = 35;

        // Calculate how many labels we can fit
        const maxLabels = Math.floor(progressBarWidth / labelWidth);

        // Determine label interval (5, 10, 20, or 40) based on how many we can fit
        let labelInterval;
        if (totalBars / 5 <= maxLabels) {
            labelInterval = 5;   // Show every 5th bar
        } else if (totalBars / 10 <= maxLabels) {
            labelInterval = 10;  // Show every 10th bar
        } else if (totalBars / 20 <= maxLabels) {
            labelInterval = 20;  // Show every 20th bar
        } else {
            labelInterval = 40;  // Show every 40th bar
        }

        // Always show lines every 5 bars
        const lineInterval = 5;

        // Add markers for bars
        this.bars.forEach((bar, index) => {
            const percentage = (bar.time / this.originalDuration) * 100;
            const displayBarNumber = bar.number + this.startingBarOffset;
            const isFirstBar = bar.number === 1;
            const isLastBar = index === this.bars.length - 1;

            // Determine if this bar should have a line marker
            const shouldShowLine = isFirstBar || isLastBar || (displayBarNumber % lineInterval === 0);

            if (!shouldShowLine) return; // Skip bars that don't need lines

            const marker = document.createElement('div');
            marker.className = 'bar-marker';

            // Determine if this bar should have a label
            const shouldShowLabel = isFirstBar || isLastBar || (displayBarNumber % labelInterval === 0);

            if (shouldShowLabel) {
                marker.classList.add('major');

                // Add label for major bars
                const label = document.createElement('span');
                label.className = 'bar-marker-label';
                label.textContent = displayBarNumber;
                marker.appendChild(label);
            }

            // Account for slider thumb positioning (24px width)
            // The thumb center is offset from the percentage position
            const thumbWidth = 24;
            const offset = thumbWidth / 2 - (percentage * thumbWidth / 100);

            marker.style.left = `${percentage}%`;
            marker.style.transform = `translate(calc(-50% + ${offset}px), -50%)`;
            this.barMarkersContainer.appendChild(marker);
        });
    }

    getCurrentBar() {
        // Find which bar the current time is in
        if (!this.bars || this.bars.length === 0) {
            return null;
        }

        for (let i = this.bars.length - 1; i >= 0; i--) {
            if (this.currentTime >= this.bars[i].time) {
                // Add the starting bar offset (e.g., if movement starts at bar 262)
                return this.bars[i].number + this.startingBarOffset;
            }
        }

        // Default to bar 1 plus offset
        return 1 + this.startingBarOffset;
    }

    jumpToBar() {
        // Jump to a specific bar number (user enters the bar number as shown, including offset)
        const displayedBarNumber = parseInt(this.barJumpInput.value);

        if (isNaN(displayedBarNumber) || displayedBarNumber < 1) {
            this.showStatus('Please enter a valid bar number', 'error');
            return;
        }

        // Convert displayed bar number to internal bar number (subtract offset)
        const internalBarNumber = displayedBarNumber - this.startingBarOffset;

        // Find the bar
        const bar = this.bars.find(b => b.number === internalBarNumber);

        if (!bar) {
            const maxDisplayedBar = this.bars.length + this.startingBarOffset;
            this.showStatus(`Bar ${displayedBarNumber} not found (max: ${maxDisplayedBar})`, 'error');
            return;
        }

        // Seek to that bar
        this.seekTo(bar.time);
    }

    async loadDefaultWork() {
        // Try to load the most recent work first, otherwise load Mozart - Requiem
        // This provides immediate usability when the app loads
        try {
            // Check if there are recent works in localStorage
            const recentWorks = await this.recentWorksManager.load();

            let composer, work, movements;

            if (recentWorks && recentWorks.length > 0) {
                // Load the most recent work
                const mostRecent = recentWorks[0];
                composer = mostRecent.composer;
                work = mostRecent.work;
                const recentMovement = mostRecent.movement; // Store recent movement if available

                // Fetch movements for this work
                const movementsResponse = await fetch(`/api/composer/${encodeURIComponent(composer)}/work/${encodeURIComponent(work)}/sections`);
                const movementsData = await movementsResponse.json();

                // Validate that we got a valid array of movements
                if (Array.isArray(movementsData) && movementsData.length > 0) {
                    movements = movementsData;

                    // If recent movement is available, find and select it
                    if (recentMovement) {
                        const recentMovementIndex = movements.findIndex(m => m.name === recentMovement);
                        if (recentMovementIndex >= 0) {
                            // We'll set this after populating the dropdown
                            this.recentMovementIndex = recentMovementIndex + 1; // +1 for placeholder option
                        }
                    }
                } else {
                    // API returned invalid data (work may no longer be in index), fall back to Mozart Requiem
                    console.log('[App] Recent work not found in index, loading default work');
                    composer = null; // Force fallback below
                }
            }

            if (!composer) {
                // No recent works - load Mozart - Requiem as default
                composer = 'Mozart';
                work = 'Requiem (Sussmayr completion)';

                // Hardcoded first few movements for Mozart Requiem
                movements = [
                    { name: 'I INTROITUS: REQUIEM', midiUrl: '/Mozart/Requiem/01-intrt.mid' },
                    { name: 'II KYRIE', midiUrl: '/Mozart/Requiem/02-kyrie.mid' },
                    { name: 'III SEQUENZ - No 2 - Dies Irae', midiUrl: '/Mozart/Requiem/02s-dies.mid' },
                    { name: '. . . . . . . . . . . .- No 3 - Tuba Mirum', midiUrl: '/Mozart/Requiem/03-tuba.mid' }
                ];
            }

            // Check if this work is copyright-protected
            if (movements.length > 0) {
                const firstMovementUrl = movements[0].midiUrl;
                if (firstMovementUrl.endsWith('.html') || firstMovementUrl.endsWith('.htm')) {
                    // This work is copyright-protected, fall back to Mozart Requiem
                    composer = 'Mozart';
                    work = 'Requiem (Sussmayr completion)';
                    movements = [
                        { name: 'I INTROITUS: REQUIEM', midiUrl: '/Mozart/Requiem/01-intrt.mid' },
                        { name: 'II KYRIE', midiUrl: '/Mozart/Requiem/02-kyrie.mid' },
                        { name: 'III SEQUENZ - No 2 - Dies Irae', midiUrl: '/Mozart/Requiem/02s-dies.mid' },
                        { name: '. . . . . . . . . . . .- No 3 - Tuba Mirum', midiUrl: '/Mozart/Requiem/03-tuba.mid' }
                    ];
                }
            }

            this.selectedComposer = composer;
            this.selectedWork = work;

            // Populate movement dropdown with all movements
            // Use HTML entity encoding for the JSON value to handle movement names with apostrophes/quotes
            this.movementSelect.innerHTML = '<option value="">Choose a movement...</option>' +
                movements.map(movement => {
                    const jsonValue = JSON.stringify({ name: movement.name, midiUrl: movement.midiUrl });
                    const movementDisplay = escapeHtml(movement.name);
                    return `<option value="${escapeHtmlAttribute(jsonValue)}">${movementDisplay}</option>`;
                }).join('');

            // Auto-select the recent movement or first movement in the dropdown
            if (this.recentMovementIndex && this.recentMovementIndex < this.movementSelect.options.length) {
                this.movementSelect.selectedIndex = this.recentMovementIndex;
            } else {
                this.movementSelect.selectedIndex = 1; // Default to first movement
            }

            this.updateWorkDisplay();

            // Update the currently selected movement display on Settings tab
            if (this.currentMovementName && movements && movements.length > 0) {
                const firstMovementName = movements[0].name;
                // For single-movement works where work name equals movement name, don't repeat it
                if (work === firstMovementName) {
                    this.currentMovementName.textContent = `${composer}, ${work}`;
                } else {
                    this.currentMovementName.textContent = `${composer}, ${work} - ${firstMovementName}`;
                }
            }
            if (this.movementChannelsSection) {
                this.movementChannelsSection.style.display = 'block';
            }

            // Update channels list to show the "Click Play to load..." message
            this.updateChannelsList();

            // Auto-load the first movement to show bars and markers immediately
            const selectedMovementData = JSON.parse(this.movementSelect.value);
            if (selectedMovementData && selectedMovementData.midiUrl) {
                const absoluteUrl = selectedMovementData.midiUrl.startsWith('http')
                    ? selectedMovementData.midiUrl
                    : `https://www.learnchoralmusic.co.uk${selectedMovementData.midiUrl}`;

                await this.loadMIDIFromURL(absoluteUrl, selectedMovementData.name);
            }
        } catch (error) {
            console.error('Error loading default work:', error);
            // Fall back to hardcoded Mozart Requiem if API fails
            this.selectedComposer = 'Mozart';
            this.selectedWork = 'Requiem (Sussmayr completion)';

            const fallbackMovements = [
                { name: 'I INTROITUS: REQUIEM', midiUrl: '/Mozart/Requiem/01-intrt.mid' },
                { name: 'II KYRIE', midiUrl: '/Mozart/Requiem/02-kyrie.mid' },
                { name: 'III SEQUENZ - No 2 - Dies Irae', midiUrl: '/Mozart/Requiem/02s-dies.mid' },
                { name: '. . . . . . . . . . . .- No 3 - Tuba Mirum', midiUrl: '/Mozart/Requiem/03-tuba.mid' }
            ];

            this.movementSelect.innerHTML = '<option value="">Choose a movement...</option>' +
                fallbackMovements.map(movement => {
                    const jsonValue = JSON.stringify({ name: movement.name, midiUrl: movement.midiUrl });
                    const movementDisplay = escapeHtml(movement.name);
                    return `<option value="${escapeHtmlAttribute(jsonValue)}">${movementDisplay}</option>`;
                }).join('');

            this.movementSelect.selectedIndex = 1;
            this.updateWorkDisplay();
        }
    }

    attachEventListeners() {
        // Tab switching
        this.tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabName = button.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Copy URL button (Settings tab)
        this.copyUrlBtnSettings.addEventListener('click', () => this.copyShareableURL());

        // Starting bar number apply button
        if (this.applyStartingBarBtn) {
            this.applyStartingBarBtn.addEventListener('click', () => {
                const value = parseInt(this.startingBarNumber.value) || 1;
                this.startingBarOffset = value - 1; // Convert to 0-based offset
                this.saveTimeSignatureOverrides();
                this.calculateBars();
                this.populateTimeSignatureSettings(); // Refresh display

                // Update current bar display immediately
                const currentBar = this.getCurrentBar();
                if (currentBar && this.currentBarDisplay) {
                    this.currentBarDisplay.textContent = `Bar: ${currentBar}`;
                }
            });
        }

        // Help modal close button
        if (this.helpModalClose) {
            this.helpModalClose.addEventListener('click', () => this.hideHelpModal());
        }

        // Help modal background click
        if (this.helpModal) {
            this.helpModal.addEventListener('click', (e) => {
                if (e.target === this.helpModal) {
                    this.hideHelpModal();
                }
            });
        }

        // Attach double-click/tap help to all elements with title attributes
        this.attachDoubleClickHelp();

        // Attach long-press tooltips for touch devices
        this.attachLongPressTooltips();

        // Header help button
        if (this.headerHelpBtn) {
            this.headerHelpBtn.addEventListener('click', () => {
                this.showContextualHelp();
            });
        }

        // Recent works dropdown
        this.recentWorksSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                try {
                    // Stop any current playback
                    if (this.isPlaying) {
                        this.stop();
                    }

                    const workData = JSON.parse(e.target.value);
                    this.selectComposer(workData.composer).then(() => {
                        this.selectWork(workData.work);
                    });
                } catch (error) {
                    console.error('Error loading recent work:', error);
                }
            }
        });

        // Pause music and clear search box when user clicks in it
        this.composerSearch.addEventListener('focus', (e) => {
            // Pause music if currently playing
            if (this.isPlaying) {
                this.pause();
            }
            // Clear the search box
            e.target.value = '';
            // Clear search results
            this.composerResults.innerHTML = '';
            this.worksList.innerHTML = '';
            this.worksContainer.style.display = 'none';
        });

        // Search input with debounce
        this.composerSearch.addEventListener('input', (e) => {
            // Clear and hide works dropdown when typing
            this.worksList.innerHTML = '';
            this.worksContainer.style.display = 'none';

            // Clear any status messages
            this.findMusicStatus.classList.remove('show');

            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => {
                this.performSearch(e.target.value);
            }, 300);
        });

        // Search filter checkboxes - trigger search when changed
        [this.searchComposersCheckbox, this.searchWorksCheckbox, this.searchMovementsCheckbox].forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const searchTerm = this.composerSearch.value;
                if (searchTerm) {
                    this.performSearch(searchTerm);
                }
            });
        });

        // Movement selection
        this.movementSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                try {
                    const movementData = JSON.parse(e.target.value);
                    // Convert relative URL to absolute
                    const absoluteUrl = this.toAbsoluteUrl(movementData.midiUrl);
                    this.loadMIDIFromURL(absoluteUrl, movementData.name);
                } catch (error) {
                    console.error('Error parsing movement data:', error);
                    this.showStatus('Error loading movement', 'error');
                }
            }
        });

        // Voice part selection
        this.voicePartSelect.addEventListener('change', (e) => {
            this.voicePart = e.target.value;
            this.selectedChannelIndex = null; // Reset channel selection to allow auto-selection
            this.savePreferences();
            this.updateBalanceLabel(); // Update the balance label to show new voice part
            this.updateChannelsList(); // Update the channels list with new selection
            this.applyBalance(); // Reapply balance with new voice part
        });

        this.playBtn.addEventListener('click', () => this.play());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.stopBtn.addEventListener('click', () => this.stop());

        this.backwardBtn.addEventListener('click', () => this.seek(-10));
        this.forwardBtn.addEventListener('click', () => this.seek(10));

        // Add click-to-jump functionality for progress bar, tempo, and balance sliders (NOT loop sliders)
        this.addSliderClickToJump(this.progressBar);
        this.addSliderClickToJump(this.tempoSlider);
        this.addSliderClickToJump(this.balanceSlider);

        // Previous movement button - single click: go to start, double click: previous movement
        let prevMovementClickTimer = null;
        this.prevMovementBtn.addEventListener('click', () => {
            if (prevMovementClickTimer === null) {
                // First click - wait to see if there's a second click
                prevMovementClickTimer = setTimeout(() => {
                    // Single click - go to start of current movement
                    this.seekTo(0);
                    prevMovementClickTimer = null;
                }, 300);
            } else {
                // Double click - go to previous movement
                clearTimeout(prevMovementClickTimer);
                prevMovementClickTimer = null;
                this.skipToPreviousMovement();
            }
        });

        this.nextMovementBtn.addEventListener('click', () => this.skipToNextMovement());

        // Repeat button toggle
        this.repeatBtn.addEventListener('click', () => {
            this.repeatMode = !this.repeatMode;
            this.repeatBtn.classList.toggle('active', this.repeatMode);
            this.repeatBtn.title = this.repeatMode
                ? 'Repeat current movement (on)'
                : 'Repeat current movement (off: auto-advance to next movement)';
        });

        // Progress bar with pause/resume on interaction
        let isSeeking = false;

        // Use capture phase to intercept events BEFORE the input event fires
        this.progressBar.addEventListener('mousedown', () => {
            // Capture playing state IMMEDIATELY before any other events can modify it
            this.wasPlayingBeforeDrag = this.isPlaying;
            isSeeking = true;
            console.log('Mousedown on progress bar (capture) - wasPlaying:', this.wasPlayingBeforeDrag);
        }, { capture: true });

        this.progressBar.addEventListener('touchstart', () => {
            // Capture playing state IMMEDIATELY before any other events can modify it
            this.wasPlayingBeforeDrag = this.isPlaying;
            isSeeking = true;
        }, { capture: true });

        this.progressBar.addEventListener('input', (e) => {
            let newTime = (e.target.value / 100) * this.originalDuration;

            // Constrain to loop range - if outside, jump to nearest loop marker
            if (newTime < this.loopStart) {
                newTime = this.loopStart;
            } else if (newTime > this.loopEnd) {
                newTime = this.loopEnd;
            }

            // Update position without triggering auto-resume
            this.seekTo(newTime, false);
        });

        const resumeAfterSeek = () => {
            console.log('resumeAfterSeek called - isSeeking:', isSeeking, 'wasPlaying:', this.wasPlayingBeforeDrag);
            if (isSeeking && this.wasPlayingBeforeDrag) {
                console.log('Resuming playback...');
                setTimeout(() => this.play(), 50);
            }
            isSeeking = false;
            this.wasPlayingBeforeDrag = false;
        };

        this.progressBar.addEventListener('mouseup', resumeAfterSeek);
        this.progressBar.addEventListener('touchend', resumeAfterSeek);
        this.progressBar.addEventListener('touchcancel', resumeAfterSeek);

        // Also resume on change event (for clicks/releases on the slider)
        this.progressBar.addEventListener('change', resumeAfterSeek);

        // Catch mouseup anywhere on the document (in case user releases outside slider)
        document.addEventListener('mouseup', (e) => {
            if (isSeeking) {
                resumeAfterSeek();
            }
        });
        document.addEventListener('touchend', (e) => {
            if (isSeeking) {
                resumeAfterSeek();
            }
        });

        // Loop marker drag functionality
        this.initializeLoopMarkerDrag(this.loopStartMarker, true);
        this.initializeLoopMarkerDrag(this.loopEndMarker, false);

        this.tempoSlider.addEventListener('input', (e) => {
            this.setTempo(parseInt(e.target.value));
        });

        // Click-to-jump for tempo slider (snaps to step of 5)
        this.tempoSlider.addEventListener('click', (e) => {
            const rect = e.target.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const min = parseInt(e.target.min);
            const max = parseInt(e.target.max);
            const step = parseInt(e.target.step) || 5;
            const rawValue = min + percent * (max - min);
            const value = Math.round(rawValue / step) * step;
            e.target.value = value;
            this.setTempo(value);
        });

        // Balance control
        this.balanceSlider.addEventListener('input', (e) => {
            this.balance = parseInt(e.target.value);
            this.balanceValue.textContent = e.target.value;
            this.applyBalance();
            this.savePreferences(); // Save balance whenever it changes
        });

        // Click-to-jump for balance slider (snaps to step of 5)
        this.balanceSlider.addEventListener('click', (e) => {
            const rect = e.target.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const min = parseInt(e.target.min);
            const max = parseInt(e.target.max);
            const step = parseInt(e.target.step) || 5;
            const rawValue = min + percent * (max - min);
            const value = Math.round(rawValue / step) * step;
            e.target.value = value;
            this.balance = value;
            this.balanceValue.textContent = value;
            this.applyBalance();
            this.savePreferences();
        });

        // Master volume control
        this.masterVolumeSlider.addEventListener('input', (e) => {
            this.masterVolume = parseInt(e.target.value);
            this.masterVolumeValue.textContent = this.masterVolume;
            this.applyMasterVolume();
            this.savePreferences();
        });

        // Click-to-jump for master volume slider (snaps to step of 5)
        this.masterVolumeSlider.addEventListener('click', (e) => {
            const rect = e.target.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const min = parseInt(e.target.min);
            const max = parseInt(e.target.max);
            const step = parseInt(e.target.step) || 5;
            const rawValue = min + percent * (max - min);
            const value = Math.round(rawValue / step) * step;
            e.target.value = value;
            this.masterVolume = value;
            this.masterVolumeValue.textContent = value;
            this.applyMasterVolume();
            this.savePreferences();
        });

        // Add spacebar toggle for play/pause (only when Play Music tab is active)
        document.addEventListener('keydown', (e) => {
            // Only trigger if not typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                return;
            }

            // Only trigger if Play Music tab is active
            const activeTab = document.querySelector('.tab-content.active');
            if (!activeTab || activeTab.id !== 'play-music-tab') {
                return;
            }

            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault(); // Prevent page scroll
                if (this.isPlaying) {
                    this.pause();
                } else {
                    this.play();
                }
            }
        });

        // Hidden Alt+M keystroke to toggle memory usage display
        this.memoryDisplayVisible = false;
        document.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'm' || e.key === 'M')) {
                e.preventDefault();
                this.toggleMemoryDisplay();
            }
        });

    }

    /**
     * Toggle display of memory usage information (hidden feature, Alt+M)
     */
    toggleMemoryDisplay() {
        this.memoryDisplayVisible = !this.memoryDisplayVisible;

        if (this.memoryDisplayVisible) {
            this.showMemoryInfo();
        } else {
            this.statusManager.hide();
        }
    }

    /**
     * Show memory usage information in the status area
     */
    showMemoryInfo() {
        const info = [];

        // Device memory (if available)
        if (navigator.deviceMemory) {
            info.push(`Device RAM: ${navigator.deviceMemory}GB`);
        } else {
            info.push('Device RAM: unknown');
        }

        // JS heap memory (Chrome only, non-standard)
        if (window.performance && window.performance.memory) {
            const mem = window.performance.memory;
            const usedMB = Math.round(mem.usedJSHeapSize / 1024 / 1024);
            const limitGB = Math.round(mem.jsHeapSizeLimit / 1024 / 1024 / 1024);
            info.push(`JS Heap: ${usedMB}MB (limit ${limitGB}GB)`);
        }

        // Audio buffer info based on soundfont mode
        const cachedCount = this.instrumentCache.size;
        let audioInfo = '';

        if (this.soundfontMode === SOUNDFONT_MODE.HIGH_QUALITY) {
            // Full fonts (~35MB per instrument)
            const estimatedMB = cachedCount * MEMORY.MB_PER_INSTRUMENT;
            audioInfo = `${cachedCount} instruments, highQuality (~${estimatedMB}MB)`;
        } else {
            // Standard mode (SpessaSynth) - ~31MB total
            audioInfo = `${this.instruments.length} tracks, standard (~31MB)`;
        }

        info.push(`Audio buffers: ${audioInfo}`);

        this.showStatus(info.join(' | '), 'info');

        // Log detailed diagnostics to console
        this.logDetailedMemoryDiagnostics();
    }

    /**
     * Log detailed memory diagnostics to console for debugging
     */
    logDetailedMemoryDiagnostics() {
        console.group('[Memory Diagnostics]');

        // Soundfont mode
        console.log('Soundfont mode:', this.soundfontMode);

        // MIDI data size
        if (this.midi) {
            const midiStr = JSON.stringify(this.midi);
            console.log('MIDI object size:', Math.round(midiStr.length / 1024), 'KB (JSON serialized)');
            console.log('MIDI tracks:', this.midi.tracks.length);

            let totalNotes = 0;
            this.midi.tracks.forEach((track, i) => {
                if (track.notes.length > 0) {
                    console.log(`  Track ${i}: ${track.notes.length} notes`);
                    totalNotes += track.notes.length;
                }
            });
            console.log('Total notes:', totalNotes);
        }

        // Tone.Parts size
        console.log('Tone.Parts count:', this.parts.length);
        if (this.parts.length > 0) {
            let totalEvents = 0;
            this.parts.forEach((part, i) => {
                // Tone.Part stores events internally
                const eventCount = part._events ? part._events.length : 'unknown';
                console.log(`  Part ${i}: ${eventCount} events`);
                if (typeof eventCount === 'number') totalEvents += eventCount;
            });
            console.log('Total Part events:', totalEvents);
        }

        // Instruments
        console.log('Instruments count:', this.instruments.length);
        console.log('Instrument cache size:', this.instrumentCache.size);

        // SpessaSynth info (if in standard mode)
        if (this.soundfontMode === SOUNDFONT_MODE.STANDARD) {
            console.log('SpessaSynth tracks loaded:', this.instruments.length);
        }

        // Check what global objects exist
        console.log('Global objects check:');
        console.log('  Tone loaded:', typeof Tone !== 'undefined');
        console.log('  Soundfont loaded:', typeof Soundfont !== 'undefined');
        console.log('  Midi loaded:', typeof Midi !== 'undefined');

        // Audio context state
        if (Tone && Tone.context) {
            console.log('Audio context state:', Tone.context.state);
            console.log('Audio context sample rate:', Tone.context.sampleRate);
        }

        console.groupEnd();
    }

    updateLoopDisplay() {
        // Update the visual highlight
        const startPercent = (this.loopStart / this.originalDuration) * 100;
        const endPercent = (this.loopEnd / this.originalDuration) * 100;
        const width = endPercent - startPercent;

        this.loopHighlight.style.left = `${startPercent}%`;
        this.loopHighlight.style.width = `${width}%`;

        // Update marker positions and labels
        if (this.loopStartMarker && this.loopEndMarker) {
            // Account for slider thumb width (24px)
            // At 0%, thumb center is at 12px. At 100%, thumb center is at calc(100% - 12px)
            // Offset = 12px - (percentage * 24px / 100)
            const thumbWidth = 24;
            const startOffset = thumbWidth / 2 - (startPercent * thumbWidth / 100);
            const endOffset = thumbWidth / 2 - (endPercent * thumbWidth / 100);

            this.loopStartMarker.style.left = `${startPercent}%`;
            this.loopStartMarker.style.transform = `translateX(calc(-50% + ${startOffset}px))`;

            this.loopEndMarker.style.left = `${endPercent}%`;
            this.loopEndMarker.style.transform = `translateX(calc(-50% + ${endOffset}px))`;

            // Make markers visible
            this.loopStartMarker.style.display = 'block';
            this.loopEndMarker.style.display = 'block';

            // Update bar number labels
            const startBar = this.getBarAtTime(this.loopStart);
            const endBar = this.getBarAtTime(this.loopEnd);

            const startLabel = this.loopStartMarker.querySelector('.loop-marker-label');
            const endLabel = this.loopEndMarker.querySelector('.loop-marker-label');

            if (startLabel) startLabel.textContent = `Bar: ${startBar}`;
            if (endLabel) endLabel.textContent = `Bar: ${endBar}`;
        }
    }

    getBarAtTime(time) {
        // Find which bar corresponds to a given time
        if (!this.bars || this.bars.length === 0) {
            return 1;
        }

        for (let i = this.bars.length - 1; i >= 0; i--) {
            if (time >= this.bars[i].time) {
                return this.bars[i].number + this.startingBarOffset;
            }
        }

        return 1 + this.startingBarOffset;
    }

    // Snap a time to the start of the nearest bar (for loop start marker)
    snapToBarStart(time) {
        if (!this.bars || this.bars.length === 0) {
            return time;
        }

        // Find the bar that contains this time, then return its start time
        for (let i = this.bars.length - 1; i >= 0; i--) {
            if (time >= this.bars[i].time) {
                // Check if we're closer to this bar's start or the next bar's start
                const currentBarStart = this.bars[i].time;
                const nextBarStart = (i < this.bars.length - 1) ? this.bars[i + 1].time : this.originalDuration;
                const midpoint = (currentBarStart + nextBarStart) / 2;

                // Snap to whichever bar start is closer
                if (time < midpoint) {
                    return currentBarStart;
                } else {
                    return nextBarStart;
                }
            }
        }

        return 0; // Default to beginning
    }

    // Snap a time to the end of the nearest bar (for loop end marker)
    snapToBarEnd(time) {
        if (!this.bars || this.bars.length === 0) {
            return time;
        }

        // Find the bar that contains this time, then return the end of that bar
        // (which is the start of the next bar, or originalDuration if last bar)
        for (let i = this.bars.length - 1; i >= 0; i--) {
            if (time >= this.bars[i].time) {
                const currentBarStart = this.bars[i].time;
                const currentBarEnd = (i < this.bars.length - 1) ? this.bars[i + 1].time : this.originalDuration;
                const prevBarEnd = currentBarStart; // End of previous bar = start of current

                // Check if we're closer to the end of the previous bar or end of current bar
                const midpoint = (currentBarStart + currentBarEnd) / 2;

                if (time < midpoint) {
                    // Closer to end of previous bar (which is start of current bar)
                    return currentBarStart;
                } else {
                    // Closer to end of current bar
                    return currentBarEnd;
                }
            }
        }

        return this.originalDuration; // Default to end
    }

    initializeLoopMarkerDrag(marker, isStart) {
        if (!marker) return;

        let isDragging = false;
        let progressBarRect = null;

        const updateLoopFromPosition = (clientX) => {
            if (!progressBarRect || !this.originalDuration) return;

            // Calculate percentage based on mouse position
            const relativeX = clientX - progressBarRect.left;
            const percent = Math.max(0, Math.min(100, (relativeX / progressBarRect.width) * 100));
            let time = (percent / 100) * this.originalDuration;

            // Snap to bar boundaries
            if (this.bars && this.bars.length > 0) {
                if (isStart) {
                    // Snap start marker to beginning of nearest bar
                    time = this.snapToBarStart(time);
                } else {
                    // Snap end marker to end of nearest bar (start of next bar)
                    time = this.snapToBarEnd(time);
                }
            }

            if (isStart) {
                // Don't let start go past end
                this.loopStart = Math.min(time, this.loopEnd);
                // If moved ahead of current time, jump to it
                if (this.loopStart > this.currentTime) {
                    this.seekTo(this.loopStart);
                }
            } else {
                // Don't let end go before start
                this.loopEnd = Math.max(time, this.loopStart);
                // If moved before current time, jump back to loop start
                if (this.loopEnd < this.currentTime) {
                    this.seekTo(this.loopStart);
                }
            }

            this.updateLoopDisplay();
        };

        let wasPlayingBeforeMarkerDrag = false;

        const startDrag = (e) => {
            isDragging = true;
            // Capture playing state and pause if needed
            wasPlayingBeforeMarkerDrag = this.isPlaying;
            if (this.isPlaying) {
                this.pause();
            }
            marker.classList.add('dragging');
            progressBarRect = this.progressBar.getBoundingClientRect();
            e.preventDefault();
        };

        const drag = (e) => {
            if (!isDragging) return;
            const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            updateLoopFromPosition(clientX);
        };

        const endDrag = () => {
            if (isDragging) {
                isDragging = false;
                marker.classList.remove('dragging');
                // Resume playback if it was playing before
                if (wasPlayingBeforeMarkerDrag) {
                    setTimeout(() => this.play(), 50);
                }
                wasPlayingBeforeMarkerDrag = false;
            }
        };

        // Mouse events
        marker.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', endDrag);

        // Touch events
        marker.addEventListener('touchstart', startDrag);
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('touchend', endDrag);
        document.addEventListener('touchcancel', endDrag);
    }

    updateChannelsList() {
        // Show/populate the channels list section
        // Check if MIDI is loaded (not just instruments, as orchestral pieces may have no voice parts)
        const tracksWithNotes = this.getTracksWithNotes();

        if (tracksWithNotes.length === 0) {
            // No tracks with notes - show message
            if (this.channelsNotLoadedMsg) {
                this.channelsNotLoadedMsg.style.display = 'block';
            }
            if (this.channelsListContainer) {
                this.channelsListContainer.style.display = 'none';
            }
            return;
        }

        // MIDI file loaded - hide message, show channels table
        if (this.channelsNotLoadedMsg) {
            this.channelsNotLoadedMsg.style.display = 'none';
        }
        if (this.channelsListContainer) {
            this.channelsListContainer.style.display = 'block';
        }

        this.movementChannelsSection.style.display = 'block';

        // Find the channel that matches the selected voice part instrument (for auto-selection)
        const selectedInstrument = this.voicePartInstruments[this.voicePart];
        let autoSelectedIndex = null;

        // Build the channels table from tracks with notes
        let html = '';
        for (let i = 0; i < tracksWithNotes.length; i++) {
            const { track, trackIndex } = tracksWithNotes[i];
            const instrumentName = this.getInstrumentName(track);
            const rawChannelName = track.name || `Channel ${trackIndex + 1}`;
            const channelName = this.normalizeChannelName(rawChannelName);

            // Check if this channel matches the voice part instrument
            const isMatching = (instrumentName === selectedInstrument);
            if (isMatching && autoSelectedIndex === null) {
                autoSelectedIndex = i;
            }

            // Determine if this channel should be checked
            const isChecked = (this.selectedChannelIndex !== null ? this.selectedChannelIndex === i : isMatching);

            // Escape channel name and instrument for safe HTML display
            const channelNameDisplay = escapeHtml(channelName);
            const instrumentDisplay = escapeHtml(instrumentName.replace(/_/g, ' '));

            html += `
                <tr>
                    <td style="text-align: center;">
                        <input type="radio" name="channel-selection" value="${i}" ${isChecked ? 'checked' : ''} />
                    </td>
                    <td>${channelNameDisplay}</td>
                    <td>${instrumentDisplay}</td>
                </tr>
            `;
        }

        this.channelsTbody.innerHTML = html;

        // If no manual selection has been made, use auto-selected channel
        if (this.selectedChannelIndex === null && autoSelectedIndex !== null) {
            this.selectedChannelIndex = autoSelectedIndex;
        }

        // Add event listeners to radio buttons
        const radioButtons = this.channelsTbody.querySelectorAll('input[type="radio"]');
        radioButtons.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.selectedChannelIndex = parseInt(e.target.value);
                this.saveChannelOverride(); // Save override for this movement
                this.updateBalanceLabel(); // Update label to show instrument
                this.applyBalance(); // Reapply balance with new selection
            });
        });
    }

    switchTab(tabName) {
        // Update tab buttons
        this.tabButtons.forEach(button => {
            if (button.dataset.tab === tabName) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });

        // Update tab content
        this.tabContents.forEach(content => {
            if (content.id === `${tabName}-tab`) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });
    }

    async checkURLRoute() {
        // Check if URL contains composer/work path (e.g., /handel/nabal)
        // Returns true if URL specified a work, false otherwise
        const path = window.location.pathname;
        if (path && path !== '/') {
            const parts = path.split('/').filter(p => p);
            if (parts.length >= 2) {
                const composerSlug = decodeURIComponent(parts[0]);
                const workSlug = decodeURIComponent(parts[1]);

                try {
                    // Resolve slugs to actual names
                    const response = await fetch(`/api/resolve/${encodeURIComponent(composerSlug)}/${encodeURIComponent(workSlug)}`);
                    if (response.ok) {
                        const { composer, work } = await response.json();
                        // Load using the actual names
                        await this.selectComposer(composer);
                        await this.selectWork(work);
                        return true; // URL route was found and loaded
                    } else {
                        console.error('Could not resolve URL to composer/work');
                        this.showStatus('Could not find the requested work', 'error');
                    }
                } catch (error) {
                    console.error('Error resolving URL route:', error);
                }
            }
        }
        return false; // No URL route found
    }

    updateWorkDisplay() {
        if (this.selectedComposer && this.selectedWork) {
            this.currentWorkDisplay.textContent = `${this.selectedComposer}, ${this.selectedWork}`;
            this.updateShareableURL();
        } else {
            this.currentWorkDisplay.textContent = 'No work selected';
            this.shareableUrlSection.style.display = 'none';
        }
    }

    updateShareableURL() {
        if (this.selectedComposer && this.selectedWork) {
            const composerSlug = this.selectedComposer.toLowerCase().replace(/\s+/g, '-');
            const workSlug = this.selectedWork.toLowerCase().replace(/\s+/g, '-');
            const url = `${window.location.origin}/${composerSlug}/${workSlug}`;

            // Update Settings tab shareable URL
            this.shareableUrlInputSettings.value = url;
            this.shareableUrlSectionSettings.style.display = 'block';
            this.noWorkSelectedMsg.style.display = 'none';
        } else {
            // Hide shareable URL section if no work selected
            this.shareableUrlSectionSettings.style.display = 'none';
            this.noWorkSelectedMsg.style.display = 'block';
        }
    }

    async copyShareableURL() {
        try {
            await navigator.clipboard.writeText(this.shareableUrlInputSettings.value);
            const originalText = this.copyUrlBtnSettings.textContent;
            this.copyUrlBtnSettings.textContent = '✓ Copied!';
            setTimeout(() => {
                this.copyUrlBtnSettings.textContent = originalText;
            }, 2000);
        } catch (error) {
            console.error('Failed to copy URL:', error);
            this.showStatus('Failed to copy URL', 'error');
        }
    }

    async performSearch(searchTerm) {
        if (!searchTerm || searchTerm.length < 2) {
            this.composerResults.innerHTML = '';
            this.composerResults.style.display = 'none';
            return;
        }

        try {
            const searchComposers = this.searchComposersCheckbox.checked;
            const searchWorks = this.searchWorksCheckbox.checked;
            const searchMovements = this.searchMovementsCheckbox.checked;

            const params = new URLSearchParams({
                q: searchTerm,
                composers: searchComposers,
                works: searchWorks,
                movements: searchMovements
            });

            const response = await fetch(`/api/search?${params}`);
            const results = await response.json();

            this.displaySearchResults(results);
        } catch (error) {
            console.error('Error performing search:', error);
            this.showStatus('Error performing search', 'error');
        }
    }

    displaySearchResults(results) {
        const hasResults = results.composers.length > 0 ||
                          results.works.length > 0 ||
                          results.movements.length > 0;

        if (!hasResults) {
            this.composerResults.innerHTML = '<div class="no-results">No results found</div>';
            this.composerResults.style.display = 'block';
            return;
        }

        let html = '';

        // Display composer results (sorted alphabetically)
        if (results.composers.length > 0) {
            html += '<div class="result-category"><strong>Composers:</strong></div>';
            const sortedComposers = results.composers.sort((a, b) => a.name.localeCompare(b.name));
            sortedComposers.forEach(composer => {
                const composerJson = escapeHtmlAttribute(JSON.stringify(composer.name));
                const composerDisplay = escapeHtml(composer.name);
                html += `<div class="composer-item" data-type="composer" data-composer="${composerJson}" title="Click to see works by ${composerDisplay}">${composerDisplay}</div>`;
            });
        }

        // Display work results (sorted alphabetically by work name)
        if (results.works.length > 0) {
            html += '<div class="result-category"><strong>Works:</strong></div>';
            const sortedWorks = results.works.sort((a, b) => a.work.localeCompare(b.work));
            sortedWorks.forEach(work => {
                // Escape JSON for HTML attributes and display text
                const composerJson = escapeHtmlAttribute(JSON.stringify(work.composer));
                const workJson = escapeHtmlAttribute(JSON.stringify(work.work));
                const workDisplay = escapeHtml(work.work);
                const composerDisplay = escapeHtml(work.composer);
                html += `<div class="work-item result-item" data-type="work" data-composer="${composerJson}" data-work="${workJson}" title="Click to play ${workDisplay} by ${composerDisplay}">
                    <div class="result-main">${workDisplay}</div>
                    <div class="result-sub">${composerDisplay}</div>
                </div>`;
            });
        }

        // Display movement results (sorted alphabetically by movement name)
        if (results.movements.length > 0) {
            html += '<div class="result-category"><strong>Movements/songs:</strong></div>';
            const sortedMovements = results.movements.sort((a, b) => a.movement.localeCompare(b.movement));
            sortedMovements.forEach(movement => {
                // Escape JSON for HTML attributes and display text
                const composerJson = escapeHtmlAttribute(JSON.stringify(movement.composer));
                const workJson = escapeHtmlAttribute(JSON.stringify(movement.work));
                const movementJson = escapeHtmlAttribute(JSON.stringify(movement.movement));
                const midiUrlJson = escapeHtmlAttribute(JSON.stringify(movement.midiUrl));
                const movementDisplay = escapeHtml(movement.movement);
                const composerDisplay = escapeHtml(movement.composer);
                const workDisplay = escapeHtml(movement.work);
                html += `<div class="movement-item result-item" data-type="movement"
                    data-composer="${composerJson}"
                    data-work="${workJson}"
                    data-movement="${movementJson}"
                    data-midi-url="${midiUrlJson}"
                    title="Click to play ${movementDisplay}">
                    <div class="result-main">${movementDisplay}</div>
                    <div class="result-sub">${composerDisplay}, ${workDisplay}</div>
                </div>`;
            });
        }

        this.composerResults.innerHTML = html;
        this.composerResults.style.display = 'block';

        // Add click handlers
        this.composerResults.querySelectorAll('.composer-item').forEach(item => {
            item.addEventListener('click', () => {
                const composerName = JSON.parse(item.dataset.composer);
                this.selectComposer(composerName);
            });
        });

        this.composerResults.querySelectorAll('.work-item').forEach(item => {
            item.addEventListener('click', async () => {
                const composerName = JSON.parse(item.dataset.composer);
                const workName = JSON.parse(item.dataset.work);

                console.log('Work clicked:', composerName, workName);

                // Hide search results immediately
                this.composerResults.style.display = 'none';

                // Don't show works list or update search box when clicking from search
                await this.selectComposer(composerName, false, false);
                await this.selectWork(workName);
            });
        });

        this.composerResults.querySelectorAll('.movement-item').forEach(item => {
            item.addEventListener('click', async () => {
                const composerName = JSON.parse(item.dataset.composer);
                const workName = JSON.parse(item.dataset.work);
                const movementName = JSON.parse(item.dataset.movement);
                const midiUrl = JSON.parse(item.dataset.midiUrl);

                console.log('Movement clicked:', composerName, workName, movementName);

                // Hide search results immediately
                this.composerResults.style.display = 'none';

                // Select the composer and work first, then load the movement
                // Pass false to prevent showing the works list and updating search box
                // Pass false to selectWork to skip auto-loading first movement
                await this.selectComposer(composerName, false, false);
                await this.selectWork(workName, false);

                // Find and select the matching movement in the dropdown
                for (let i = 0; i < this.movementSelect.options.length; i++) {
                    const option = this.movementSelect.options[i];
                    if (option.value) {
                        try {
                            const optionData = JSON.parse(option.value);
                            if (optionData.midiUrl === midiUrl) {
                                this.movementSelect.selectedIndex = i;
                                break;
                            }
                        } catch (e) {
                            // Skip invalid options
                        }
                    }
                }

                // Convert relative URL to absolute and load
                const absoluteUrl = this.toAbsoluteUrl(midiUrl);
                this.loadMIDIFromURL(absoluteUrl, movementName);
            });
        });
    }

    async selectComposer(composerName, showWorksList = true, updateSearchBox = true) {
        this.selectedComposer = composerName;
        if (updateSearchBox) {
            this.composerSearch.value = composerName;
        }
        this.composerResults.style.display = 'none';

        try {
            const response = await fetch(`/api/composer/${encodeURIComponent(composerName)}/works`);

            if (!response.ok) {
                throw new NetworkError(`HTTP error! status: ${response.status}`, `/api/composer/${composerName}/works`, response.status);
            }

            const works = await response.json();

            if (!works || works.length === 0) {
                this.showStatus('No works found for this composer', 'error');
                return;
            }

            this.worksList.innerHTML = works.map(work => {
                const workJson = escapeHtmlAttribute(JSON.stringify(work.name));
                const workDisplay = escapeHtml(work.name);
                return `<div class="work-item" data-work="${workJson}">${workDisplay}</div>`;
            }).join('');

            // Only show works container if requested (for direct composer selection)
            if (showWorksList) {
                this.worksContainer.style.display = 'block';
            }

            // Add click handlers to work items
            this.worksList.querySelectorAll('.work-item').forEach(item => {
                item.addEventListener('click', () => {
                    const workName = JSON.parse(item.dataset.work);
                    this.selectWork(workName);
                });
            });
        } catch (error) {
            console.error('Error loading works:', error);
            this.showStatus(`Error loading works: ${error.message}`, 'error');
        }
    }

    async selectWork(workName, autoLoadFirstMovement = true) {
        this.selectedWork = workName;

        // Clear any previous status messages
        this.findMusicStatus.classList.remove('show');

        // Highlight selected work
        if (this.worksList) {
            this.worksList.querySelectorAll('.work-item').forEach(item => {
                item.classList.remove('selected');
                if (JSON.parse(item.dataset.work) === workName) {
                    item.classList.add('selected');
                }
            });
        }

        try {
            console.log(`[selectWork] Loading movements for composer="${this.selectedComposer}" work="${workName}"`);
            const response = await fetch(`/api/composer/${encodeURIComponent(this.selectedComposer)}/work/${encodeURIComponent(workName)}/sections`);
            const movements = await response.json();
            console.log(`[selectWork] Got ${movements.length} movements:`, movements);

            if (movements.length === 0) {
                this.showStatus('No movements found for this work', 'error');
                return;
            }

            // Check if this work is copyright-protected (all movements point to .html files)
            const firstMovementUrl = movements[0].midiUrl;
            if (firstMovementUrl.endsWith('.html') || firstMovementUrl.endsWith('.htm')) {
                // Show copyright message on Find Music tab (where the user currently is)
                this.findMusicStatus.textContent = 'Sorry, this work is not publicly available for copyright reasons.';
                this.findMusicStatus.className = 'status-message show error';
                return;
            }

            this.movementSelect.innerHTML = '<option value="">Choose a movement...</option>' +
                movements.map(movement => {
                    const jsonValue = JSON.stringify({ name: movement.name, midiUrl: movement.midiUrl });
                    const movementDisplay = escapeHtml(movement.name);
                    return `<option value="${escapeHtmlAttribute(jsonValue)}">${movementDisplay}</option>`;
                }).join('');

            // Switch to Play tab and update display
            this.switchTab('play-music');
            this.updateWorkDisplay();

            // Auto-select and auto-load first movement in the dropdown
            if (movements.length > 0) {
                this.movementSelect.selectedIndex = 1; // Select the first movement (index 1 after the placeholder)

                // Auto-load the first movement (unless disabled)
                if (autoLoadFirstMovement) {
                    const movementData = movements[0];
                    const absoluteUrl = this.toAbsoluteUrl(movementData.midiUrl);
                    this.loadMIDIFromURL(absoluteUrl, movementData.name);
                }
            }

            // Pre-load common instruments in the background to speed up playback
            // This happens asynchronously and doesn't block the UI
            this.preloadCommonInstruments();
        } catch (error) {
            console.error('Error loading movements:', error);
            this.showStatus('Error loading movements', 'error');
        }
    }

    async loadRecentWorks() {
        try {
            // Load recent works from localStorage (private to this user/device)
            const recentWorks = await this.recentWorksManager.load();

            if (recentWorks.length === 0) {
                this.recentWorksDropdown.style.display = 'none';
                return;
            }

            // Show only the 5 most recent works
            const recentToShow = recentWorks.slice(0, 5);

            this.recentWorksSelect.innerHTML = '<option value="">Choose a recent work...</option>' +
                recentToShow.map(item => {
                    const composerDisplay = escapeHtml(item.composer);
                    const workDisplay = escapeHtml(item.work);
                    const movementDisplay = item.movement ? escapeHtml(item.movement) : '';
                    const displayText = item.movement
                        ? `${composerDisplay}, ${workDisplay} - ${movementDisplay}`
                        : `${composerDisplay}, ${workDisplay}`;
                    const jsonValue = JSON.stringify({ composer: item.composer, work: item.work });
                    return `<option value="${escapeHtmlAttribute(jsonValue)}">${displayText}</option>`;
                }).join('');
            this.recentWorksDropdown.style.display = 'block';
        } catch (error) {
            console.error('Error loading recent works:', error);
        }
    }

    async saveRecentWork(composer, work, movement = null) {
        try {
            // Save recent work to localStorage (private to this user/device)
            await this.recentWorksManager.save(composer, work, movement);
            // Reload recent works list
            await this.loadRecentWorks();
        } catch (error) {
            console.error('Error saving recent work:', error);
        }
    }

    showStatus(message, type = 'info') {
        // Delegate to StatusManager
        this.statusManager.show(message, type);
    }

    /**
     * Set the loading state - disables/enables play button and shows loading indicator in movement name
     * @param {boolean} isLoading - true to show loading state, false to clear it
     * @param {string} movementTitle - optional movement title to display
     */
    setLoadingState(isLoading, movementTitle = null) {
        // Helper to build display text (avoiding duplicate names for single-movement works)
        const buildDisplayText = (suffix = '') => {
            if (this.selectedComposer && this.selectedWork) {
                // For single-movement works where work name equals movement name, don't repeat it
                if (this.selectedWork === movementTitle) {
                    return `${this.selectedComposer}, ${this.selectedWork}${suffix}`;
                }
                return `${this.selectedComposer}, ${this.selectedWork} - ${movementTitle}${suffix}`;
            }
            return `${movementTitle}${suffix}`;
        };

        if (isLoading) {
            // Disable play button
            if (this.playBtn) {
                this.playBtn.disabled = true;
            }
            // Disable movement dropdown while loading
            if (this.movementSelect) {
                this.movementSelect.disabled = true;
            }
            // Show loading status next to movement dropdown (in Play Music pane)
            if (this.movementLoadingStatus) {
                this.movementLoadingStatus.textContent = '- loading...';
            }
            // Show the movement/channels section so user can see loading status
            if (this.movementChannelsSection) {
                this.movementChannelsSection.style.display = 'block';
            }
            // Update movement name to show loading (in Settings pane)
            if (this.currentMovementName && movementTitle) {
                this.currentMovementName.textContent = buildDisplayText(' - loading...');
            }
            // Hide any previous status messages (but keep the status element for errors)
            this.statusManager.hide();
        } else {
            // Re-enable play button
            if (this.playBtn) {
                this.playBtn.disabled = false;
            }
            // Re-enable movement dropdown
            if (this.movementSelect) {
                this.movementSelect.disabled = false;
            }
            // Clear loading status next to movement dropdown (in Play Music pane)
            if (this.movementLoadingStatus) {
                this.movementLoadingStatus.textContent = '';
            }
            // Update movement name to remove loading indicator (in Settings pane)
            if (this.currentMovementName && movementTitle) {
                this.currentMovementName.textContent = buildDisplayText();
            }
        }
    }

    async fetchWithRetry(url, maxRetries = 3, timeoutMs = TIMEOUTS.MIDI_FETCH) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetch(url, {
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                // If we get a 429, wait and retry (with longer exponential backoff)
                if (response.status === 429 && attempt < maxRetries - 1) {
                    const waitTime = Math.pow(3, attempt) * TIMEOUTS.INSTRUMENT_LOAD; // 10s, 30s, 90s
                    this.showStatus(`Rate limited. Retrying in ${waitTime / 1000} seconds... (attempt ${attempt + 1}/${maxRetries})`, 'info');
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // If we get 502/504, it's a gateway/timeout error - retry
                if ((response.status === 502 || response.status === 504) && attempt < maxRetries - 1) {
                    clearTimeout(timeoutId);
                    const waitTime = Math.pow(2, attempt) * 3000; // 3s, 6s, 12s
                    this.showStatus(`Server timeout. Retrying... (attempt ${attempt + 1}/${maxRetries})`, 'info');
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                return response;
            } catch (error) {
                clearTimeout(timeoutId);

                // Check if it was an abort (timeout)
                if (error.name === 'AbortError') {
                    console.warn(`Request timeout after ${timeoutMs}ms (attempt ${attempt + 1})`);
                    if (attempt === maxRetries - 1) {
                        throw new TimeoutError(`Request timed out after ${maxRetries} attempts`, 'fetch');
                    }
                    // Wait before retrying timeout
                    const waitTime = 3000;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                if (attempt === maxRetries - 1) {
                    throw error;
                }
                // Wait before retrying on network errors
                const waitTime = Math.pow(2, attempt) * 5000; // 5s, 10s, 20s
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    async loadMIDIFromURL(url, title = null) {
        if (!url) {
            this.showStatus('Invalid MIDI URL', 'error');
            return;
        }

        // Store the last loaded URL
        this.lastLoadedUrl = url;

        // Check if URL points to an HTML page (copyright-protected works)
        if (url.endsWith('.html') || url.endsWith('.htm')) {
            this.showStatus('Sorry, this work is not publicly available for copyright reasons.', 'error');
            return;
        }

        try {
            // Disable play button and show loading indicator in movement name
            this.setLoadingState(true, title);

            // Stop any currently playing MIDI
            this.stop();
            this.cleanup();

            // Fetch and parse MIDI file via proxy to avoid CORS issues (with retry logic)
            const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
            const response = await this.fetchWithRetry(proxyUrl);
            if (!response.ok) {
                // Try to get error message from response
                let errorMsg = response.statusText;
                try {
                    const errorData = await response.json();
                    if (errorData.error) {
                        errorMsg = errorData.error;
                    }
                } catch (e) {
                    // Ignore JSON parse errors
                }
                throw new MIDILoadError(errorMsg, url);
            }

            const arrayBuffer = await response.arrayBuffer();
            // Store the raw ArrayBuffer for SpessaSynth (it needs raw MIDI data, not parsed)
            this.lastMidiArrayBuffer = arrayBuffer;
            this.midi = new Midi(arrayBuffer);

            if (!this.midi || !this.midi.tracks || this.midi.tracks.length === 0) {
                throw new MIDILoadError('Invalid MIDI file or no tracks found', url);
            }

            // Find the earliest note time to skip leading silence
            let earliestNote = Infinity;
            for (const track of this.midi.tracks) {
                if (track.notes && track.notes.length > 0) {
                    for (const note of track.notes) {
                        if (note.time < earliestNote) {
                            earliestNote = note.time;
                        }
                    }
                }
            }

            // Only skip silence if there's more than 0.5 seconds of it
            this.skipToTime = (earliestNote !== Infinity && earliestNote > 0.5) ? earliestNote : 0;

            // Adjust duration to account for removed leading silence
            this.originalDuration = this.midi.duration - this.skipToTime;
            this.duration = this.originalDuration;

            // Store the current movement name (needed for localStorage keys)
            this.currentMovement = title;

            // Setup the MIDI playback
            await this.setupPlayback();

            // Reset channel selection before loading override - allows auto-selection by instrument
            this.selectedChannelIndex = null;

            // Load saved channel override for this movement (before updating channels list)
            this.loadChannelOverride();

            // Update UI
            this.updateMIDIInfo();

            // Update channels list based on voice part
            this.updateChannelsList();

            // Update balance label to show instrument if override exists
            this.updateBalanceLabel();

            // Load time signature overrides from localStorage
            this.loadTimeSignatureOverrides();

            // Calculate bar positions
            this.calculateBars();

            // Populate time signature settings UI
            this.populateTimeSignatureSettings();

            // Initialize loop to full duration (AFTER bars are calculated)
            this.loopStart = 0;
            this.loopEnd = this.originalDuration;
            this.updateLoopDisplay();

            // Update the current movement name display with composer, work, and movement
            if (title && this.selectedComposer && this.selectedWork) {
                // For single-movement works where work name equals movement name, don't repeat it
                if (this.selectedWork === title) {
                    this.currentMovementName.textContent = `${this.selectedComposer}, ${this.selectedWork}`;
                } else {
                    this.currentMovementName.textContent = `${this.selectedComposer}, ${this.selectedWork} - ${title}`;
                }
                // Save recent work with movement
                await this.saveRecentWork(this.selectedComposer, this.selectedWork, title);
            } else if (title) {
                this.currentMovementName.textContent = title;
            }

            // Re-enable play button and clear loading indicator
            this.setLoadingState(false, title);

            // Don't auto-play - let user click play when ready

        } catch (error) {
            console.error('Error loading MIDI:', error);

            // Re-enable play button on error
            this.setLoadingState(false);

            // Provide specific error messages for common issues
            let errorMessage = error.message;

            // Check if this is a memory-related error
            if (error.message.includes('memory') ||
                error.message.includes('allocation') ||
                error.message.includes('quota') ||
                error.name === 'QuotaExceededError' ||
                error.name === 'RangeError') {

                errorMessage = 'Insufficient memory to load this work. ';

                if (this.deviceInfo && this.deviceInfo.hasLimitedMemory) {
                    errorMessage += 'Your device has limited memory. Try selecting a simpler work with fewer instruments, or close other browser tabs.';
                } else {
                    errorMessage += 'This work may have too many instruments for your device. Try selecting a simpler work or close other browser tabs.';
                }
            }

            this.showStatus(`Error: ${errorMessage}`, 'error');
        }
    }

    async setupPlayback() {
        // Create instruments and parts for each track
        this.parts = [];
        this.instruments = [];

        // Get audio context from Tone.js
        const audioContext = Tone.context.rawContext;

        // Prepare track data for parallel loading
        const trackData = [];
        for (let i = 0; i < this.midi.tracks.length; i++) {
            const track = this.midi.tracks[i];
            if (track.notes.length > 0) {
                trackData.push({ track, trackIndex: i });
            }
        }

        // Count unique instruments needed
        const uniqueInstruments = new Set();
        for (const { track } of trackData) {
            uniqueInstruments.add(this.getInstrumentName(track));
        }
        const instrumentCount = uniqueInstruments.size;

        // Check memory before loading (only for high quality soundfont mode)
        // Standard mode doesn't need this check as it uses much less memory
        if (this.soundfontMode === SOUNDFONT_MODE.HIGH_QUALITY) {
            const memoryCheck = this.checkMemoryForInstruments(instrumentCount);
            if (!memoryCheck.canLoad) {
                this.showStatus(memoryCheck.message, 'error');
                throw new MemoryError(memoryCheck.message);
            }
            console.log(`[Memory] ${instrumentCount} unique instruments (~${memoryCheck.estimatedMB}MB), limit: ${memoryCheck.maxInstruments}`);
        }

        // Standard mode uses SpessaSynth with GeneralUser GS soundfont
        if (this.soundfontMode === SOUNDFONT_MODE.STANDARD) {
            console.log('[Soundfont] Using standard mode');

            try {
                // Dynamically import SpessaSynth libraries
                // Note: esm.sh properly resolves internal dependencies
                if (!this.spessaSynthModule) {
                    this.showStatus('Loading SpessaSynth library...', 'info');
                    // Import both lib (for Synthesizer/Sequencer) and core (for MIDI parser)
                    const [libModule, coreModule] = await Promise.all([
                        import('https://esm.sh/spessasynth_lib@4.0.18'),
                        import('https://esm.sh/spessasynth_core@4.0.6')
                    ]);
                    this.spessaSynthModule = libModule;
                    this.spessaCoreModule = coreModule;
                    console.log('[Soundfont] Libraries loaded');
                }

                const { Sequencer } = this.spessaSynthModule;

                // Initialize SpessaSynth if not already done
                if (!this.spessaSynth) {
                    this.showStatus('Loading soundfont (10MB)...', 'info');

                    // Create audio context
                    const audioContext = new AudioContext();

                    // Load the AudioWorklet processor (must be same-origin)
                    await audioContext.audioWorklet.addModule('/spessasynth_processor.min.js');
                    console.log('[Soundfont] Worklet processor loaded');

                    // Create the synthesizer
                    const { WorkletSynthesizer } = this.spessaSynthModule;
                    this.spessaSynth = new WorkletSynthesizer(audioContext);

                    // Connect synthesizer to audio output
                    this.spessaSynth.connect(audioContext.destination);
                    console.log('[Soundfont] Connected to audio destination');

                    // Load the GeneralUser GS soundfont
                    const sfResponse = await fetch('/soundfonts/GeneralUserGS.sf3');
                    const sfArrayBuffer = await sfResponse.arrayBuffer();
                    await this.spessaSynth.soundBankManager.addSoundBank(sfArrayBuffer, 'GeneralUserGS');
                    console.log('[Soundfont] GeneralUser GS soundfont loaded');

                    // Wait for synth to be ready
                    await this.spessaSynth.isReady;
                    console.log('[Soundfont] Synthesizer ready');

                    // Store audio context for later use
                    this.spessaAudioContext = audioContext;
                }

                // Use the already-fetched MIDI ArrayBuffer (stored in loadMIDIFromURL)
                // Make a copy since the original may have been consumed by Midi parser
                const arrayBuffer = this.lastMidiArrayBuffer.slice(0);

                // Create sequencer if not exists, otherwise reuse
                if (!this.spessaSequencer) {
                    // Sequencer constructor: new Sequencer(synth, options)
                    this.spessaSequencer = new Sequencer(this.spessaSynth, {
                        skipToFirstNoteOn: true
                    });
                } else {
                    // Stop existing playback
                    this.spessaSequencer.pause();
                }

                // Parse MIDI using SpessaSynth's BasicMIDI class and load into sequencer
                const { BasicMIDI } = this.spessaCoreModule;
                const parsedMidi = BasicMIDI.fromArrayBuffer(arrayBuffer);
                await this.spessaSequencer.loadNewSongList([parsedMidi]);

                // Mark that we're using SpessaSynth for playback
                this.usingSpessaSynth = true;

                // Store track info for UI compatibility
                for (const { track, trackIndex } of trackData) {
                    this.instruments.push({
                        instrument: null,
                        gainNode: null,
                        trackIndex,
                        volumeMultiplier: 1.0,
                        isSpessaSynth: true
                    });
                    this.channelVolumes[trackIndex] = 100;
                }

                // We don't create Tone.Parts - SpessaSynth handles everything
                console.log(`[Soundfont] Ready with ${trackData.length} tracks`);

                // Apply initial master volume
                this.applyMasterVolume();

                this.showStatus('Ready', 'success');
                return;

            } catch (error) {
                console.error('[Soundfont] Failed to initialize:', error);
                this.showStatus('Soundfont initialization failed', 'error');
                throw error;
            }
        }

        // Check if audio context is available (may be suspended until user interaction)
        // Try to start it - if it's suspended due to autoplay policy, this will fail quickly
        try {
            if (Tone.context.state !== 'running') {
                // Try to start audio context with a short timeout
                const startPromise = Tone.start();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Audio context start timeout')), 500)
                );
                await Promise.race([startPromise, timeoutPromise]);
            }
        } catch (e) {
            console.log('[Audio] Context cannot start yet - will load instruments when user interacts');
            // Enable play button but keep "loading..." indicator until user clicks play
            if (this.playBtn) {
                this.playBtn.disabled = false;
            }
            // Store track data for later loading
            this.pendingTrackData = trackData;
            return;
        }

        // Get soundfont URL based on mode (only FULL mode uses traditional soundfonts here)
        const soundfontUrl = this.getSoundfontUrl();
        const soundfontName = 'FluidR3_GM';

        // Show loading progress
        this.showStatus('Loading: 0%', 'info');
        let loadedCount = 0;
        const totalCount = trackData.length;

        try {
            // Load all instruments in parallel (with progress tracking)
            const instrumentPromises = trackData.map(async ({ track, trackIndex }) => {
                const instrumentName = this.getInstrumentName(track);

                // Create a gain node for this track first
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 1.0; // Default volume (100%)
                gainNode.connect(audioContext.destination);

                try {
                    let instrument;
                    let fromCache = false;

                    // Check cache first - we cache the entire instrument object
                    // The instrument contains decoded AudioBuffers for each note
                    const cached = this.instrumentCache.get(instrumentName);
                    if (cached && cached.instrument) {
                        // Reuse the cached instrument directly - this is MUCH faster
                        // since we skip the audio decoding step entirely
                        console.log(`[Instrument Cache] ✓ Reusing cached instrument for ${instrumentName}`);
                        instrument = cached.instrument;
                        fromCache = true;

                        // Note: Cached instruments output to audioContext.destination directly
                        // Volume control is handled via the gain parameter in instrument.play()
                    } else {
                        // Load the SoundFont instrument
                        // Connect directly to audioContext.destination for caching
                        console.log(`[Instrument Cache] ✗ Loading new instrument: ${instrumentName}`);

                        // Add timeout to prevent hanging on suspended audio context
                        const loadPromise = Soundfont.instrument(audioContext, instrumentName, {
                            soundfont: soundfontName,
                            // Connect to destination directly - volume controlled via gain param
                            destination: audioContext.destination,
                            nameToUrl: (name, sf, format) => {
                                format = format === 'ogg' ? format : 'mp3';
                                return `${soundfontUrl}/${name}-${format}.js`;
                            }
                        });

                        const timeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error(`Timeout loading ${instrumentName}`)), 30000)
                        );

                        instrument = await Promise.race([loadPromise, timeoutPromise]);

                        // Cache the instrument for reuse across movements and works
                        this.addToInstrumentCache(instrumentName, instrument);
                    }

                    // Update progress
                    loadedCount++;
                    const percent = Math.round((loadedCount / totalCount) * 100);
                    this.showStatus(`Loading: ${percent}%`, 'info');

                    // We don't use gainNode for routing anymore, but keep it for compatibility
                    // Volume control is done via the gain parameter in instrument.play()
                    return { instrument, trackIndex, instrumentName, gainNode, success: true, fromCache };

                } catch (error) {
                    console.error(`Failed to load ${instrumentName}, falling back to piano:`, error);

                    // Fallback to piano
                    try {
                        const instrument = await Soundfont.instrument(audioContext, 'acoustic_grand_piano', {
                            soundfont: soundfontName,
                            destination: gainNode,
                            nameToUrl: (name, sf, format) => {
                                format = format === 'ogg' ? format : 'mp3';
                                return `${soundfontUrl}/${name}-${format}.js`;
                            }
                        });

                        // Update progress even for fallback
                        loadedCount++;
                        const percent = Math.round((loadedCount / totalCount) * 100);
                        this.showStatus(`Loading: ${percent}%`, 'info');

                        return { instrument, trackIndex, instrumentName: 'acoustic_grand_piano (fallback)', gainNode, success: false };
                    } catch (fallbackError) {
                        console.error(`Even piano fallback failed:`, fallbackError);
                        loadedCount++;
                        return null;
                    }
                }
            });

            // Wait for all instruments to load
            const loadedInstruments = await Promise.all(instrumentPromises);

            // Clear loading message
            this.statusManager.hide();

            // Create gain nodes and parts for each loaded instrument
            let successCount = 0;
            let fallbackCount = 0;
            let cacheHitCount = 0;

            for (let i = 0; i < loadedInstruments.length; i++) {
                const result = loadedInstruments[i];
                if (!result) continue;

                const { instrument, trackIndex, instrumentName, gainNode, success, fromCache } = result;

                // Defensive check: ensure midi and track still exist
                // (user may have switched movements while loading)
                if (!this.midi || !this.midi.tracks || !this.midi.tracks[trackIndex]) {
                    console.warn(`[Setup] Track ${trackIndex} no longer available (movement may have changed)`);
                    continue;
                }
                const track = this.midi.tracks[trackIndex];

                if (success) {
                    successCount++;
                    if (fromCache) {
                        cacheHitCount++;
                    }
                } else {
                    fallbackCount++;
                }

                // Store instrument with volume multiplier for balance control
                // Volume is controlled via gain parameter in play() since instruments
                // are connected directly to audioContext.destination for caching
                this.instruments.push({
                    instrument,
                    gainNode, // Keep for compatibility but not used for audio routing
                    trackIndex,
                    volumeMultiplier: 1.0 // Adjusted by applyBalance()
                });
                this.channelVolumes[trackIndex] = 100;

                // Create a Tone.Part for this track with tempo scaling
                // Subtract skipToTime to remove leading silence from the timeline
                const tempoScale = 1 / this.tempoMultiplier;
                const notes = track.notes.map(note => ({
                    time: Math.max(0, (note.time - this.skipToTime) * tempoScale),
                    note: note.name,
                    duration: note.duration * tempoScale,
                    velocity: note.velocity
                }));

                const instrumentIndex = this.instruments.length - 1;
                const part = new Tone.Part((time, value) => {
                    // Schedule the note with SoundFont instrument
                    // Apply volume multiplier for balance control
                    const instrumentData = this.instruments[instrumentIndex];
                    const effectiveGain = value.velocity * instrumentData.volumeMultiplier * this.masterVolume;
                    instrumentData.instrument.play(
                        value.note,
                        time,
                        {
                            duration: value.duration,
                            gain: effectiveGain
                        }
                    );
                }, notes);

                this.parts.push(part);
            }

            // Ensure Tone.js is ready and audio context is running
            await Tone.start();

            // Resume audio context if it's suspended
            if (Tone.context.state !== 'running') {
                await Tone.context.resume();
            }

            // Log instrument loading stats to console only (no status message)
            const details = [];
            if (cacheHitCount > 0) {
                details.push(`${cacheHitCount} from cache`);
            }
            if (successCount - cacheHitCount > 0) {
                details.push(`${successCount - cacheHitCount} loaded`);
            }
            if (fallbackCount > 0) {
                details.push(`${fallbackCount} using fallback`);
            }
            if (details.length > 0) {
                console.log(`[Instruments] Ready: ${details.join(', ')}`);
            }

        } catch (error) {
            console.error('Error during setup:', error);
            throw error;
        }
    }

    getInstrumentName(track) {
        // Delegate to InstrumentLoader
        return this.instrumentLoader.getInstrumentName(track);
    }

    midiProgramToInstrument(program) {
        // Delegate to InstrumentLoader
        return this.instrumentLoader.midiProgramToInstrument(program);
    }

    updateMIDIInfo() {
        // The title is set by loadMIDIFromURL, so just update the progress UI
        // Update progress duration label and current time
        if (this.progressDuration) {
            this.progressDuration.textContent = formatTime(this.originalDuration);
        }
        if (this.currentTimeDisplay) {
            this.currentTimeDisplay.textContent = '0:00';
        }
        if (this.progressBar) {
            this.progressBar.value = 0;
        }
    }

    applyBalance() {
        // Apply balance to all instruments by updating their volumeMultiplier
        // Volume is applied via the gain parameter in instrument.play()
        if (!this.instruments || this.instruments.length === 0) return;

        for (let i = 0; i < this.instruments.length; i++) {
            const instrumentData = this.instruments[i];

            let volumeMultiplier = 1.0;

            // Check if this is the user's selected channel
            const isMyPart = (this.selectedChannelIndex !== null && i === this.selectedChannelIndex);

            if (isMyPart) {
                // This is the user's part
                // Balance adjusts this part's volume
                volumeMultiplier = 1.0 + (this.balance / 100);
            } else {
                // This is not the user's part
                // Balance inversely adjusts other parts' volume
                volumeMultiplier = 1.0 - (this.balance / 100);
            }

            // Ensure volume doesn't go negative
            volumeMultiplier = Math.max(0, volumeMultiplier);

            // Store the volume multiplier - it's applied in the Part callback
            instrumentData.volumeMultiplier = volumeMultiplier;
        }
    }

    /**
     * Apply master volume to all audio output
     * Works with SpessaSynth (standard) and Soundfont (highQuality) modes
     */
    applyMasterVolume() {
        // Convert percentage to 0-1 range
        const volumeLevel = this.masterVolume / 100;

        // Apply to SpessaSynth (standard mode)
        if (this.usingSpessaSynth && this.spessaSynth) {
            // SpessaSynth uses setMasterParameter("masterGain", value)
            // Value is a gain multiplier (1.0 = normal, 0.5 = 50%, etc.)
            if (typeof this.spessaSynth.setMasterParameter === 'function') {
                this.spessaSynth.setMasterParameter("masterGain", volumeLevel);
            }
        }

        // Apply to Tone.js Destination (for highQuality mode)
        if (Tone && Tone.Destination) {
            // Convert to dB: 0% = -Infinity, 100% = 0dB
            const dbValue = volumeLevel > 0 ? 20 * Math.log10(volumeLevel) : -Infinity;
            Tone.Destination.volume.value = dbValue;
        }
    }

    async play() {
        if (!this.midi) {
            // If no MIDI is loaded but a movement is selected, load it automatically
            if (this.movementSelect.value) {
                const movementData = JSON.parse(this.movementSelect.value);
                const absoluteUrl = this.toAbsoluteUrl(movementData.midiUrl);
                await this.loadMIDIFromURL(absoluteUrl, movementData.name);
                // Now try playing again
                if (!this.midi) {
                    this.showStatus('Failed to load MIDI file', 'error');
                    return;
                }
            } else {
                this.showStatus('Please select a movement first', 'error');
                return;
            }
        }

        if (this.isPlaying) return;

        // Start audio context if it hasn't been started yet (requires user interaction)
        if (Tone.context.state === 'suspended') {
            await Tone.start();
        }

        // Check if instruments need to be loaded (deferred from initial page load)
        if (this.pendingTrackData && this.instruments.length === 0) {
            // Re-run setupPlayback now that audio context is active
            await this.setupPlayback();
            this.pendingTrackData = null;
            // Clear the " - loading..." suffix from movement name
            if (this.currentMovementName) {
                this.currentMovementName.textContent = this.currentMovementName.textContent.replace(' - loading...', '');
            }
        }

        // Ensure currentTime is within valid range
        if (this.currentTime < 0 || this.currentTime >= this.originalDuration) {
            this.currentTime = 0;
        }

        // Handle SpessaSynth playback separately
        if (this.usingSpessaSynth && this.spessaSequencer) {
            // Resume SpessaSynth's AudioContext if suspended (required for first user interaction)
            if (this.spessaAudioContext && this.spessaAudioContext.state === 'suspended') {
                await this.spessaAudioContext.resume();
            }
            this.spessaSequencer.play();
            this.isPlaying = true;

            // Update button visibility
            if (this.playBtn) this.playBtn.style.display = 'none';
            if (this.pauseBtn) this.pauseBtn.style.display = 'inline-flex';

            // Start progress update for SpessaSynth
            this.startProgressUpdate();
            return;
        }

        // Cancel any previously scheduled events before starting
        this.parts.forEach((part, index) => {
            part.stop(0);  // Pass explicit 0 to avoid floating-point precision issues
            part.cancel();
        });

        // Start parts immediately ("+0") so they sync with Transport timeline
        this.parts.forEach((part, index) => {
            part.start("+0", this.currentTime);
        });

        // Start Transport immediately from the current offset
        Tone.Transport.start("+0", this.currentTime);
        this.isPlaying = true;

        // Update button visibility
        if (this.playBtn) this.playBtn.style.display = 'none';
        if (this.pauseBtn) this.pauseBtn.style.display = 'inline-flex';

        // Start progress update
        this.startProgressUpdate();
    }

    pause() {
        if (!this.isPlaying) return;

        // Handle SpessaSynth pause
        if (this.usingSpessaSynth && this.spessaSequencer) {
            this.spessaSequencer.pause();
            this.isPlaying = false;

            // Update button visibility
            this.playBtn.style.display = 'inline-flex';
            this.pauseBtn.style.display = 'none';

            // Stop progress update
            this.stopProgressUpdate();
            return;
        }

        Tone.Transport.pause();
        this.isPlaying = false;

        // Immediately stop all playing notes
        this.stopAllNotes();

        // Update button visibility
        this.playBtn.style.display = 'inline-flex';
        this.pauseBtn.style.display = 'none';

        // Stop progress update
        this.stopProgressUpdate();
    }

    stop() {
        // Handle SpessaSynth stop
        if (this.usingSpessaSynth && this.spessaSequencer) {
            this.spessaSequencer.pause();
            this.spessaSequencer.currentTime = 0;
            this.isPlaying = false;
            this.currentTime = 0;

            // Update button visibility
            if (this.playBtn) this.playBtn.style.display = 'inline-flex';
            if (this.pauseBtn) this.pauseBtn.style.display = 'none';

            // Update UI
            if (this.currentTimeDisplay) this.currentTimeDisplay.textContent = '0:00';
            if (this.progressBar) this.progressBar.value = 0;
            if (this.currentBarDisplay) this.currentBarDisplay.textContent = 'Bar: -';

            // Stop progress update
            this.stopProgressUpdate();
            return;
        }

        Tone.Transport.stop();
        this.isPlaying = false;
        this.currentTime = 0;

        // Stop all parts
        if (this.parts) {
            this.parts.forEach(part => {
                try {
                    part.stop(0);  // Pass explicit 0 to avoid floating-point precision issues
                } catch (e) {
                    // Ignore errors
                }
            });
        }

        // Immediately stop all playing notes
        this.stopAllNotes();

        // Update button visibility
        if (this.playBtn) this.playBtn.style.display = 'inline-flex';
        if (this.pauseBtn) this.pauseBtn.style.display = 'none';

        // Update UI
        if (this.currentTimeDisplay) this.currentTimeDisplay.textContent = '0:00';
        if (this.progressBar) this.progressBar.value = 0;
        if (this.currentBarDisplay) this.currentBarDisplay.textContent = 'Bar: -';

        // Stop progress update
        this.stopProgressUpdate();
    }

    stopAllNotes() {
        // Immediately stop all playing notes on all instruments
        if (this.instruments) {
            this.instruments.forEach(({ instrument }) => {
                if (instrument) {
                    // For Tone.js PolySynth, use releaseAll()
                    if (typeof instrument.releaseAll === 'function') {
                        instrument.releaseAll();
                    }
                    // For SoundFont instruments, use stop()
                    else if (typeof instrument.stop === 'function') {
                        instrument.stop();
                    }
                }
            });
        }
    }

    seek(seconds) {
        const newTime = Math.max(0, Math.min(this.originalDuration, this.currentTime + seconds));
        this.seekTo(newTime);
    }

    seekTo(time, autoResume = true) {
        const wasPlaying = this.isPlaying;

        // Always stop playback first
        if (this.isPlaying) {
            this.isPlaying = false;
            this.stopProgressUpdate();
        }

        // time parameter is in original time
        this.currentTime = Math.max(0, Math.min(this.originalDuration, time));

        // Handle SpessaSynth seeking
        if (this.usingSpessaSynth && this.spessaSequencer) {
            this.spessaSequencer.pause();
            this.spessaSequencer.currentTime = this.currentTime;
        } else {
            // Standard Tone.js seeking
            // Stop and cancel everything completely
            this.parts.forEach(part => {
                part.stop(0);  // Pass explicit 0 to avoid floating-point precision issues
                part.cancel();
            });

            Tone.Transport.stop();
            Tone.Transport.cancel();

            // Convert original time to scaled time for Transport
            const scaledTime = this.currentTime / this.tempoMultiplier;
            Tone.Transport.seconds = scaledTime;
        }

        // Update UI
        this.currentTimeDisplay.textContent = formatTime(this.currentTime);
        this.progressBar.value = (this.currentTime / this.originalDuration) * 100;

        // Update current bar display
        const currentBar = this.getCurrentBar();
        if (currentBar && this.currentBarDisplay) {
            this.currentBarDisplay.textContent = `Bar: ${currentBar}`;
        }

        // Resume playback if it was playing before and autoResume is true
        if (wasPlaying && autoResume) {
            this.play();
        }
    }

    setTempo(tempoPercent) {
        const wasPlaying = this.isPlaying;
        const currentTime = this.currentTime;

        // Stop everything cleanly
        if (this.isPlaying) {
            this.stop();
        }

        this.tempoMultiplier = tempoPercent / 100;
        this.tempoValue.textContent = tempoPercent;

        // Update actual duration based on tempo
        // Slower tempo = longer duration
        this.duration = this.originalDuration / this.tempoMultiplier;

        // Handle SpessaSynth tempo
        if (this.usingSpessaSynth && this.spessaSequencer) {
            // SpessaSynth uses playbackRate for tempo control
            this.spessaSequencer.playbackRate = this.tempoMultiplier;

            // If was playing, seek to the saved position and restart
            if (wasPlaying) {
                this.currentTime = currentTime;
                this.spessaSequencer.currentTime = currentTime;
                setTimeout(() => this.play(), 100);
            }
        } else {
            // Update BPM in Transport
            if (this.midi && this.midi.header.tempos.length > 0) {
                const originalBPM = this.midi.header.tempos[0].bpm;
                Tone.Transport.bpm.value = originalBPM * this.tempoMultiplier;
            }

            // Recreate parts with new tempo
            this.recreateParts();

            // If was playing, seek to the saved position and restart
            if (wasPlaying) {
                this.currentTime = currentTime;
                // Convert original time to scaled time
                const scaledTime = currentTime / this.tempoMultiplier;
                Tone.Transport.seconds = scaledTime;
                setTimeout(() => this.play(), 100);
            }
        }
    }

    recreateParts() {
        // Dispose old parts
        this.parts.forEach(part => {
            part.dispose();
        });
        this.parts = [];

        // Recreate parts for each instrument with tempo-adjusted times
        for (let i = 0; i < this.instruments.length; i++) {
            const trackIndex = this.instruments[i].trackIndex;
            const track = this.midi.tracks[trackIndex];

            // Scale note times and durations by tempo multiplier
            // Slower tempo (0.5) = notes at 2x time, faster (2.0) = notes at 0.5x time
            // Also subtract skipToTime to be consistent with setupPlayback
            const tempoScale = 1 / this.tempoMultiplier;

            const notes = track.notes.map(note => ({
                time: Math.max(0, (note.time - this.skipToTime) * tempoScale),
                note: note.name,
                duration: note.duration * tempoScale,
                velocity: note.velocity
            }));

            const part = new Tone.Part((time, value) => {
                const { instrument } = this.instruments[i];
                instrument.play(
                    value.note,
                    time,
                    {
                        duration: value.duration,
                        gain: value.velocity
                    }
                );
            }, notes);

            this.parts.push(part);
        }
    }

    startProgressUpdate() {
        this.stopProgressUpdate();

        this.progressInterval = setInterval(() => {
            if (this.isPlaying) {
                // Handle SpessaSynth progress
                if (this.usingSpessaSynth && this.spessaSequencer) {
                    // SpessaSynth has its own currentTime property
                    this.currentTime = this.spessaSequencer.currentTime;

                    // Check if playback ended
                    if (this.spessaSequencer.isFinished || this.currentTime >= this.originalDuration) {
                        this.stop();
                        return;
                    }
                } else {
                    // Transport.seconds is in scaled time (affected by tempo)
                    // Convert back to original time for display and loop logic
                    const transportTime = Tone.Transport.seconds;
                    this.currentTime = transportTime * this.tempoMultiplier;
                }

                // Check loop boundaries (in original time)
                // If loop range is not full duration, loop within that range (stay in same movement)
                const loopRangeSet = (this.loopStart > 0 || this.loopEnd < this.originalDuration - 0.5);

                if (loopRangeSet && this.currentTime >= this.loopEnd) {
                    // Loop back to loop start within the same movement
                    // Pause briefly then resume
                    this.pause();
                    this.seekTo(this.loopStart, false);
                    setTimeout(() => this.play(), 50);
                    return;
                } else if (!loopRangeSet && this.currentTime >= this.originalDuration) {
                    // End of movement reached without loop set
                    if (this.repeatMode) {
                        // Repeat mode: loop back to start of current movement
                        this.pause();
                        this.seekTo(0, false);
                        setTimeout(() => this.play(), 50);
                    } else {
                        // Auto-advance mode: move to next movement after 1.5s pause
                        const currentIndex = this.movementSelect.selectedIndex;
                        const totalMovements = this.movementSelect.options.length;

                        if (currentIndex < totalMovements - 1 && currentIndex > 0) {
                            // Auto-advance to next movement after pause
                            this.pause();
                            this.seekTo(0, false);
                            setTimeout(() => this.skipToNextMovement(), 1500);
                        } else {
                            // Last movement - stop playback
                            this.stop();
                        }
                    }
                    return;
                }

                // Update UI - current time, bar number, and progress bar
                this.currentTimeDisplay.textContent = formatTime(this.currentTime);
                this.progressBar.value = (this.currentTime / this.originalDuration) * 100;

                // Update current bar display
                const currentBar = this.getCurrentBar();
                if (currentBar && this.currentBarDisplay) {
                    this.currentBarDisplay.textContent = `Bar: ${currentBar}`;
                }
            }
        }, 100);
    }

    stopProgressUpdate() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    skipToPreviousMovement() {
        // Get current selected index
        const currentIndex = this.movementSelect.selectedIndex;

        // Check if there's a previous movement (accounting for placeholder at index 0)
        if (currentIndex > 1) {
            // Select previous movement
            this.movementSelect.selectedIndex = currentIndex - 1;

            // Load the previous movement
            const movementData = JSON.parse(this.movementSelect.value);
            const absoluteUrl = this.toAbsoluteUrl(movementData.midiUrl);
            this.loadMIDIFromURL(absoluteUrl, movementData.name);
        }
    }

    skipToNextMovement(delayMs = 1500) {
        // Get current selected index
        const currentIndex = this.movementSelect.selectedIndex;
        const totalMovements = this.movementSelect.options.length;

        // Check if there's a next movement (accounting for placeholder at index 0)
        if (currentIndex < totalMovements - 1 && currentIndex > 0) {
            // Pause playback
            if (this.isPlaying) {
                this.pause();
            }

            // Wait for the specified delay before loading next movement
            setTimeout(() => {
                // Select next movement
                this.movementSelect.selectedIndex = currentIndex + 1;

                // Load the next movement
                const movementData = JSON.parse(this.movementSelect.value);
                const absoluteUrl = this.toAbsoluteUrl(movementData.midiUrl);
                this.loadMIDIFromURL(absoluteUrl, movementData.name);
            }, delayMs);
        }
    }

    // Helper function to convert relative URL to absolute (adds base URL)
    toAbsoluteUrl(relativeUrl) {
        if (relativeUrl.startsWith('http')) {
            return relativeUrl; // Already absolute
        }
        return this.baseUrl + relativeUrl;
    }

    // Add instrument to cache with LRU eviction
    // The cached instrument contains decoded AudioBuffers and can be reused directly
    addToInstrumentCache(instrumentName, instrument) {
        // Delegate to InstrumentLoader
        this.instrumentLoader.addToCache(instrumentName, instrument);

        // Store in local cache with LRU eviction
        if (this.instrumentCache.size >= this.maxCacheSize) {
            const firstKey = this.instrumentCache.keys().next().value;
            console.log(`[Instrument Cache] Evicting ${firstKey} to make room`);
            this.instrumentCache.delete(firstKey);
        }

        // Store the instrument directly - it contains the decoded AudioBuffers
        this.instrumentCache.set(instrumentName, { instrument });
        console.log(`[Instrument Cache] Cached ${instrumentName}`);
    }

    // Pre-load common instruments in the background to speed up playback
    async preloadCommonInstruments() {
        // Skip preloading if not using highQuality soundfonts
        if (this.soundfontMode !== SOUNDFONT_MODE.HIGH_QUALITY) {
            console.log('[Preload] Skipping preload - not using highQuality soundfonts');
            return;
        }

        // Delegate to InstrumentLoader
        const audioContext = Tone.context.rawContext;
        this.instrumentLoader.preloadCommonInstruments(audioContext);
    }

    cleanup() {
        // Stop and cancel all transport events
        Tone.Transport.stop();
        Tone.Transport.cancel();

        // Reset transport position to 0
        Tone.Transport.seconds = 0;

        // Stop all instruments
        if (this.instruments) {
            this.instruments.forEach(({ instrument, gainNode }) => {
                // Stop all playing notes
                if (instrument) {
                    // For Tone.js PolySynth, use releaseAll()
                    if (typeof instrument.releaseAll === 'function') {
                        instrument.releaseAll();
                    }
                    // For SoundFont instruments, use stop()
                    else if (typeof instrument.stop === 'function') {
                        instrument.stop();
                    }
                }
                // Disconnect gain node
                if (gainNode) {
                    try {
                        gainNode.disconnect();
                    } catch (e) {
                        // Ignore disconnect errors
                    }
                }
            });
        }

        // Clear all parts
        if (this.parts) {
            this.parts.forEach(part => {
                try {
                    part.stop(0);  // Pass explicit 0 to avoid floating-point precision issues
                    part.dispose();
                } catch (e) {
                    // Ignore disposal errors
                }
            });
        }

        this.instruments = [];
        this.parts = [];
        this.midi = null;
        this.currentTime = 0;
        this.duration = 0;
        this.originalDuration = 0;
        this.isPlaying = false;

        // Reset SpessaSynth flag (but keep the synthesizer for reuse)
        this.usingSpessaSynth = false;
    }
}

// Register service worker for caching soundfonts
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then((registration) => {
                console.log('[App] Service Worker registered successfully:', registration.scope);

                // Request persistent storage to reduce eviction risk
                if (navigator.storage && navigator.storage.persist) {
                    navigator.storage.persist().then((persistent) => {
                        console.log(`[App] Persistent storage granted: ${persistent}`);
                    });
                }

                // Listen for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('[App] New service worker available - will update on next reload');
                        }
                    });
                });
            })
            .catch((error) => {
                console.warn('[App] Service Worker registration failed:', error);
            });
    });
}

// Initialize the player when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.midiPlayer = new MIDIPlayer();
});
