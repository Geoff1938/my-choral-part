/**
 * Unit tests for public/practice-midi/smf.js
 */

const { readMidi, writeMidi, extractNotes, decodeText, encodeText, metaText, MidiParseError, META } = require('../../../public/practice-midi/smf.js');
const { TPQ, track, song, notes, nameEvent } = require('./helpers.js');

function bytes(...values) {
  return Uint8Array.from(values.flat());
}

// Header for a type 0 file with one track at 96 ticks per quarter
const HEADER = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96];

function trackChunk(body) {
  return [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body];
}

describe('readMidi()', () => {
  test('reads running status and treats note-on with velocity 0 as note-off', () => {
    const body = [
      0x00, 0x90, 60, 100, // note on
      0x60, 60, 0, // running status: note on velocity 0 = off
      0x00, 64, 90, // running status: another note on
      0x81, 0x00, 0x80, 64, 10, // delta 128, real note off
      0x00, 0xff, 0x2f, 0x00
    ];
    const midi = readMidi(bytes(HEADER, trackChunk(body)));
    expect(midi.format).toBe(0);
    expect(midi.ticksPerQuarter).toBe(96);
    const events = midi.tracks[0].events;
    expect(events.map(e => [e.tick, e.type])).toEqual([
      [0, 'noteOn'], [96, 'noteOff'], [96, 'noteOn'], [224, 'noteOff'], [224, 'meta']
    ]);
    expect(extractNotes(events)).toEqual([
      { tick: 0, duration: 96, channel: 0, note: 60, velocity: 100, offVelocity: 0 },
      { tick: 96, duration: 128, channel: 0, note: 64, velocity: 90, offVelocity: 10 }
    ]);
  });

  test('reads controllers, programs, pitch bend and meta events', () => {
    const body = [
      0x00, 0xff, 0x03, 0x04, 0x54, 0x65, 0x73, 0x74, // track name "Test"
      0x00, 0xc3, 72, // program on channel 3
      0x00, 0xb3, 7, 64, // CC7
      0x00, 0xe3, 0x00, 0x40, // pitch bend centre
      0x00, 0xff, 0x2f, 0x00
    ];
    const midi = readMidi(bytes(HEADER, trackChunk(body)));
    const [name, program, cc, bend] = midi.tracks[0].events;
    expect(decodeText(name.data)).toBe('Test');
    expect(program).toEqual({ tick: 0, type: 'program', channel: 3, program: 72 });
    expect(cc).toEqual({ tick: 0, type: 'controller', channel: 3, controller: 7, value: 64 });
    expect(bend).toEqual({ tick: 0, type: 'pitchBend', channel: 3, value: 8192 });
  });

  test('accepts an ArrayBuffer', () => {
    const data = bytes(HEADER, trackChunk([0x00, 0xff, 0x2f, 0x00]));
    expect(readMidi(data.buffer).tracks).toHaveLength(1);
  });

  test('rejects files that are not MIDI', () => {
    expect(() => readMidi(encodeText('<?xml version="1.0"?>'))).toThrow(MidiParseError);
  });

  test('rejects SMPTE timing', () => {
    const header = [...HEADER.slice(0, 12), 0xe7, 0x28];
    expect(() => readMidi(bytes(header, trackChunk([0x00, 0xff, 0x2f, 0x00])))).toThrow('SMPTE');
  });

  test('rejects data with no status byte', () => {
    expect(() => readMidi(bytes(HEADER, trackChunk([0x00, 60, 100, 0x00, 0xff, 0x2f, 0x00])))).toThrow(MidiParseError);
  });

  test('rejects a truncated event', () => {
    expect(() => readMidi(bytes(HEADER, trackChunk([0x00, 0x90, 60])))).toThrow(MidiParseError);
  });

  test('rejects a header with no tracks', () => {
    expect(() => readMidi(bytes(HEADER))).toThrow('no tracks');
  });
});

