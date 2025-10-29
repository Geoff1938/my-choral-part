// MIDI Player Application
class MIDIPlayer {
    constructor() {
        // Base URL for all MIDI files (stored separately to reduce JSON size)
        this.baseUrl = 'https://www.learnchoralmusic.co.uk';

        this.midi = null;
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

        // Instrument cache for reusing loaded Soundfont instruments
        // This significantly speeds up loading when switching between movements
        this.instrumentCache = new Map(); // Map<instrumentName, instrument>
        this.maxCacheSize = 30; // Keep up to 30 instruments cached

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

        let showWarning = false;
        let deviceInfo = '';

        // Check 1: Device Memory API (Chrome/Edge only)
        if (navigator.deviceMemory) {
            deviceInfo += `Device Memory: ${navigator.deviceMemory}GB`;
            // Show warning if device has 4GB or less
            if (navigator.deviceMemory <= 4) {
                showWarning = true;
            }
        }

        // Check 2: Mobile detection
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
            deviceInfo += (deviceInfo ? ', ' : '') + 'Mobile Device';
            // Mobile devices are more memory-constrained
            if (!navigator.deviceMemory || navigator.deviceMemory <= 6) {
                showWarning = true;
            }
        }

        // Check 3: Connection quality (if available)
        if (navigator.connection) {
            const effectiveType = navigator.connection.effectiveType;
            deviceInfo += (deviceInfo ? ', ' : '') + `Connection: ${effectiveType}`;
        }

        // Show warning if device seems limited
        if (showWarning && this.memoryWarning) {
            this.memoryWarning.style.display = 'block';
            console.warn('Limited device capabilities detected:', deviceInfo);
        } else if (deviceInfo) {
            console.log('Device capabilities:', deviceInfo);
        }

        // Store device info for error handling
        this.deviceInfo = {
            hasLimitedMemory: showWarning,
            isMobile: isMobile,
            deviceMemory: navigator.deviceMemory,
            info: deviceInfo
        };
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

