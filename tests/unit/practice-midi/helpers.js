/**
 * Helpers for building small MIDI files in tests
 */

const { writeMidi, encodeText, META } = require('../../../public/practice-midi/smf.js');

const TPQ = 480;

function nameEvent(name) {
  return { tick: 0, type: 'meta', metaType: META.TRACK_NAME, data: encodeText(name) };
}

function tempoEvent(bpm, tick = 0) {
  const us = Math.round(60e6 / bpm);
  return { tick, type: 'meta', metaType: META.TEMPO, data: new Uint8Array([(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]) };
}

function lyricEvent(text, tick) {
  return { tick, type: 'meta', metaType: META.LYRIC, data: encodeText(text) };
}

/**
 * Note events for a list of [tick, pitch, duration, velocity?]
 */
function notes(channel, list, velocity = 80) {
  const events = [];
  for (const [tick, note, duration, v] of list) {
    events.push({ tick, type: 'noteOn', channel, note, velocity: v ?? velocity });
    events.push({ tick: tick + duration, type: 'noteOff', channel, note, velocity: 0 });
  }
  return events;
}

/**
 * A simple melodic line: `count` quarter notes stepping around `centre`
 */
function line(channel, centre, { count = 64, velocity = 80, start = 0 } = {}) {
  const steps = [0, 2, 4, 2, 0, -1, -3, -1];
  return notes(channel, Array.from({ length: count }, (_, i) => [start + i * TPQ, centre + steps[i % steps.length], TPQ, velocity]));
}

/**
 * A track: [name, ...events]
 */
function track(name, ...eventLists) {
  const events = name === null ? [] : [nameEvent(name)];
  for (const list of eventLists) {
    events.push(...(Array.isArray(list) ? list : [list]));
  }
  return { events };
}

/**
 * A type 1 file with a conductor track (tempo, optional name) and the given tracks
 */
function song(tracks, { bpm = 100, title = null, format = 1 } = {}) {
  const conductor = { events: [...(title ? [nameEvent(title)] : []), ...(bpm ? [tempoEvent(bpm)] : [])] };
  return { format, ticksPerQuarter: TPQ, tracks: [conductor, ...tracks] };
}

function midiBytes(s) {
  return writeMidi(s);
}

module.exports = { TPQ, nameEvent, tempoEvent, lyricEvent, notes, line, track, song, midiBytes };
