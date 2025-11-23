// MIDI Player Application

// Import constants and utilities
import {
    BASE_URL,
    TIMEOUTS,
    AUDIO,
    MEMORY,
    VOICE_TO_INSTRUMENT,
    VOICE_PARTS
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

        // Bar/measure tracking
        this.bars = []; // Array of bar positions in seconds
        this.timeSignature = { numerator: 4, denominator: 4 }; // Default 4/4
        this.timeSignatureOverrides = {}; // User overrides for ambiguous time signatures
        this.startingBarOffset = 0; // Offset to add to all bar numbers (e.g., if score starts at bar 262)

        // Instrument cache for reusing loaded Soundfont instruments
        // This significantly speeds up loading when switching between movements
        this.instrumentCache = new Map(); // Map<instrumentName, instrument>
        this.maxCacheSize = 30; // Keep up to 30 instruments cached

        // Mapping of voice parts to MIDI instrument names
        this.voicePartInstruments = VOICE_TO_INSTRUMENT;

        this.initializeElements();

        // Initialize helper modules
        this.instrumentLoader = new InstrumentLoader(this.maxCacheSize);
        this.statusManager = new StatusManager(this.loadingStatus);
        this.recentWorksManager = new RecentWorksManager();

        this.loadPreferences();
        this.attachEventListeners();
        this.populateTimeSignatureSettings(); // Initialize time signature section (will show "not loaded" initially)
        this.initializeAudioContext(); // Initialize audio context on first user interaction
        this.checkDeviceCapabilities(); // Check device memory and show warning if limited
        this.loadDefaultWork(); // Load most recent work or Alessandro Scarlatti - Magnificat by default
        this.loadRecentWorks();
        this.checkURLRoute();
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
    }

    savePreferences() {
        localStorage.setItem('voicePart', this.voicePart);
        localStorage.setItem('balance', this.balance);
    }

    updateBalanceLabel() {
        // Update the balance label to show the current voice part
        const voicePartName = this.voicePart.charAt(0).toUpperCase() + this.voicePart.slice(1);
        if (this.balanceVoicePartSpan) {
            this.balanceVoicePartSpan.textContent = voicePartName;
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
            if (isAmbiguous) {
                const warning = document.createElement('div');
                warning.className = 'ambiguous-warning';
                warning.textContent = '(may be Alla Breve)';
                sigCell.appendChild(warning);
            }
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

    showHelpModal(title, text) {
        if (this.helpModal && this.helpModalTitle && this.helpModalText) {
            this.helpModalTitle.textContent = title || 'Help';
            this.helpModalText.textContent = text || 'No help available';
            this.helpModal.style.display = 'flex';
        }
    }

    hideHelpModal() {
        if (this.helpModal) {
            this.helpModal.style.display = 'none';
        }
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
        // Try to load the most recent work first, otherwise load Alessandro Scarlatti - Magnificat
        // This provides immediate usability when the app loads
        try {
            // Check if there are recent works
            const response = await fetch('/api/recent-works');
            const recentWorks = await response.json();

            let composer, work, movements;

            if (recentWorks && recentWorks.length > 0) {
                // Load the most recent work
                const mostRecent = recentWorks[0];
                composer = mostRecent.composer;
                work = mostRecent.work;
                const recentMovement = mostRecent.movement; // Store recent movement if available

                // Fetch movements for this work
                const movementsResponse = await fetch(`/api/composer/${encodeURIComponent(composer)}/work/${encodeURIComponent(work)}/sections`);
                movements = await movementsResponse.json();

                // If recent movement is available, find and select it
                if (recentMovement && movements.length > 0) {
                    const recentMovementIndex = movements.findIndex(m => m.name === recentMovement);
                    if (recentMovementIndex >= 0) {
                        // We'll set this after populating the dropdown
                        this.recentMovementIndex = recentMovementIndex + 1; // +1 for placeholder option
                    }
                }
            } else {
                // No recent works - load Alessandro Scarlatti - Magnificat as default
                composer = 'Alessandro Scarlatti';
                work = 'Magnificat';

                // Hardcoded movements for Alessandro Scarlatti - Magnificat (all use cached instruments)
                movements = [
                    { name: '1: Magnificat', midiUrl: '/Scarlatti/Magnificat/1-Magnificat.mid' },
                    { name: '2: Fecit potentiam', midiUrl: '/Scarlatti/Magnificat/2-Fecit.mid' },
                    { name: '3: Esurientes implevit bonis', midiUrl: '/Scarlatti/Magnificat/3-Esurientes.mid' },
                    { name: '4: Gloria Patri et Filio', midiUrl: '/Scarlatti/Magnificat/4-Gloria.mid' }
                ];
            }

            // Check if this work is copyright-protected
            if (movements.length > 0) {
                const firstMovementUrl = movements[0].midiUrl;
                if (firstMovementUrl.endsWith('.html') || firstMovementUrl.endsWith('.htm')) {
                    // This work is copyright-protected, fall back to Scarlatti
                    composer = 'Alessandro Scarlatti';
                    work = 'Magnificat';
                    movements = [
                        { name: '1: Magnificat', midiUrl: '/Scarlatti/Magnificat/1-Magnificat.mid' },
                        { name: '2: Fecit potentiam', midiUrl: '/Scarlatti/Magnificat/2-Fecit.mid' },
                        { name: '3: Esurientes implevit bonis', midiUrl: '/Scarlatti/Magnificat/3-Esurientes.mid' },
                        { name: '4: Gloria Patri et Filio', midiUrl: '/Scarlatti/Magnificat/4-Gloria.mid' }
                    ];
                }
            }

            this.selectedComposer = composer;
            this.selectedWork = work;

            // Populate movement dropdown with all movements
            this.movementSelect.innerHTML = '<option value="">Choose a movement...</option>' +
                movements.map(movement =>
                    `<option value='${JSON.stringify({ name: movement.name, midiUrl: movement.midiUrl })}'>${movement.name}</option>`
                ).join('');

            // Auto-select the recent movement or first movement in the dropdown
            if (this.recentMovementIndex && this.recentMovementIndex < this.movementSelect.options.length) {
                this.movementSelect.selectedIndex = this.recentMovementIndex;
            } else {
                this.movementSelect.selectedIndex = 1; // Default to first movement
            }

            this.updateWorkDisplay();

            // Update the currently selected movement display on Settings tab
            if (this.currentMovementName) {
                const firstMovementName = movements[0].name;
                this.currentMovementName.textContent = `${composer}, ${work} - ${firstMovementName}`;
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
            // Fall back to hardcoded Scarlatti if API fails
            this.selectedComposer = 'Alessandro Scarlatti';
            this.selectedWork = 'Magnificat';

            const fallbackMovements = [
                { name: '1: Magnificat', midiUrl: '/Scarlatti/Magnificat/1-Magnificat.mid' },
                { name: '2: Fecit potentiam', midiUrl: '/Scarlatti/Magnificat/2-Fecit.mid' },
                { name: '3: Esurientes implevit bonis', midiUrl: '/Scarlatti/Magnificat/3-Esurientes.mid' },
                { name: '4: Gloria Patri et Filio', midiUrl: '/Scarlatti/Magnificat/4-Gloria.mid' }
            ];

            this.movementSelect.innerHTML = '<option value="">Choose a movement...</option>' +
                fallbackMovements.map(movement =>
                    `<option value='${JSON.stringify({ name: movement.name, midiUrl: movement.midiUrl })}'>${movement.name}</option>`
                ).join('');

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

        // Volume controls - master volume fixed at 100%
        this.masterVolume = 1.0;

        this.balanceSlider.addEventListener('input', (e) => {
            this.balance = parseInt(e.target.value);
            this.balanceValue.textContent = e.target.value;
            this.applyBalance();
            this.savePreferences(); // Save balance whenever it changes
        });

        // Add spacebar toggle for play/pause
        document.addEventListener('keydown', (e) => {
            // Only trigger if not typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
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

    initializeLoopMarkerDrag(marker, isStart) {
        if (!marker) return;

        let isDragging = false;
        let progressBarRect = null;

        const updateLoopFromPosition = (clientX) => {
            if (!progressBarRect || !this.originalDuration) return;

            // Calculate percentage based on mouse position
            const relativeX = clientX - progressBarRect.left;
            const percent = Math.max(0, Math.min(100, (relativeX / progressBarRect.width) * 100));
            const time = (percent / 100) * this.originalDuration;

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
        if (!this.instruments || this.instruments.length === 0) {
            // MIDI file not loaded yet - show message, hide channels table
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

        // Build the channels table
        let html = '';
        for (let i = 0; i < this.instruments.length; i++) {
            const { trackIndex } = this.instruments[i];
            const track = this.midi.tracks[trackIndex];
            const instrumentName = this.getInstrumentName(track);
            const channelName = track.name || `Channel ${trackIndex + 1}`;

            // Check if this channel matches the voice part instrument
            const isMatching = (instrumentName === selectedInstrument);
            if (isMatching && autoSelectedIndex === null) {
                autoSelectedIndex = i;
            }

            // Determine if this channel should be checked
            const isChecked = (this.selectedChannelIndex !== null ? this.selectedChannelIndex === i : isMatching);

            html += `
                <tr>
                    <td style="text-align: center;">
                        <input type="radio" name="channel-selection" value="${i}" ${isChecked ? 'checked' : ''} />
                    </td>
                    <td>${channelName}</td>
                    <td>${instrumentName.replace(/_/g, ' ')}</td>
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

    checkURLRoute() {
        // Check if URL contains composer/work path (e.g., /domenico-scarlatti/magnificat)
        const path = window.location.pathname;
        if (path && path !== '/') {
            const parts = path.split('/').filter(p => p);
            if (parts.length >= 2) {
                const composer = decodeURIComponent(parts[0]);
                const work = decodeURIComponent(parts[1]);

                // Load the composer and work
                this.selectComposer(composer).then(() => {
                    this.selectWork(work);
                });
            }
        }
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
                const composerJson = JSON.stringify(composer.name).replace(/"/g, '&quot;');
                html += `<div class="composer-item" data-type="composer" data-composer="${composerJson}">${composer.name}</div>`;
            });
        }

        // Display work results (sorted alphabetically by work name)
        if (results.works.length > 0) {
            html += '<div class="result-category"><strong>Works:</strong></div>';
            const sortedWorks = results.works.sort((a, b) => a.work.localeCompare(b.work));
            sortedWorks.forEach(work => {
                // Escape JSON for HTML attributes by replacing quotes
                const composerJson = JSON.stringify(work.composer).replace(/"/g, '&quot;');
                const workJson = JSON.stringify(work.work).replace(/"/g, '&quot;');
                html += `<div class="work-item result-item" data-type="work" data-composer="${composerJson}" data-work="${workJson}">
                    <div class="result-main">${work.work}</div>
                    <div class="result-sub">${work.composer}</div>
                </div>`;
            });
        }

        // Display movement results (sorted alphabetically by movement name)
        if (results.movements.length > 0) {
            html += '<div class="result-category"><strong>Movements/songs:</strong></div>';
            const sortedMovements = results.movements.sort((a, b) => a.movement.localeCompare(b.movement));
            sortedMovements.forEach(movement => {
                // Escape JSON for HTML attributes
                const composerJson = JSON.stringify(movement.composer).replace(/"/g, '&quot;');
                const workJson = JSON.stringify(movement.work).replace(/"/g, '&quot;');
                const movementJson = JSON.stringify(movement.movement).replace(/"/g, '&quot;');
                const midiUrlJson = JSON.stringify(movement.midiUrl).replace(/"/g, '&quot;');
                html += `<div class="movement-item result-item" data-type="movement"
                    data-composer="${composerJson}"
                    data-work="${workJson}"
                    data-movement="${movementJson}"
                    data-midi-url="${midiUrlJson}">
                    <div class="result-main">${movement.movement}</div>
                    <div class="result-sub">${movement.composer}, ${movement.work}</div>
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
                await this.selectComposer(composerName, false, false);
                await this.selectWork(workName);

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
                const workJson = JSON.stringify(work.name).replace(/"/g, '&quot;');
                return `<div class="work-item" data-work="${workJson}">${work.name}</div>`;
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

    async selectWork(workName) {
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
            const response = await fetch(`/api/composer/${encodeURIComponent(this.selectedComposer)}/work/${encodeURIComponent(workName)}/sections`);
            const movements = await response.json();

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
                movements.map(movement =>
                    `<option value='${JSON.stringify({ name: movement.name, midiUrl: movement.midiUrl })}'>${movement.name}</option>`
                ).join('');

            // Switch to Play tab and update display
            this.switchTab('play-music');
            this.updateWorkDisplay();

            // Auto-select and auto-load first movement in the dropdown
            if (movements.length > 0) {
                this.movementSelect.selectedIndex = 1; // Select the first movement (index 1 after the placeholder)

                // Auto-load the first movement
                const movementData = movements[0];
                const absoluteUrl = this.toAbsoluteUrl(movementData.midiUrl);
                this.loadMIDIFromURL(absoluteUrl, movementData.name);
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
            // Load recent works using RecentWorksManager
            const recentWorks = await this.recentWorksManager.loadFromServer();

            if (recentWorks.length === 0) {
                this.recentWorksDropdown.style.display = 'none';
                return;
            }

            // Show only the 5 most recent works
            const recentToShow = recentWorks.slice(0, 5);

            this.recentWorksSelect.innerHTML = '<option value="">Choose a recent work...</option>' +
                recentToShow.map(item => {
                    const displayText = item.movement
                        ? `${item.composer}, ${item.work} - ${item.movement}`
                        : `${item.composer}, ${item.work}`;
                    return `<option value='${JSON.stringify({ composer: item.composer, work: item.work })}'>
                        ${displayText}
                    </option>`;
                }).join('');
            this.recentWorksDropdown.style.display = 'block';
        } catch (error) {
            console.error('Error loading recent works:', error);
        }
    }

    async saveRecentWork(composer, work, movement = null) {
        try {
            // Save recent work using RecentWorksManager
            await this.recentWorksManager.saveToServer(composer, work, movement);
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

        // Check if URL points to an HTML page (copyright-protected works)
        if (url.endsWith('.html') || url.endsWith('.htm')) {
            this.showStatus('Sorry, this work is not publicly available for copyright reasons.', 'error');
            return;
        }

        try {
            this.showStatus('Loading MIDI file...', 'info');

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
                throw new MIDILoadError(errorMsg, absoluteMidiUrl);
            }

            const arrayBuffer = await response.arrayBuffer();
            this.midi = new Midi(arrayBuffer);

            if (!this.midi || !this.midi.tracks || this.midi.tracks.length === 0) {
                throw new MIDILoadError('Invalid MIDI file or no tracks found', absoluteMidiUrl);
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

            // Update UI
            this.updateMIDIInfo();

            // Update channels list based on voice part
            this.updateChannelsList();

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
                this.currentMovementName.textContent = `${this.selectedComposer}, ${this.selectedWork} - ${title}`;
                // Save recent work with movement
                await this.saveRecentWork(this.selectedComposer, this.selectedWork, title);
            } else if (title) {
                this.currentMovementName.textContent = title;
            }

            this.showStatus('MIDI file loaded successfully. Click Play when ready.', 'success');

            // Don't auto-play - let user click play when ready

        } catch (error) {
            console.error('Error loading MIDI:', error);

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

        this.showStatus('Loading required musical instruments...', 'info');

        try {
            // Load all instruments in parallel (with caching)
            const instrumentPromises = trackData.map(async ({ track, trackIndex }) => {
                const instrumentName = this.getInstrumentName(track);

                // Create a gain node for this track first
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 1.0; // Default volume (100%)
                gainNode.connect(audioContext.destination);

                try {
                    let instrument;

                    // Check cache first
                    if (this.instrumentCache.has(instrumentName)) {
                        // Get cached instrument and connect to new gain node
                        const cachedInstrument = this.instrumentCache.get(instrumentName);
                        // Note: Soundfont instruments need to be reloaded with new destination
                        // But we can still benefit from browser HTTP cache
                        instrument = await Soundfont.instrument(audioContext, instrumentName, {
                            soundfont: 'FluidR3_GM',
                            destination: gainNode,
                            nameToUrl: (name, soundfont, format) => {
                                format = format === 'ogg' ? format : 'mp3';
                                return `https://gleitz.github.io/midi-js-soundfonts/${soundfont}/${name}-${format}.js`;
                            }
                        });
                    } else {
                        // Load the SoundFont instrument (using FluidR3_GM for faster loading)
                        instrument = await Soundfont.instrument(audioContext, instrumentName, {
                            soundfont: 'FluidR3_GM',
                            destination: gainNode,
                            nameToUrl: (name, soundfont, format) => {
                                format = format === 'ogg' ? format : 'mp3';
                                return `https://gleitz.github.io/midi-js-soundfonts/${soundfont}/${name}-${format}.js`;
                            }
                        });

                        // Add to cache
                        this.addToInstrumentCache(instrumentName, instrument);
                    }

                    return { instrument, trackIndex, instrumentName, gainNode, success: true };

                } catch (error) {
                    console.error(`Failed to load ${instrumentName}, falling back to piano:`, error);

                    // Fallback to piano
                    try {
                        const instrument = await Soundfont.instrument(audioContext, 'acoustic_grand_piano', {
                            soundfont: 'FluidR3_GM',
                            destination: gainNode,
                            nameToUrl: (name, soundfont, format) => {
                                format = format === 'ogg' ? format : 'mp3';
                                return `https://gleitz.github.io/midi-js-soundfonts/${soundfont}/${name}-${format}.js`;
                            }
                        });

                        return { instrument, trackIndex, instrumentName: 'acoustic_grand_piano (fallback)', gainNode, success: false };
                    } catch (fallbackError) {
                        console.error(`Even piano fallback failed:`, fallbackError);
                        return null;
                    }
                }
            });

            // Wait for all instruments to load
            const loadedInstruments = await Promise.all(instrumentPromises);

            // Create gain nodes and parts for each loaded instrument
            let successCount = 0;
            let fallbackCount = 0;

            for (let i = 0; i < loadedInstruments.length; i++) {
                const result = loadedInstruments[i];
                if (!result) continue;

                const { instrument, trackIndex, instrumentName, gainNode, success } = result;
                const track = this.midi.tracks[trackIndex];

                if (success) {
                    successCount++;
                } else {
                    fallbackCount++;
                }

                // Use the gain node that was created during instrument loading
                this.instruments.push({ instrument, gainNode, trackIndex });
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
                    const { instrument } = this.instruments[instrumentIndex];
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

            // Ensure Tone.js is ready and audio context is running
            await Tone.start();

            // Resume audio context if it's suspended
            if (Tone.context.state !== 'running') {
                await Tone.context.resume();
            }

            let statusMsg = `All instruments loaded! (${successCount} loaded`;
            if (fallbackCount > 0) {
                statusMsg += `, ${fallbackCount} using piano fallback`;
            }
            statusMsg += ')';
            this.showStatus(statusMsg, 'success');

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
        // Apply master volume and balance to all instruments
        if (!this.instruments || this.instruments.length === 0) return;

        for (let i = 0; i < this.instruments.length; i++) {
            const { instrument, gainNode, trackIndex } = this.instruments[i];

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

            // Apply master volume and balance
            gainNode.gain.value = this.masterVolume * volumeMultiplier;
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

        // Ensure currentTime is within valid range
        if (this.currentTime < 0 || this.currentTime >= this.originalDuration) {
            this.currentTime = 0;
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

        // Stop and cancel everything completely
        this.parts.forEach(part => {
            part.stop(0);  // Pass explicit 0 to avoid floating-point precision issues
            part.cancel();
        });

        Tone.Transport.stop();
        Tone.Transport.cancel();

        // time parameter is in original time
        this.currentTime = Math.max(0, Math.min(this.originalDuration, time));

        // Update UI
        this.currentTimeDisplay.textContent = formatTime(this.currentTime);
        this.progressBar.value = (this.currentTime / this.originalDuration) * 100;

        // Update current bar display
        const currentBar = this.getCurrentBar();
        if (currentBar && this.currentBarDisplay) {
            this.currentBarDisplay.textContent = `Bar: ${currentBar}`;
        }

        // Convert original time to scaled time for Transport
        const scaledTime = this.currentTime / this.tempoMultiplier;
        Tone.Transport.seconds = scaledTime;

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

        // Update BPM in Transport
        if (this.midi && this.midi.header.tempos.length > 0) {
            const originalBPM = this.midi.header.tempos[0].bpm;
            Tone.Transport.bpm.value = originalBPM * this.tempoMultiplier;
        }

        this.tempoValue.textContent = tempoPercent;

        // Update actual duration based on tempo
        // Slower tempo = longer duration
        this.duration = this.originalDuration / this.tempoMultiplier;

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
                // Transport.seconds is in scaled time (affected by tempo)
                // Convert back to original time for display and loop logic
                const transportTime = Tone.Transport.seconds;
                this.currentTime = transportTime * this.tempoMultiplier;

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
                    // End of movement reached without loop set - advance to next movement
                    const currentIndex = this.movementSelect.selectedIndex;
                    const totalMovements = this.movementSelect.options.length;

                    if (currentIndex < totalMovements - 1 && currentIndex > 0) {
                        // Auto-advance to next movement
                        this.skipToNextMovement();
                    } else {
                        // Last movement - loop back to start of current movement
                        this.seekTo(0);
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
    addToInstrumentCache(instrumentName, instrument) {
        // Delegate to InstrumentLoader
        this.instrumentLoader.addToCache(instrumentName, instrument);
        // Also keep local cache for compatibility
        if (this.instrumentCache.size >= this.maxCacheSize) {
            const firstKey = this.instrumentCache.keys().next().value;
            this.instrumentCache.delete(firstKey);
        }
        this.instrumentCache.set(instrumentName, instrument);
    }

    // Pre-load common instruments in the background to speed up playback
    async preloadCommonInstruments() {
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
