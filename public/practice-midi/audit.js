/**
 * MIDI audit: a per-track report of the settings the practice recipe controls.
 * Used as the test oracle (the reference file must audit to the recipe, and
 * so must every converted file) and for timing information in reports.
 */

import { META, decodeText, extractNotes, metaText } from './smf.js';
import { CC } from './recipe.js';

const DEFAULT_TEMPO_US = 500000; // 120 bpm, the MIDI default

/**
 * Collect the tempo map from every track
 * @param {{tracks: Array<{events: Array<Object>}>}} song - Parsed MIDI file
 * @returns {Array<{tick: number, microsecondsPerQuarter: number}>} Tempo changes in tick order
 */
export function tempoMap(song) {
    const tempos = [];
    for (const track of song.tracks) {
        for (const event of track.events) {
            if (event.type === 'meta' && event.metaType === META.TEMPO && event.data.length === 3) {
                tempos.push({
                    tick: event.tick,
                    microsecondsPerQuarter: (event.data[0] << 16) | (event.data[1] << 8) | event.data[2]
                });
            }
        }
    }
    return tempos.sort((a, b) => a.tick - b.tick);
}

/**
 * Convert a tick position to seconds using a tempo map
 * @param {number} tick - Position in ticks
 * @param {Array<{tick: number, microsecondsPerQuarter: number}>} tempos - Tempo map
 * @param {number} ticksPerQuarter - File resolution
 * @returns {number} Seconds from the start
 */
export function ticksToSeconds(tick, tempos, ticksPerQuarter) {
    let seconds = 0;
    let lastTick = 0;
    let tempo = DEFAULT_TEMPO_US;
    for (const change of tempos) {
        if (change.tick >= tick) break;
        seconds += (change.tick - lastTick) * tempo / ticksPerQuarter / 1e6;
        lastTick = change.tick;
        tempo = change.microsecondsPerQuarter;
    }
    return seconds + (tick - lastTick) * tempo / ticksPerQuarter / 1e6;
}

/**
 * Tick at which the last note ends
 * @param {{tracks: Array<{events: Array<Object>}>}} song - Parsed MIDI file
 * @returns {number} End tick
 */
export function lastNoteEnd(song) {
    let end = 0;
    for (const track of song.tracks) {
        for (const note of extractNotes(track.events)) {
            end = Math.max(end, note.tick + note.duration);
        }
    }
    return end;
}

function firstController(events, controller) {
    const event = events.find(e => e.type === 'controller' && e.controller === controller);
    return event ? event.value : null;
}

/**
 * Audit a MIDI file
 * For each track: name, channels, first program, pan, starting volume (CC7),
 * reverb (CC91), chorus (CC93), number of volume changes, velocity histogram,
 * pitch range, note count and lyric count.
 * @param {{format: number, ticksPerQuarter: number, tracks: Array<{events: Array<Object>}>}} song - Parsed MIDI file
 * @returns {Object} Audit report
 */
export function auditMidi(song) {
    const tempos = tempoMap(song);
    const tracks = song.tracks.map((track, index) => {
        const notes = extractNotes(track.events);
        const channels = [...new Set(track.events.filter(e => e.channel !== undefined).map(e => e.channel))].sort((a, b) => a - b);
        const program = track.events.find(e => e.type === 'program');
        const velocities = {};
        for (const note of notes) {
            velocities[note.velocity] = (velocities[note.velocity] || 0) + 1;
        }
        const pitches = notes.map(n => n.note);
        return {
            index,
            name: metaText(track, META.TRACK_NAME),
            channels,
            program: program ? program.program : null,
            pan: firstController(track.events, CC.PAN),
            volumeStart: firstController(track.events, CC.VOLUME),
            volumeChanges: track.events.filter(e => e.type === 'controller' && e.controller === CC.VOLUME).length,
            reverb: firstController(track.events, CC.REVERB),
            chorus: firstController(track.events, CC.CHORUS),
            noteCount: notes.length,
            velocities,
            lowestNote: pitches.length ? Math.min(...pitches) : null,
            highestNote: pitches.length ? Math.max(...pitches) : null,
            lyricCount: track.events.filter(e => e.type === 'meta' && e.metaType === META.LYRIC).length
        };
    });

    const copyright = [];
    for (const track of song.tracks) {
        for (const event of track.events) {
            if (event.type === 'meta' && event.metaType === META.COPYRIGHT) {
                copyright.push(decodeText(event.data));
            }
        }
    }

    return {
        format: song.format,
        ticksPerQuarter: song.ticksPerQuarter,
        tempoCount: tempos.length,
        // Until the first tempo event, MIDI plays at 120 bpm
        initialBpm: tempos.length && tempos[0].tick === 0 ? 60e6 / tempos[0].microsecondsPerQuarter : 120,
        durationSeconds: ticksToSeconds(lastNoteEnd(song), tempos, song.ticksPerQuarter),
        copyright,
        tracks
    };
}