describe('writeMidi()', () => {
  test('round-trips events through write and read', () => {
    const original = song([
      track('Soprano', { tick: 0, type: 'program', channel: 0, program: 72 },
        { tick: 0, type: 'controller', channel: 0, controller: 7, value: 64 },
        { tick: 10, type: 'pitchBend', channel: 0, value: 9000 },
        notes(0, [[0, 72, 480], [480, 74, 240]]))
    ]);
    const read = readMidi(writeMidi(original));
    expect(read.format).toBe(1);
    expect(read.ticksPerQuarter).toBe(TPQ);
    expect(read.tracks).toHaveLength(2);
    expect(metaText(read.tracks[1], META.TRACK_NAME)).toBe('Soprano');
    expect(extractNotes(read.tracks[1].events)).toEqual(extractNotes(original.tracks[1].events));
    expect(read.tracks[1].events.find(e => e.type === 'pitchBend').value).toBe(9000);
  });

  test('writes note-offs before note-ons at the same tick, so repeated notes stay separate', () => {
    // Two consecutive C5s: the second note-on and first note-off share tick 480.
    // Listed note-on first to prove the writer reorders them.
    const events = [
      nameEvent('Soprano'),
      { tick: 0, type: 'noteOn', channel: 0, note: 72, velocity: 80 },
      { tick: 480, type: 'noteOn', channel: 0, note: 72, velocity: 80 },
      { tick: 480, type: 'noteOff', channel: 0, note: 72, velocity: 0 },
      { tick: 960, type: 'noteOff', channel: 0, note: 72, velocity: 0 }
    ];
    const read = readMidi(writeMidi({ format: 1, ticksPerQuarter: TPQ, tracks: [{ events }] }));
    const at480 = read.tracks[0].events.filter(e => e.tick === 480).map(e => e.type);
    expect(at480).toEqual(['noteOff', 'noteOn']);
    expect(extractNotes(read.tracks[0].events).map(n => [n.tick, n.duration])).toEqual([[0, 480], [480, 480]]);
  });

  test('encodes long delta times as variable-length quantities', () => {
    const events = notes(0, [[0x200000, 60, 0x4000]]);
    const read = readMidi(writeMidi({ format: 1, ticksPerQuarter: TPQ, tracks: [{ events }] }));
    expect(extractNotes(read.tracks[0].events)).toEqual([
      { tick: 0x200000, duration: 0x4000, channel: 0, note: 60, velocity: 80, offVelocity: 0 }
    ]);
  });

  test('writes a single end-of-track at the last event', () => {
    const events = [
      { tick: 100, type: 'meta', metaType: META.END_OF_TRACK, data: new Uint8Array(0) },
      ...notes(0, [[0, 60, 50]]),
      { tick: 900, type: 'meta', metaType: META.END_OF_TRACK, data: new Uint8Array(0) }
    ];
    const read = readMidi(writeMidi({ format: 1, ticksPerQuarter: TPQ, tracks: [{ events }] }));
    const ends = read.tracks[0].events.filter(e => e.type === 'meta' && e.metaType === META.END_OF_TRACK);
    expect(ends.map(e => e.tick)).toEqual([900]);
  });
});

describe('extractNotes()', () => {
  test('pairs overlapping notes of the same pitch first in, first out', () => {
    const events = [
      { tick: 0, type: 'noteOn', channel: 0, note: 60, velocity: 80 },
      { tick: 10, type: 'noteOn', channel: 0, note: 60, velocity: 90 },
      { tick: 20, type: 'noteOff', channel: 0, note: 60, velocity: 0 },
      { tick: 30, type: 'noteOff', channel: 0, note: 60, velocity: 0 }
    ];
    expect(extractNotes(events).map(n => [n.tick, n.duration, n.velocity])).toEqual([[0, 20, 80], [10, 20, 90]]);
  });

  test('keeps channels apart', () => {
    const events = [...notes(0, [[0, 60, 100]]), ...notes(1, [[0, 60, 50]])];
    expect(extractNotes(events).map(n => [n.channel, n.duration])).toEqual([[0, 100], [1, 50]]);
  });

  test('ends notes left sounding at the last event of the track', () => {
    const events = [
      { tick: 0, type: 'noteOn', channel: 0, note: 60, velocity: 80 },
      { tick: 300, type: 'meta', metaType: META.END_OF_TRACK, data: new Uint8Array(0) }
    ];
    expect(extractNotes(events)[0].duration).toBe(300);
  });
});

describe('text', () => {
  test('decodes UTF-8 and falls back to Latin-1', () => {
    expect(decodeText(encodeText('Schütz'))).toBe('Schütz');
    expect(decodeText(Uint8Array.from([0x53, 0x63, 0x68, 0xfc, 0x74, 0x7a]))).toBe('Schütz');
  });
});
