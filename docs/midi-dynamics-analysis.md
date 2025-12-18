# MIDI Dynamics Analysis

This document explains how dynamics (volume changes) are encoded in MIDI files and how they affect playback in the choral practice player.

## Overview

MIDI files control volume through multiple parameters that work together:

1. **CC7 (Channel Volume)** - Sets the overall volume level for a channel (0-127)
2. **Note Velocity** - The force/loudness of individual notes (0-127)
3. **CC11 (Expression)** - Optional dynamic shaping within a phrase (0-127)

The **effective volume** is approximately: `CC7 × Velocity / 127`

## How Dynamics Work in Practice

### CC7 (Channel Volume)

- Controls the "master volume" for each MIDI channel
- Typically used for section-level dynamics (ppp, p, mf, f, ff)
- Values persist until changed by another CC7 message
- Common values:
  - 127 = Maximum (fff)
  - 92 = Forte (f)
  - 64 = Mezzo-forte (mf)
  - 45 = Piano (p)
  - 30 = Pianissimo (pp/ppp)

### Note Velocity

- Controls the loudness of each individual note
- Provides expression within a dynamic level
- Range: 1-127 (0 = note off)
- Accented notes might have higher velocity even within a quiet passage

### Velocity vs CC7: What's the Difference?

While both affect volume, they serve different purposes and produce different results.

**Velocity affects both volume AND timbre.** When you press a key on a piano:
- Hard strike = high velocity = loud AND bright/harsh tone
- Soft strike = low velocity = quiet AND mellow/soft tone

In a sampled instrument (like SpessaSynth's SoundFonts), different velocity ranges trigger entirely different recordings:
- Velocity 100-127 might play a sample of a singer belting forte
- Velocity 60-80 might play a gentler mezzo-forte sample
- Velocity 20-40 might play a soft, breathy pianissimo sample

These samples have fundamentally different tonal characteristics, not just different loudness.

**CC7 is like a volume fader on a mixing desk:**
- It scales the output level of everything on that channel
- It does NOT change the timbre - a forte sample played at CC7=30 still sounds like a forte sample, just quieter
- It affects all notes on the channel equally
- It persists until changed

**Practical difference:**

| Scenario | Sound Character |
|----------|-----------------|
| Velocity=30, CC7=127 | Soft, mellow tone at moderate volume |
| Velocity=127, CC7=30 | Bright, aggressive tone but quiet |

The first sounds like someone singing softly. The second sounds like someone singing loudly but heard from far away (or through a turned-down speaker).

**Why MIDI files use both:**

Composers use velocity for musical expression (accents, phrasing, articulation) and CC7 for section-level dynamics (the whole chorus should be ppp here, then f there). This lets them write an accented note within a quiet passage without it becoming inappropriately loud.

### Combined Effect

The synthesizer multiplies these values, so:
- CC7=127, Velocity=127 → Maximum volume (100%)
- CC7=30, Velocity=127 → Quiet (24%)
- CC7=30, Velocity=30 → Very quiet (6%)
- CC7=92, Velocity=127 → Loud (72%)

## Case Study: Verdi Requiem - Movement 1 (Introit)

Analysis of `arequiem.mid` shows how a professional MIDI arrangement uses these controls:

### Timeline

| Time | Musical Moment | CC7 | Velocity | Effective |
|------|----------------|-----|----------|-----------|
| 0:25 | "Requiem aeternam" (ppp) | 30 | 127 | ~24% |
| 1:00-2:00 | Quiet middle section | 30 | 30 | ~6% |
| 2:07 | Crescendo begins | 30→92 | 127 | growing |
| 2:13 | "Kyrie" entrance (f) | 92 | 127 | ~72% |

### Crescendo Implementation

The crescendo at 2:05-2:13 is achieved by:

1. **Bass** enters first at 2:07 with velocity=127, CC7 rises to 92
2. **Tenor** follows with CC7 rising from 30→92
3. **Alto** joins with CC7 rising
4. **Treble** completes the crescendo

This staggered entry with rising CC7 values creates the orchestral crescendo effect.

### Track Entry Times

Not all parts play from the beginning:

| Part | First Note |
|------|------------|
| Accompaniment | 0:00 |
| Tenor/Bass (chorus) | 0:24 |
| Treble/Alto (chorus) | 0:34 |
| Solo parts | 5:25+ |

## Implications for the Balance Control

The player's balance control applies a multiplier to channel volumes. However, it cannot boost channels above their source CC7 values in absolute terms.

### Why Some MIDI Files Sound Quieter

Comparing two versions of the same work:

| File | Vocal CC7 at 3s | Result |
|------|-----------------|--------|
| arequiem.mid | 127 | Full volume potential |
| 11-req.mid | 64-80 | Inherently quieter |

The balance control's floor setting (e.g., 45%) prevents channels from going below 45% of their *original* CC7 value, but cannot compensate for files that have fundamentally lower CC7 values.

## Technical Notes

### Analyzing MIDI Dynamics

To inspect CC7 values in a MIDI file using Node.js:

```javascript
const { Midi } = require('@tonejs/midi');
const fs = require('fs');

const midi = new Midi(fs.readFileSync('file.mid'));

for (const track of midi.tracks) {
    const cc7Events = track.controlChanges[7] || [];
    for (const event of cc7Events) {
        // Note: @tonejs/midi normalizes to 0-1 range
        const value = Math.round(event.value * 127);
        console.log(`${track.name} at ${event.time.toFixed(2)}s: CC7=${value}`);
    }
}
```

### SpessaSynth Behaviour

SpessaSynth correctly processes CC7 messages in real-time, allowing:
- Dynamic changes during playback
- Proper crescendo/diminuendo effects
- Per-channel volume control

The `sequencer.currentTime` property can be used alongside CC7 analysis to understand what dynamics are active at any point.

## References

- [MIDI CC List](https://www.midi.org/specifications-old/item/table-3-control-change-messages-data-bytes-2) - Official MIDI controller numbers
- CC7 = Channel Volume (coarse)
- CC11 = Expression Controller
- CC10 = Pan Position
