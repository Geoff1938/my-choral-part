# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web-based MIDI playback application designed for choral practice. Users can load MIDI files from URLs and control playback with features like tempo adjustment, seeking, and individual channel volume control.

## Architecture

### Application Structure

The application follows a simple client-server architecture:

- **Server**: Minimal Node.js/Express server (`server.js`) that serves static files from the `public/` directory
- **Client**: Single-page application with vanilla JavaScript (no frameworks)
- **Audio Processing**: All MIDI parsing and playback happens client-side using Tone.js and @tonejs/midi

### Key Components

**public/app.js** - Core application logic organized as a `MIDIPlayer` class:
- `loadMIDI()`: Fetches and parses MIDI files from URLs using the @tonejs/midi library
- `setupPlayback()`: Creates Tone.js PolySynths and Parts for each MIDI track
- `play()/pause()/stop()`: Controls Tone.Transport for playback state
- `seek()/seekTo()`: Implements time-based navigation through the MIDI file
- `setTempo()`: Adjusts playback speed via Tone.Transport.bpm
- `setChannelVolume()`: Controls individual synth volumes in decibels
- `startProgressUpdate()`: Uses setInterval to update UI during playback

**public/index.html** - UI structure:
- MIDI URL input section
- Playback controls (play/pause/stop, seek ±10s)
- Progress bar (interactive - click to seek)
- Tempo slider (25%-200%)
- Dynamic channel volume controls (created per MIDI file)

**public/styles.css** - Responsive design:
- Mobile-first approach with breakpoints at 768px and 480px
- Flexbox and CSS Grid for responsive layouts
- CSS custom properties (variables) for theming

### Audio Implementation Details

**MIDI Playback Flow**:
1. MIDI file fetched as ArrayBuffer from user-provided URL
2. Parsed using @tonejs/midi into track objects with note arrays
3. For each track with notes:
   - Create a PolySynth (polyphonic synthesizer)
   - Create a Tone.Part mapping note events to synth triggers
4. Tone.Transport manages global playback timing and tempo
5. Parts start at current time position when play() is called

**Volume Control**:
- Implemented using synth.volume.value in decibels
- 0% = -Infinity dB (silent)
- 100% = -10 dB (default)
- 200% = +10 dB (amplified)

**Tempo Control**:
- Multiplier applied to original BPM from MIDI header
- Tone.Transport.bpm.value updated in real-time
- Affects all parts simultaneously

### State Management

Application state is maintained in the `MIDIPlayer` class instance:
- `midi`: Parsed MIDI object from @tonejs/midi
- `synths[]`: Array of Tone.PolySynth instances (one per track)
- `parts[]`: Array of Tone.Part instances (scheduled note events)
- `isPlaying`: Boolean playback state
- `currentTime`: Playback position in seconds
- `duration`: Total MIDI duration
- `tempoMultiplier`: Speed multiplier (1 = 100%)
- `channelVolumes{}`: Per-channel volume percentages

## Commands

### Development

```bash
# Install dependencies
npm install

# Start development server (port 3000)
npm start
```

### Deployment

The app is configured for Render deployment:
- `render.yaml` defines the service configuration
- Environment variable PORT is used if available
- Build command: `npm install`
- Start command: `npm start`

## Common Development Tasks

### Adding New Playback Controls

1. Add HTML controls to `public/index.html` in the `.controls-section`
2. Add styling to `public/styles.css`
3. In `public/app.js`:
   - Add element reference in `initializeElements()`
   - Add event listener in `attachEventListeners()`
   - Implement control logic as a new method

### Modifying Audio Synthesis

Audio synthesis happens in `setupPlayback()` at public/app.js:99. Each PolySynth is configured with:
- Oscillator type (currently 'triangle')
- ADSR envelope parameters

To change sound:
- Modify oscillator type: 'sine', 'square', 'triangle', 'sawtooth'
- Adjust envelope: attack, decay, sustain, release values
- Consider using different Tone.js instruments (e.g., MembraneSynth, MetalSynth)

### Handling CORS Issues

MIDI files must be served with CORS headers. If users report loading errors:
- The error will appear in the status message
- Browser console will show CORS-specific errors
- Users may need to use a CORS proxy or host files on CORS-enabled servers

## Technical Constraints

1. **Browser Compatibility**: Requires Web Audio API support (all modern browsers)
2. **CORS Requirements**: MIDI files must be accessible via CORS-enabled URLs
3. **Client-Side Processing**: All MIDI parsing happens in browser - large files may cause delays
4. **Memory Usage**: Each track creates a PolySynth; very complex MIDI files could impact performance

## Important Code Locations

- Server configuration: `server.js:7` (PORT and static file serving)
- MIDI loading: `public/app.js:111` (fetch and parse)
- Playback setup: `public/app.js:144` (synth and part creation)
- Play/pause/stop: `public/app.js:231-289` (transport control)
- Seeking: `public/app.js:291-316` (time navigation)
- Tempo adjustment: `public/app.js:318-327` (BPM control)
- Channel volume: `public/app.js:227` (synth volume in dB)

## Dependencies

**Runtime** (loaded from CDN in HTML):
- Tone.js v14.8.49 - Web Audio framework
- @tonejs/midi v2.0.28 - MIDI file parser

**Server**:
- express v4.18.2 - Static file server

No build process required; libraries loaded via CDN for simplicity.
