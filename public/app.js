// MIDI Player Application
class MIDIPlayer {
    constructor() {
        this.midi = null;
        this.synths = [];
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
        // Create synths and parts for each track
        this.synths = [];
        this.parts = [];

        for (let i = 0; i < this.midi.tracks.length; i++) {
            const track = this.midi.tracks[i];

            // Skip empty tracks
            if (track.notes.length === 0) continue;

            // Create a polyphonic synth for this track
            const synth = new Tone.PolySynth(Tone.Synth, {
                oscillator: {
                    type: 'triangle'
                },
                envelope: {
                    attack: 0.005,
                    decay: 0.1,
                    sustain: 0.3,
                    release: 0.5
                }
            }).toDestination();

            // Set initial volume
            synth.volume.value = -10;

            this.synths.push(synth);
            this.channelVolumes[i] = 100;

            // Create a Tone.Part for this track
            const notes = track.notes.map(note => ({
                time: note.time,
                note: note.name,
                duration: note.duration,
                velocity: note.velocity
            }));

            const part = new Tone.Part((time, value) => {
                synth.triggerAttackRelease(
                    value.note,
                    value.duration,
                    time,
                    value.velocity
                );
            }, notes);

            this.parts.push(part);
        }

        // Ensure Tone.js is ready
        await Tone.start();
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

        for (let i = 0; i < this.synths.length; i++) {
            const track = this.midi.tracks[i];
            const channelDiv = document.createElement('div');
            channelDiv.className = 'channel-item';

            const trackName = track.name || `Channel ${i + 1}`;
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
        if (channelIndex >= 0 && channelIndex < this.synths.length) {
            // Convert percentage to decibels
            // 100% = -10dB (default), 0% = -Infinity, 200% = +10dB
            let db;
            if (volumePercent === 0) {
                db = -Infinity;
            } else {
                // Map 0-200 to -Infinity to +10
                // At 100%, db = -10
                // At 200%, db = +10
                db = -10 + ((volumePercent - 100) * 0.2);
            }

            this.synths[channelIndex].volume.value = db;
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

        // Update button visibility
        this.playBtn.style.display = 'inline-flex';
        this.pauseBtn.style.display = 'none';

        // Update UI
        this.currentTimeDisplay.textContent = '0:00';
        this.progressBar.value = 0;

        // Stop progress update
        this.stopProgressUpdate();
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
        // Dispose of all synths
        this.synths.forEach(synth => {
            synth.dispose();
        });

        // Clear all parts
        this.parts.forEach(part => {
            part.dispose();
        });

        this.synths = [];
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
