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
        this.tempoMultiplier = 1;
        this.channelVolumes = {};
        this.progressInterval = null;

        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        // Input elements
        this.midiUrlInput = document.getElementById('midi-url');
        this.loadBtn = document.getElementById('load-btn');
        this.loadingStatus = document.getElementById('loading-status');

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
        this.midiDuration = document.getElementById('midi-duration');
        this.currentTimeDisplay = document.getElementById('current-time');

        // Progress bar
        this.progressBar = document.getElementById('progress-bar');

        // Tempo controls
        this.tempoSlider = document.getElementById('tempo-slider');
        this.tempoValue = document.getElementById('tempo-value');
        this.tempoUpBtn = document.getElementById('tempo-up');
        this.tempoDownBtn = document.getElementById('tempo-down');

        // Channel controls
        this.channelVolumesContainer = document.getElementById('channel-volumes');
    }

    attachEventListeners() {
        this.loadBtn.addEventListener('click', () => this.loadMIDI());
        this.midiUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadMIDI();
        });

        this.playBtn.addEventListener('click', () => this.play());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.stopBtn.addEventListener('click', () => this.stop());

        this.backwardBtn.addEventListener('click', () => this.seek(-10));
        this.forwardBtn.addEventListener('click', () => this.seek(10));

        this.progressBar.addEventListener('input', (e) => {
            const newTime = (e.target.value / 100) * this.duration;
            this.seekTo(newTime);
        });

        this.tempoSlider.addEventListener('input', (e) => {
            this.setTempo(parseInt(e.target.value));
        });

        this.tempoUpBtn.addEventListener('click', () => {
            const newTempo = Math.min(200, parseInt(this.tempoSlider.value) + 10);
            this.tempoSlider.value = newTempo;
            this.setTempo(newTempo);
        });

        this.tempoDownBtn.addEventListener('click', () => {
            const newTempo = Math.max(25, parseInt(this.tempoSlider.value) - 10);
            this.tempoSlider.value = newTempo;
            this.setTempo(newTempo);
        });
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

    async loadMIDI() {
        const url = this.midiUrlInput.value.trim();

        if (!url) {
            this.showStatus('Please enter a MIDI file URL', 'error');
            return;
        }

        try {
            this.loadBtn.disabled = true;
            this.showStatus('Loading MIDI file...', 'info');

            // Stop any currently playing MIDI
            this.stop();
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

            this.duration = this.midi.duration;

            // Setup the MIDI playback
            await this.setupPlayback();

            // Update UI
            this.updateMIDIInfo();
            this.createChannelControls();
            this.controlsSection.style.display = 'block';

            this.showStatus('MIDI file loaded successfully!', 'success');

        } catch (error) {
            console.error('Error loading MIDI:', error);
            this.showStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.loadBtn.disabled = false;
        }
    }

    async setupPlayback() {
        // Create instruments and parts for each track
        this.synths = [];
        this.parts = [];
        this.instruments = [];

        // Initialize instrument cache if not exists
        if (!window.instrumentCache) {
            window.instrumentCache = {};
        }

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

        const totalTracks = trackData.length;
        this.showStatus(`Loading ${totalTracks} instruments in parallel...`, 'info');

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
                    // Check if we need to create a new instrument or can share from cache
                    let instrument;
                    const cacheKey = instrumentName;

                    // Note: We can't share instruments between tracks if we need individual volume control
                    // Each track needs its own instrument instance connected to its own gain node

                    // Load the SoundFont instrument (using FluidR3_GM for faster loading)
                    instrument = await Soundfont.instrument(audioContext, instrumentName, {
                        soundfont: 'FluidR3_GM',
                        destination: gainNode, // Connect to our gain node for volume control
                        // Use remote SoundFont repository
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
                            destination: gainNode, // Connect to our gain node for volume control
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
                this.synths.push(instrument); // Keep for compatibility
                this.channelVolumes[trackIndex] = 100;

                // Create a Tone.Part for this track
                const notes = track.notes.map(note => ({
                    time: note.time,
                    note: note.name,
                    duration: note.duration,
                    velocity: note.velocity
                }));

                const instrumentIndex = this.instruments.length - 1;
                const part = new Tone.Part((time, value) => {
                    // Schedule the note with SoundFont instrument
                    // Note: The instrument is already connected to the gain node
                    // The gain control happens via the gainNode.gain.value
                    const { instrument } = this.instruments[instrumentIndex];

                    // Play the note at the scheduled time
                    // The 'time' parameter from Tone.Part is already the correct AudioContext time
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

            // Ensure Tone.js is ready
            await Tone.start();

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
        // Extract title from URL or use filename
        const url = this.midiUrlInput.value;
        const filename = url.split('/').pop().split('?')[0];
        this.midiTitle.textContent = this.midi.name || filename || 'Untitled';

        this.midiDuration.textContent = this.formatTime(this.duration);
        this.currentTimeDisplay.textContent = '0:00';
        this.progressBar.value = 0;
    }

    createChannelControls() {
        this.channelVolumesContainer.innerHTML = '';

        for (let i = 0; i < this.instruments.length; i++) {
            const trackIndex = this.instruments[i].trackIndex;
            const track = this.midi.tracks[trackIndex];
            const channelDiv = document.createElement('div');
            channelDiv.className = 'channel-item';

            const trackName = track.name || `Channel ${trackIndex + 1}`;
            const instrumentName = track.instrument?.name || 'Unknown';

            channelDiv.innerHTML = `
                <div class="channel-header">
                    <div class="channel-name">${trackName} (${instrumentName})</div>
                    <div class="channel-volume-value" id="channel-value-${i}">100%</div>
                </div>
                <div class="channel-slider-container">
                    <span class="volume-label">Quiet</span>
                    <input
                        type="range"
                        class="channel-slider"
                        id="channel-${i}"
                        min="0"
                        max="200"
                        value="100"
                        data-channel="${i}"
                    >
                    <span class="volume-label">Loud</span>
                </div>
            `;

            this.channelVolumesContainer.appendChild(channelDiv);

            // Attach event listener
            const slider = channelDiv.querySelector(`#channel-${i}`);
            const valueDisplay = channelDiv.querySelector(`#channel-value-${i}`);

            slider.addEventListener('input', (e) => {
                const volume = parseInt(e.target.value);
                this.setChannelVolume(i, volume);
                valueDisplay.textContent = `${volume}%`;
            });
        }
    }

    setChannelVolume(channelIndex, volumePercent) {
        if (channelIndex >= 0 && channelIndex < this.instruments.length) {
            // Convert percentage to gain value
            // 0% = 0 (silent), 100% = 1.0 (normal), 200% = 2.0 (amplified)
            const gain = volumePercent / 100;

            this.instruments[channelIndex].gainNode.gain.value = gain;
            this.channelVolumes[channelIndex] = volumePercent;
        }
    }

    play() {
        if (!this.midi) {
            this.showStatus('Please load a MIDI file first', 'error');
            return;
        }

        if (this.isPlaying) return;

        // Start all parts
        this.parts.forEach(part => {
            part.start(Tone.now(), this.currentTime);
        });

        Tone.Transport.start();
        this.isPlaying = true;

        // Update button visibility
        this.playBtn.style.display = 'none';
        this.pauseBtn.style.display = 'inline-flex';

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
        this.parts.forEach(part => {
            part.stop();
        });

        // Immediately stop all playing notes
        this.stopAllNotes();

        // Update button visibility
        this.playBtn.style.display = 'inline-flex';
        this.pauseBtn.style.display = 'none';

        // Update UI
        this.currentTimeDisplay.textContent = '0:00';
        this.progressBar.value = 0;

        // Stop progress update
        this.stopProgressUpdate();
    }

    stopAllNotes() {
        // Immediately stop all playing notes on all instruments
        if (this.instruments) {
            this.instruments.forEach(({ instrument }) => {
                if (instrument && typeof instrument.stop === 'function') {
                    instrument.stop();
                }
            });
        }
    }

    seek(seconds) {
        const newTime = Math.max(0, Math.min(this.duration, this.currentTime + seconds));
        this.seekTo(newTime);
    }

    seekTo(time) {
        const wasPlaying = this.isPlaying;

        if (this.isPlaying) {
            this.pause();
        }

        this.currentTime = Math.max(0, Math.min(this.duration, time));

        // Update UI
        this.currentTimeDisplay.textContent = this.formatTime(this.currentTime);
        this.progressBar.value = (this.currentTime / this.duration) * 100;

        // Restart parts at new position
        this.parts.forEach(part => {
            part.stop();
        });

        Tone.Transport.seconds = this.currentTime;

        if (wasPlaying) {
            this.play();
        }
    }

    setTempo(tempoPercent) {
        this.tempoMultiplier = tempoPercent / 100;

        // Update BPM in Transport
        if (this.midi && this.midi.header.tempos.length > 0) {
            const originalBPM = this.midi.header.tempos[0].bpm;
            Tone.Transport.bpm.value = originalBPM * this.tempoMultiplier;
        }

        this.tempoValue.textContent = tempoPercent;
    }

    startProgressUpdate() {
        this.stopProgressUpdate();

        this.progressInterval = setInterval(() => {
            if (this.isPlaying) {
                this.currentTime = Tone.Transport.seconds;

                // Check if we've reached the end
                if (this.currentTime >= this.duration) {
                    this.stop();
                    return;
                }

                // Update UI
                this.currentTimeDisplay.textContent = this.formatTime(this.currentTime);
                this.progressBar.value = (this.currentTime / this.duration) * 100;
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
        // Stop all instruments
        if (this.instruments) {
            this.instruments.forEach(({ instrument, gainNode }) => {
                // Stop all playing notes
                if (instrument && instrument.stop) {
                    instrument.stop();
                }
                // Disconnect gain node
                if (gainNode) {
                    gainNode.disconnect();
                }
            });
        }

        // Clear all parts
        this.parts.forEach(part => {
            part.dispose();
        });

        this.synths = [];
        this.instruments = [];
        this.parts = [];
        this.midi = null;
        this.currentTime = 0;
        this.duration = 0;

        this.controlsSection.style.display = 'none';
    }
}

// Initialize the player when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.midiPlayer = new MIDIPlayer();
});
