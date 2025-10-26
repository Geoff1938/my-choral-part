// MIDI Player Application
class MIDIPlayer {
    constructor() {
        this.midi = null;
        this.synths = [];
        this.instruments = [];
        this.parts = [];
        this.isPlaying = false;
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

        // Mapping of voice parts to MIDI instrument names
        this.voicePartInstruments = {
            soprano: 'piccolo',
            alto: 'clarinet',
            tenor: 'french_horn',
            bass: 'bassoon'
        };

        this.initializeElements();
        this.loadPreferences();
        this.attachEventListeners();
        this.loadRecentWorks();
    }

    initializeElements() {
        // MIDI selection elements
        this.composerSearch = document.getElementById('composer-search');
        this.composerResults = document.getElementById('composer-results');
        this.worksContainer = document.getElementById('works-container');
        this.worksList = document.getElementById('works-list');
        this.sectionsContainer = document.getElementById('sections-container');
        this.sectionSelect = document.getElementById('section-select');
        this.recentWorksContainer = document.getElementById('recent-works-container');
        this.recentWorksList = document.getElementById('recent-works-list');
        this.loadingStatus = document.getElementById('loading-status');

        // State for current selection
        this.selectedComposer = null;
        this.selectedWork = null;
        this.searchTimeout = null;

        // Voice part selector
        this.voicePartSelect = document.getElementById('voice-part');
        this.channelSelectorContainer = document.getElementById('channel-selector-container');
        this.channelSelector = document.getElementById('channel-selector');

        // Control section
        this.controlsSection = document.getElementById('controls-section');

        // Playback controls
        this.playBtn = document.getElementById('play-btn');
        this.pauseBtn = document.getElementById('pause-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.backwardBtn = document.getElementById('backward-btn');
        this.forwardBtn = document.getElementById('forward-btn');

        // Info displays
        this.midiTitle = document.getElementById('midi-title');

        // Progress bar
        this.progressBar = document.getElementById('progress-bar');
        this.progressDuration = document.getElementById('progress-duration');
        this.currentTimeDisplay = document.getElementById('current-time');

        // Loop controls
        this.loopStartSlider = document.getElementById('loop-start-slider');
        this.loopEndSlider = document.getElementById('loop-end-slider');
        this.loopRangeDisplay = document.getElementById('loop-range-display');
        this.loopHighlight = document.getElementById('loop-highlight');

        // Tempo controls
        this.tempoSlider = document.getElementById('tempo-slider');
        this.tempoValue = document.getElementById('tempo-value');
        this.tempoUpBtn = document.getElementById('tempo-up');
        this.tempoDownBtn = document.getElementById('tempo-down');

        // Volume controls
        this.masterVolumeSlider = document.getElementById('master-volume');
        this.masterVolumeValue = document.getElementById('master-volume-value');
        this.balanceSlider = document.getElementById('balance-slider');
        this.balanceValue = document.getElementById('balance-value');
    }

    loadPreferences() {
        // Load voice part from localStorage
        const savedVoicePart = localStorage.getItem('voicePart');
        if (savedVoicePart && this.voicePartSelect) {
            this.voicePart = savedVoicePart;
            this.voicePartSelect.value = savedVoicePart;
        }
    }

    savePreferences() {
        localStorage.setItem('voicePart', this.voicePart);
    }

    attachEventListeners() {
        // Composer search with debounce
        this.composerSearch.addEventListener('input', (e) => {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => {
                this.searchComposers(e.target.value);
            }, 300);
        });

        // Section selection
        this.sectionSelect.addEventListener('change', (e) => {
            console.log('Section dropdown changed, value:', e.target.value);
            if (e.target.value) {
                try {
                    const sectionData = JSON.parse(e.target.value);
                    console.log('Parsed section data:', sectionData);
                    this.loadMIDIFromURL(sectionData.midiUrl, sectionData.name);
                } catch (error) {
                    console.error('Error parsing section data:', error);
                    this.showStatus('Error loading section', 'error');
                }
            }
        });

        // Voice part selection
        this.voicePartSelect.addEventListener('change', (e) => {
            this.voicePart = e.target.value;
            this.savePreferences();
            this.updateChannelSelector(); // Update channel options if multiple exist
            this.applyBalance(); // Reapply balance with new voice part
        });

        // Channel selector (for when multiple channels have same instrument)
        this.channelSelector.addEventListener('change', (e) => {
            this.selectedChannelIndex = parseInt(e.target.value);
            this.applyBalance();
        });

        this.playBtn.addEventListener('click', () => this.play());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.stopBtn.addEventListener('click', () => this.stop());

        this.backwardBtn.addEventListener('click', () => this.seek(-10));
        this.forwardBtn.addEventListener('click', () => this.seek(10));

        this.progressBar.addEventListener('input', (e) => {
            const newTime = (e.target.value / 100) * this.originalDuration;
            this.seekTo(newTime);
        });

        // Loop controls
        this.loopStartSlider.addEventListener('input', (e) => {
            let startPercent = parseInt(e.target.value);
            let endPercent = parseInt(this.loopEndSlider.value);

            // Don't let start go past end
            if (startPercent > endPercent) {
                startPercent = endPercent;
                e.target.value = startPercent;
            }

            this.loopStart = (startPercent / 100) * this.originalDuration;
            this.updateLoopDisplay();
        });

        this.loopEndSlider.addEventListener('input', (e) => {
            let endPercent = parseInt(e.target.value);
            let startPercent = parseInt(this.loopStartSlider.value);

            // Don't let end go before start
            if (endPercent < startPercent) {
                endPercent = startPercent;
                e.target.value = endPercent;
            }

            this.loopEnd = (endPercent / 100) * this.originalDuration;
            this.updateLoopDisplay();
        });

        this.tempoSlider.addEventListener('input', (e) => {
            this.setTempo(parseInt(e.target.value));
        });

        this.tempoUpBtn.addEventListener('click', () => {
            const newTempo = Math.min(120, parseInt(this.tempoSlider.value) + 5);
            this.tempoSlider.value = newTempo;
            this.setTempo(newTempo);
        });

        this.tempoDownBtn.addEventListener('click', () => {
            const newTempo = Math.max(60, parseInt(this.tempoSlider.value) - 5);
            this.tempoSlider.value = newTempo;
            this.setTempo(newTempo);
        });

        // Volume controls
        this.masterVolumeSlider.addEventListener('input', (e) => {
            this.masterVolume = parseInt(e.target.value) / 100;
            this.masterVolumeValue.textContent = e.target.value;
            this.applyBalance();
        });

        this.balanceSlider.addEventListener('input', (e) => {
            this.balance = parseInt(e.target.value);
            this.balanceValue.textContent = e.target.value;
            this.applyBalance();
        });
    }

