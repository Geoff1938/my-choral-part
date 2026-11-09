/**
 * Unit tests for public/utils/midiTracks.js
 */

const { Midi } = require('@tonejs/midi');
const { nameSplitTracks } = require('../../../public/utils/midiTracks.js');
const { writeMidi } = require('../../../public/practice-midi/smf.js');
const { TPQ, track, song, line, notes } = require('../practice-midi/helpers.js');

describe('nameSplitTracks', () => {
  test('names tracks the MIDI reader splits off at an instrument change', () => {
    // "Violins" changes from strings (48) to organ (20) half-way through
    const violins = track('Violins',
      { tick: 0, type: 'program', channel: 10, program: 48 }, notes(10, [[0, 76, TPQ], [TPQ, 77, TPQ]]),
      { tick: 2 * TPQ, type: 'program', channel: 10, program: 20 }, notes(10, [[2 * TPQ, 72, TPQ]]));
    const midi = new Midi(writeMidi(song([track('Soprano', line(0, 72)), violins])));
    expect(midi.tracks.filter(t => t.notes.length).map(t => t.name)).toEqual(['Soprano', 'Violins', '']);

    expect(nameSplitTracks(midi.tracks)).toBe(1);
    expect(midi.tracks.filter(t => t.notes.length).map(t => t.name)).toEqual(['Soprano', 'Violins', 'Violins (2)']);
  });

  test('never names a track after a voice part', () => {
    const tracks = [
      { name: 'Soprano', channel: 0, notes: [{}] },
      { name: '', channel: 0, notes: [{}] }
    ];
    expect(nameSplitTracks(tracks)).toBe(0);
    expect(tracks[1].name).toBe('');
  });
});
