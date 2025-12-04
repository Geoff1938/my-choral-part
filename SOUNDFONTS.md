# Soundfonts Evaluation

This document summarizes the soundfont options evaluated for the My Choral Part MIDI player application.

## Soundfonts Tried

| Mode | Library | Download Size | RAM Usage | Audio Quality | Status |
|------|---------|---------------|-----------|---------------|--------|
| **Standard** | SpessaSynth + GeneralUser GS SF3 | ~10MB | ~31MB | Good | **Current default** |
| **High Quality** | soundfont-player + FluidR3_GM | ~50MB+ per instrument | ~1.7GB | Highest | Available via `/fullfonts` URL |
| Light | WebAudioFont | Zone-based | ~220MB | Good | Removed - similar quality to Standard but higher memory |
| Ultralight | webaudio-tinysynth | Built-in | Minimal | Basic | Removed - audio quality noticeably worse |
| None | Tone.js PolySynth | None | Very low | Basic | Removed - synthetic sound, testing only |

## Current Implementation

### Standard Mode (Default)
- **Library**: SpessaSynth with GeneralUser GS SF3 soundfont
- **Technology**: Modern WebAudio AudioWorklet-based synthesizer
- **Download**: ~10MB soundfont file
- **Memory**: ~31MB RAM
- **Quality**: Good - suitable for choral practice
- **Reliability**: Excellent - handles all MIDI files well

### High Quality Mode (via `/fullfonts` URL)
- **Library**: soundfont-player with FluidR3_GM soundfont
- **Technology**: Individual instrument samples loaded on demand
- **Download**: ~50MB+ per instrument (varies by instrument complexity)
- **Memory**: Up to ~1.7GB for full orchestral pieces
- **Quality**: Highest available - professional-grade samples
- **Use Case**: Users with powerful desktops who want the best audio quality

## Recommendations

- **Most users**: Use the default Standard mode. It provides good audio quality with minimal resource usage and fast loading times.
- **Power users**: Access High Quality mode via `/fullfonts` URL if you have a desktop with plenty of RAM and want the best possible audio fidelity.

## Technical Notes

- Standard mode uses WebAudio AudioWorklet for efficient, glitch-free audio processing
- High Quality mode loads instruments on-demand to manage memory usage
- Both modes support all General MIDI instruments (128 melodic + percussion)