    updateLoopDisplay() {
        // Update the display text
        this.loopRangeDisplay.textContent = `${this.formatTime(this.loopStart)} - ${this.formatTime(this.loopEnd)}`;

        // Update the visual highlight
        const startPercent = (this.loopStart / this.originalDuration) * 100;
        const endPercent = (this.loopEnd / this.originalDuration) * 100;
        const width = endPercent - startPercent;

        this.loopHighlight.style.left = `${startPercent}%`;
        this.loopHighlight.style.width = `${width}%`;
    }

    updateChannelSelector() {
        // Find all channels that match the selected voice part instrument
        const selectedInstrument = this.voicePartInstruments[this.voicePart];
        const matchingChannels = [];

        if (this.instruments && this.instruments.length > 0) {
            for (let i = 0; i < this.instruments.length; i++) {
                const { trackIndex } = this.instruments[i];
                const track = this.midi.tracks[trackIndex];
                const instrumentName = this.getInstrumentName(track);

                if (instrumentName === selectedInstrument) {
                    matchingChannels.push({
                        index: i,
                        name: track.name || `Channel ${trackIndex + 1}`
                    });
                }
            }
        }

        // If multiple channels found, show selector
        if (matchingChannels.length > 1) {
            this.channelSelector.innerHTML = '';
            matchingChannels.forEach(channel => {
                const option = document.createElement('option');
                option.value = channel.index;
                option.textContent = channel.name;
                this.channelSelector.appendChild(option);
            });
            this.channelSelectorContainer.style.display = 'flex';
            this.selectedChannelIndex = matchingChannels[0].index;
        } else if (matchingChannels.length === 1) {
            // Only one channel, select it automatically
            this.selectedChannelIndex = matchingChannels[0].index;
            this.channelSelectorContainer.style.display = 'none';
        } else {
            // No matching channels
            this.selectedChannelIndex = null;
            this.channelSelectorContainer.style.display = 'none';
        }
    }