        // Loop controls
        this.loopStartSlider = document.getElementById('loop-start-slider');
        this.loopEndSlider = document.getElementById('loop-end-slider');
        this.loopRangeDisplay = document.getElementById('loop-range-display');
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
    }

    savePreferences() {
        localStorage.setItem('voicePart', this.voicePart);
    }

    updateBalanceLabel() {
        // Update the balance label to show the current voice part
        const voicePartName = this.voicePart.charAt(0).toUpperCase() + this.voicePart.slice(1);
        if (this.balanceVoicePartSpan) {
            this.balanceVoicePartSpan.textContent = voicePartName;
        }
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

                // Fetch movements for this work
                const movementsResponse = await fetch(`/api/composer/${encodeURIComponent(composer)}/work/${encodeURIComponent(work)}/sections`);
                movements = await movementsResponse.json();
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

            // Auto-select the first movement in the dropdown
            this.movementSelect.selectedIndex = 1;

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

            // Don't auto-load on page load - let user click play when ready
            // This prevents errors on slower connections or during initialization
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

        // Recent works dropdown
        this.recentWorksSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                try {
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

            // If left slider moved ahead of current time, jump to it
            if (this.loopStart > this.currentTime) {
                this.seekTo(this.loopStart);
            }
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

            // If right slider moved before current time, jump back to loop start
            if (this.loopEnd < this.currentTime) {
                this.seekTo(this.loopStart);
            }
        });

        this.tempoSlider.addEventListener('input', (e) => {
            this.setTempo(parseInt(e.target.value));
        });

        // Volume controls - master volume fixed at 100%
        this.masterVolume = 1.0;

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
                throw new Error(`HTTP error! status: ${response.status}`);
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

            // If only one movement, auto-select and load it
            if (movements.length === 1) {
                this.movementSelect.selectedIndex = 1; // Select the first movement (index 1 after the placeholder)
                const movementData = movements[0];
                const absoluteUrl = this.toAbsoluteUrl(movementData.midiUrl);
                this.loadMIDIFromURL(absoluteUrl, movementData.name);
            }

            // Pre-load common instruments in the background to speed up playback
            // This happens asynchronously and doesn't block the UI
            this.preloadCommonInstruments();

            // Save to recent works
            await this.saveRecentWork(this.selectedComposer, workName);
        } catch (error) {
            console.error('Error loading movements:', error);
            this.showStatus('Error loading movements', 'error');
        }
    }

    async loadRecentWorks() {
        try {
            const response = await fetch('/api/recent-works');
            const recentWorks = await response.json();

            if (recentWorks.length === 0) {
                this.recentWorksDropdown.style.display = 'none';
                return;
            }

            // Show only the 5 most recent works
            const recentToShow = recentWorks.slice(0, 5);

            this.recentWorksSelect.innerHTML = '<option value="">Choose a recent work...</option>' +
                recentToShow.map(item =>
                    `<option value='${JSON.stringify({ composer: item.composer, work: item.work })}'>
                        ${item.composer}, ${item.work}
                    </option>`
                ).join('');
            this.recentWorksDropdown.style.display = 'block';
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

    async fetchWithRetry(url, maxRetries = 3, timeoutMs = 30000) {
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
                    const waitTime = Math.pow(3, attempt) * 10000; // 10s, 30s, 90s
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
                        throw new Error(`Request timed out after ${maxRetries} attempts`);
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
                throw new Error(errorMsg);
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

            // Adjust duration to account for removed leading silence
            this.originalDuration = this.midi.duration - this.skipToTime;
            this.duration = this.originalDuration;

            // Setup the MIDI playback
            await this.setupPlayback();

            // Update UI
            this.updateMIDIInfo();

            // Initialize loop to full duration
            this.loopStart = 0;
            this.loopEnd = this.originalDuration;
            if (this.loopStartSlider) this.loopStartSlider.value = 0;
            if (this.loopEndSlider) this.loopEndSlider.value = 100;
            this.updateLoopDisplay();

            // Update channels list based on voice part
            this.updateChannelsList();

            // Update the current movement name display with composer, work, and movement
            if (title && this.selectedComposer && this.selectedWork) {
                this.currentMovementName.textContent = `${this.selectedComposer}, ${this.selectedWork} - ${title}`;
            } else if (title) {
                this.currentMovementName.textContent = title;
            }

            this.showStatus('MIDI file loaded successfully!', 'success');

            // Auto-play after loading
            setTimeout(() => this.play(), 500);

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
        this.currentTimeDisplay.textContent = this.formatTime(this.currentTime);
        this.progressBar.value = (this.currentTime / this.originalDuration) * 100;

        // Convert original time to scaled time for Transport
        const scaledTime = this.currentTime / this.tempoMultiplier;
        Tone.Transport.seconds = scaledTime;

        // Resume playback if it was playing before
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
                    this.seekTo(this.loopStart);
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

    skipToNextMovement() {
        // Get current selected index
        const currentIndex = this.movementSelect.selectedIndex;
        const totalMovements = this.movementSelect.options.length;

        // Check if there's a next movement (accounting for placeholder at index 0)
        if (currentIndex < totalMovements - 1 && currentIndex > 0) {
            // Select next movement
            this.movementSelect.selectedIndex = currentIndex + 1;

            // Load the next movement
            const movementData = JSON.parse(this.movementSelect.value);
            const absoluteUrl = this.toAbsoluteUrl(movementData.midiUrl);
            this.loadMIDIFromURL(absoluteUrl, movementData.name);
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
        // If cache is full, remove oldest entry (first entry in Map)
        if (this.instrumentCache.size >= this.maxCacheSize) {
            const firstKey = this.instrumentCache.keys().next().value;
            this.instrumentCache.delete(firstKey);
        }

        this.instrumentCache.set(instrumentName, instrument);
    }

    // Pre-load common instruments in the background to speed up playback
    async preloadCommonInstruments() {
        // Top 5 most commonly used instruments based on MIDI file analysis
        const commonInstruments = [
            'acoustic_grand_piano',  // Most common - 98 uses in "A" composers
            'piccolo',               // Soprano part
            'clarinet',              // Alto part
            'french_horn',           // Tenor part
            'bassoon'                // Bass part
        ];

        // Load sequentially with delays to avoid overwhelming mobile devices
        // Don't await - let this happen in the background
        (async () => {
            for (const instrumentName of commonInstruments) {
                try {
                    // Skip if already in cache
                    if (this.instrumentCache.has(instrumentName)) {
                        continue;
                    }

                    // Load instrument with temporary gain node to trigger browser HTTP cache
                    const audioContext = Tone.context.rawContext;
                    const tempGainNode = audioContext.createGain();
                    tempGainNode.connect(audioContext.destination);
                    tempGainNode.gain.value = 0; // Silent - just for caching

                    // Add timeout to prevent hanging
                    const loadPromise = Soundfont.instrument(audioContext, instrumentName, {
                        soundfont: 'FluidR3_GM',
                        destination: tempGainNode,
                        nameToUrl: (name, soundfont, format) => {
                            format = format === 'ogg' ? format : 'mp3';
                            return `https://gleitz.github.io/midi-js-soundfonts/${soundfont}/${name}-${format}.js`;
                        }
                    });

                    // Timeout after 10 seconds
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Preload timeout')), 10000)
                    );

                    await Promise.race([loadPromise, timeoutPromise]);

                    // Disconnect the temp gain node
                    tempGainNode.disconnect();

                    // Small delay between loads to avoid overwhelming device
                    await new Promise(resolve => setTimeout(resolve, 500));

                } catch (error) {
                    // Silently fail - pre-loading is a performance optimization, not critical
                    console.log(`Pre-load of ${instrumentName} failed, will load on demand:`, error.message);
                }
            }
        })();
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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