    async searchComposers(searchTerm) {
        if (!searchTerm || searchTerm.length < 2) {
            this.composerResults.innerHTML = '';
            this.composerResults.style.display = 'none';
            return;
        }

        try {
            const response = await fetch(`/api/search/composers?q=${encodeURIComponent(searchTerm)}`);
            const composers = await response.json();

            if (composers.length === 0) {
                this.composerResults.innerHTML = '<div class="no-results">No composers found</div>';
                this.composerResults.style.display = 'block';
                return;
            }

            this.composerResults.innerHTML = composers.map(composer =>
                `<div class="composer-item" data-composer='${JSON.stringify(composer.name)}'>${composer.name}</div>`
            ).join('');
            this.composerResults.style.display = 'block';

            // Add click handlers to composer items
            this.composerResults.querySelectorAll('.composer-item').forEach(item => {
                item.addEventListener('click', () => {
                    const composerName = JSON.parse(item.dataset.composer);
                    this.selectComposer(composerName);
                });
            });
        } catch (error) {
            console.error('Error searching composers:', error);
            this.showStatus('Error searching composers', 'error');
        }
    }

    async selectComposer(composerName) {
        this.selectedComposer = composerName;
        this.composerSearch.value = composerName;
        this.composerResults.style.display = 'none';

        try {
            const response = await fetch(`/api/composer/${encodeURIComponent(composerName)}/works`);
            const works = await response.json();

            if (works.length === 0) {
                this.showStatus('No works found for this composer', 'error');
                return;
            }

            this.worksList.innerHTML = works.map(work =>
                `<div class="work-item" data-work='${JSON.stringify(work.name)}'>${work.name}</div>`
            ).join('');
            this.worksContainer.style.display = 'block';

            // Add click handlers to work items
            this.worksList.querySelectorAll('.work-item').forEach(item => {
                item.addEventListener('click', () => {
                    const workName = JSON.parse(item.dataset.work);
                    this.selectWork(workName);
                });
            });

            // Hide sections container when showing works
            this.sectionsContainer.style.display = 'none';
        } catch (error) {
            console.error('Error loading works:', error);
            this.showStatus('Error loading works', 'error');
        }
    }

    async selectWork(workName) {
        this.selectedWork = workName;

        // Highlight selected work
        this.worksList.querySelectorAll('.work-item').forEach(item => {
            item.classList.remove('selected');
            if (JSON.parse(item.dataset.work) === workName) {
                item.classList.add('selected');
            }
        });

        try {
            const response = await fetch(`/api/composer/${encodeURIComponent(this.selectedComposer)}/work/${encodeURIComponent(workName)}/sections`);
            const sections = await response.json();

            if (sections.length === 0) {
                this.showStatus('No sections found for this work', 'error');
                return;
            }

            this.sectionSelect.innerHTML = '<option value="">Choose a section...</option>' +
                sections.map(section =>
                    `<option value='${JSON.stringify({ name: section.name, midiUrl: section.midiUrl })}'>${section.name}</option>`
                ).join('');
            this.sectionsContainer.style.display = 'block';

            // Save to recent works
            await this.saveRecentWork(this.selectedComposer, workName);
        } catch (error) {
            console.error('Error loading sections:', error);
            this.showStatus('Error loading sections', 'error');
        }
    }

    async loadRecentWorks() {
        try {
            const response = await fetch('/api/recent-works');
            const recentWorks = await response.json();

            if (recentWorks.length === 0) {
                this.recentWorksContainer.style.display = 'none';
                return;
            }

            this.recentWorksList.innerHTML = recentWorks.map(item =>
                `<div class="recent-work-item" data-composer='${JSON.stringify(item.composer)}' data-work='${JSON.stringify(item.work)}'>
                    ${item.composer} - ${item.work}
                </div>`
            ).join('');
            this.recentWorksContainer.style.display = 'block';

            // Add click handlers
            this.recentWorksList.querySelectorAll('.recent-work-item').forEach(item => {
                item.addEventListener('click', () => {
                    const composer = JSON.parse(item.dataset.composer);
                    const work = JSON.parse(item.dataset.work);
                    this.selectComposer(composer).then(() => {
                        this.selectWork(work);
                    });
                });
            });
        } catch (error) {
            console.error('Error loading recent works:', error);
        }
    }

    async saveRecentWork(composer, work) {
        try {
            await fetch('/api/recent-works', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ composer, work })
            });
            // Reload recent works list
            await this.loadRecentWorks();
        } catch (error) {
            console.error('Error saving recent work:', error);
        }
    }

    showStatus(message, type = 'info') {
        this.loadingStatus.textContent = message;
        this.loadingStatus.className = `status-message show ${type}`;

        if (type === 'success') {
            setTimeout(() => {
                this.loadingStatus.classList.remove('show');
            }, 3000);
        }
    }

    async loadMIDIFromURL(url, title = null) {
        console.log(`=== loadMIDIFromURL called with URL: ${url}`);

        if (!url) {
            this.showStatus('Invalid MIDI URL', 'error');
            return;
        }

        try {
            this.showStatus('Loading MIDI file...', 'info');

            // Stop any currently playing MIDI
            console.log('Calling stop()...');
            this.stop();
            console.log('Calling cleanup()...');
            this.cleanup();

            // Fetch and parse MIDI file via proxy to avoid CORS issues
            const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch MIDI file: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            this.midi = new Midi(arrayBuffer);

            if (!this.midi || !this.midi.tracks || this.midi.tracks.length === 0) {
                throw new Error('Invalid MIDI file or no tracks found');
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
            console.log(`Earliest note at ${earliestNote}s, skipping ${this.skipToTime}s of leading silence`);

            // Adjust duration to account for removed leading silence
            this.originalDuration = this.midi.duration - this.skipToTime;
            this.duration = this.originalDuration;
            console.log(`Adjusted duration: ${this.originalDuration}s (was ${this.midi.duration}s)`);

            // Setup the MIDI playback
            await this.setupPlayback();

            // Update title if provided
            if (title && this.midiTitle) {
                this.midiTitle.textContent = `${this.selectedComposer} - ${this.selectedWork}: ${title}`;
            } else if (this.midiTitle) {
                this.midiTitle.textContent = this.midi.name || 'Untitled';
            }

            // Update UI
            this.updateMIDIInfo();
            this.controlsSection.style.display = 'block';

            // Initialize loop to full duration
            this.loopStart = 0;
            this.loopEnd = this.originalDuration;
            if (this.loopStartSlider) this.loopStartSlider.value = 0;
            if (this.loopEndSlider) this.loopEndSlider.value = 100;
            this.updateLoopDisplay();

            // Update channel selector based on voice part
            this.updateChannelSelector();

            this.showStatus('MIDI file loaded successfully!', 'success');

            // Auto-play after loading
            setTimeout(() => this.play(), 500);

        } catch (error) {
            console.error('Error loading MIDI:', error);
            this.showStatus(`Error: ${error.message}`, 'error');
        }
    }

    async setupPlayback() {
        // Create instruments and parts for each track
        this.synths = [];
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
            // Load all instruments in parallel
            const instrumentPromises = trackData.map(async ({ track, trackIndex }) => {
                const instrumentName = this.getInstrumentName(track);
                console.log(`Track ${trackIndex}: ${track.name}, Instrument: ${instrumentName}`);

                // Create a gain node for this track first
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 1.0; // Default volume (100%)
                gainNode.connect(audioContext.destination);

                try {
                    // Load the SoundFont instrument (using FluidR3_GM for faster loading)
                    const instrument = await Soundfont.instrument(audioContext, instrumentName, {
                        soundfont: 'FluidR3_GM',
                        destination: gainNode,
                        nameToUrl: (name, soundfont, format) => {
                            format = format === 'ogg' ? format : 'mp3';
                            return `https://gleitz.github.io/midi-js-soundfonts/${soundfont}/${name}-${format}.js`;
                        }
                    });

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
                this.synths.push(instrument);
                this.channelVolumes[trackIndex] = 100;

                // Create a Tone.Part for this track with tempo scaling
                // Subtract skipToTime to remove leading silence from the timeline
                const tempoScale = 1 / this.tempoMultiplier;
                const notes = track.notes.map(note => ({
                    time: (note.time - this.skipToTime) * tempoScale,
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

            console.log(`Audio context state: ${Tone.context.state}`);
            console.log(`Loaded ${this.instruments.length} instruments`);
            console.log(`Created ${this.parts.length} parts`);

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
        // MIDI General MIDI instrument mapping
        // If track has instrument info, use it
        if (track.instrument) {
            const program = track.instrument.number;
            return this.midiProgramToInstrument(program);
        }

        // Default to acoustic_grand_piano
        return 'acoustic_grand_piano';
    }

    midiProgramToInstrument(program) {
        // General MIDI instrument names (program 0-127)
        const gmInstruments = [
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

        if (program >= 0 && program < gmInstruments.length) {
            return gmInstruments[program];
        }

        return 'acoustic_grand_piano';
    }

    updateMIDIInfo() {
        // The title is set by loadMIDIFromURL, so just update the progress UI
        // Update progress duration label and current time
        if (this.progressDuration) {
            this.progressDuration.textContent = this.formatTime(this.originalDuration);
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
                // Balance > 0 means make this part louder
                if (this.balance > 0) {
                    volumeMultiplier = 1.0 + (this.balance / 100);
                } else if (this.balance < 0) {
                    volumeMultiplier = 1.0 + (this.balance / 100);
                }
            } else {
                // This is not the user's part
                // Balance > 0 means make other parts quieter
                if (this.balance > 0) {
                    volumeMultiplier = 1.0 - (this.balance / 100);
                } else if (this.balance < 0) {
                    volumeMultiplier = 1.0 - (this.balance / 100);
                }
            }

            // Ensure volume doesn't go negative
            volumeMultiplier = Math.max(0, volumeMultiplier);

            // Apply master volume and balance
            gainNode.gain.value = this.masterVolume * volumeMultiplier;
        }
    }


    play() {
        if (!this.midi) {
            this.showStatus('Please load a MIDI file first', 'error');
            return;
        }

        if (this.isPlaying) return;

        console.log(`Playing: ${this.parts.length} parts, ${this.instruments.length} instruments`);
        console.log(`Current time offset: ${this.currentTime}`);

        // Ensure currentTime is within valid range
        if (this.currentTime < 0 || this.currentTime >= this.originalDuration) {
            console.log(`Resetting invalid currentTime ${this.currentTime} to 0`);
            this.currentTime = 0;
        }

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
                    part.stop();
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

    seekTo(time) {
        const wasPlaying = this.isPlaying;

        if (this.isPlaying) {
            this.pause();
        }

        // time parameter is in original time
        this.currentTime = Math.max(0, Math.min(this.originalDuration, time));

        // Update UI
        this.currentTimeDisplay.textContent = this.formatTime(this.currentTime);
        this.progressBar.value = (this.currentTime / this.originalDuration) * 100;

        // Restart parts at new position
        this.parts.forEach(part => {
            part.stop();
        });

        // Convert original time to scaled time for Transport
        const scaledTime = this.currentTime / this.tempoMultiplier;
        Tone.Transport.seconds = scaledTime;

        if (wasPlaying) {
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
            const tempoScale = 1 / this.tempoMultiplier;

            const notes = track.notes.map(note => ({
                time: note.time * tempoScale,
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
                // If loop range is not full duration, loop within that range
                const loopRangeSet = (this.loopStart > 0 || this.loopEnd < this.originalDuration - 0.5);

                if (loopRangeSet && this.currentTime >= this.loopEnd) {
                    // Loop back to loop start
                    this.seekTo(this.loopStart);
                    return;
                } else if (!loopRangeSet && this.currentTime >= this.originalDuration) {
                    // Full song loop: restart from beginning
                    this.seekTo(0);
                    return;
                }

                // Update UI - current time and progress bar
                this.currentTimeDisplay.textContent = this.formatTime(this.currentTime);
                this.progressBar.value = (this.currentTime / this.originalDuration) * 100;
            }
        }, 100);
    }

    stopProgressUpdate() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    cleanup() {
        console.log('Cleanup called');
        console.log(`Before cleanup: ${this.instruments.length} instruments, ${this.parts.length} parts`);
        console.log(`Transport.seconds before cleanup: ${Tone.Transport.seconds}`);

        // Stop and cancel all transport events
        Tone.Transport.stop();
        Tone.Transport.cancel();

        // Reset transport position to 0
        Tone.Transport.seconds = 0;
        console.log(`Transport.seconds after reset: ${Tone.Transport.seconds}`);

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
                    part.stop();
                    part.dispose();
                } catch (e) {
                    // Ignore disposal errors
                }
            });
        }

        this.synths = [];
        this.instruments = [];
        this.parts = [];
        this.midi = null;
        this.currentTime = 0;
        this.duration = 0;
        this.originalDuration = 0;
        this.isPlaying = false;

        console.log('Cleanup complete - currentTime reset to:', this.currentTime);

        // Don't hide controls section - we might be loading a new MIDI
        // this.controlsSection.style.display = 'none';
    }
}

// Initialize the player when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.midiPlayer = new MIDIPlayer();
});
