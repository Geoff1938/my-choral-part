/**
 * Unit tests for practice MIDI conversion, using small generated files
 */

const { readMidi, extractNotes, metaText, encodeText, META } = require('../../../public/practice-midi/smf.js');
const { auditMidi } = require('../../../public/practice-midi/audit.js');
const { convertFile } = require('../../../public/practice-midi/convert.js');
const { accompanimentName, assignAccompanimentChannels } = require('../../../public/practice-midi/build.js');
const { detectVoicePartFromName } = require('../../../public/practice-midi/voiceParts.js');
const { TPQ, track, song, line, notes, lyricEvent, midiBytes } = require('./helpers.js');

/**
 * Four voices; with dynamics, the soprano ends on one louder note
 */
function satb({ velocity = 80, bpm = 100, count = 64, dynamics = true } = {}) {
  return song([
    track('Soprano', line(0, 72, { velocity, count }), dynamics ? notes(0, [[count * TPQ, 72, TPQ, 100]]) : []),
    track('Alto', line(1, 65, { velocity, count })),
    track('Tenor', line(2, 59, { velocity, count })),
    track('Bass', line(3, 50, { velocity, count }))
  ], { bpm });
}

function codes(result) {
  return result.messages.map(m => m.code);
}

function outputTrack(result, name) {
  return readMidi(result.midi).tracks.find(t => metaText(t, META.TRACK_NAME) === name);
}

describe('convertFile()', () => {
  test('converts a plain SATB file with no warnings', async () => {
    const result = await convertFile(midiBytes(satb()), 'test.mid');
    expect(result.status).toBe('ok');
    expect(result.format).toBe('midi');
    expect(result.midi).toBeInstanceOf(Uint8Array);
    expect(result.summary.parts.map(p => [p.name, p.channel])).toEqual([['Soprano', 0], ['Alto', 5], ['Tenor', 6], ['Bass', 7]]);
    expect(codes(result)).toEqual(['parts-found', 'timing']);
  });

  test('keeps varied velocities', async () => {
    const result = await convertFile(midiBytes(satb()));
    const velocities = Object.keys(auditMidi(readMidi(result.midi)).tracks.find(t => t.name === 'Soprano').velocities);
    expect(velocities).toEqual(['80', '100']);
    expect(codes(result)).not.toContain('no-dynamics');
  });

  test('replaces constant velocity with the default and scales the accompaniment to match', async () => {
    const s = satb({ velocity: 100, dynamics: false });
    s.tracks.push(track('Organ', line(8, 48, { velocity: 120 })));
    const result = await convertFile(midiBytes(s));
    expect(codes(result)).toContain('no-dynamics');
    const audit = auditMidi(readMidi(result.midi));
    expect(Object.keys(audit.tracks.find(t => t.name === 'Alto').velocities)).toEqual(['75']);
    expect(Object.keys(audit.tracks.find(t => t.name === 'Organ').velocities)).toEqual(['90']);
  });

  test('warns about a short piece and a missing tempo', async () => {
    const result = await convertFile(midiBytes(satb({ bpm: null, count: 8 })));
    expect(result.status).toBe('warning');
    expect(codes(result)).toEqual(expect.arrayContaining(['short', 'no-tempo']));
    expect(result.summary.initialBpm).toBe(120);
  });

  test('places unnamed parts by pitch and warns that it did', async () => {
    const s = song([
      track('Cantus', line(0, 72)),
      track('Quintus', line(1, 60)),
      track('Altus', line(2, 66)),
      track('Tenor', line(3, 58)),
      track('Bassus', line(4, 50))
    ]);
    const result = await convertFile(midiBytes(s));
    expect(result.summary.parts.filter(p => p.role === 'voice').map(p => [p.sourceName, p.name, p.classifiedBy])).toEqual([
      ['Cantus', 'Soprano', 'name'],
      ['Altus', 'Alto', 'name'],
      ['Quintus', 'Tenor 1', 'pitch'],
      ['Tenor', 'Tenor 2', 'name'],
      ['Bassus', 'Bass', 'name']
    ]);
    expect(codes(result)).toContain('role-inferred');
    expect(result.status).toBe('warning');
  });

  test('splits a type 0 file by channel and places the unnamed parts by pitch', async () => {
    const s = {
      format: 0,
      ticksPerQuarter: TPQ,
      tracks: [track(null, line(0, 72), line(1, 65), line(2, 58), line(3, 50))]
    };
    const result = await convertFile(midiBytes(s));
    expect(result.summary.parts.map(p => p.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass']);
  });

  test('numbers two parts in a section from their names, else highest first', async () => {
    const byName = await convertFile(midiBytes(song([track('Soprano 2', line(0, 74)), track('Soprano 1', line(1, 70)), track('Alto', line(2, 65))])));
    expect(byName.summary.parts.map(p => [p.sourceName, p.name, p.channel])).toEqual([
      ['Soprano 1', 'Soprano 1', 0], ['Soprano 2', 'Soprano 2', 4], ['Alto', 'Alto', 5]
    ]);
    const byPitch = await convertFile(midiBytes(song([track('Tenor', line(0, 55)), track('Tenor', line(1, 60))])));
    expect(byPitch.summary.parts.map(p => [p.name, p.lowestNote])).toEqual([['Tenor 1', 57], ['Tenor 2', 52]]);
    expect(byPitch.summary.parts.map(p => p.channel)).toEqual([6, 2]);
  });

  test('renames accompaniment the player would mistake for a voice', async () => {
    const s = satb();
    s.tracks.push(track('Bass (continuo)', line(8, 40)));
    s.tracks.push(track('Organ', line(10, 55)));
    const result = await convertFile(midiBytes(s));
    const accompaniment = result.summary.parts.filter(p => p.role === 'accompaniment').map(p => p.name);
    expect(accompaniment).toEqual(['Continuo', 'Organ']);
    accompaniment.forEach(name => expect(detectVoicePartFromName(name)).toBeNull());
  });

  test('keeps accompaniment programs and pan, moving it off voice channels', async () => {
    const s = satb();
    // Organ on source channel 2, which is not an accompaniment channel
    s.tracks.push(track('Organ', { tick: 0, type: 'program', channel: 2, program: 19 },
      { tick: 0, type: 'controller', channel: 2, controller: 10, value: 20 }, line(2, 55)));
    const result = await convertFile(midiBytes(s));
    const organ = auditMidi(readMidi(result.midi)).tracks.find(t => t.name === 'Organ');
    expect(organ.channels).toEqual([8]);
    expect(organ.program).toBe(19);
    expect(organ.pan).toBe(20);
    expect(organ.volumeStart).toBe(64);
  });

  test('moves lyrics from a following lyric-only track onto the voice', async () => {
    const s = satb();
    s.tracks.splice(2, 0, track('', lyricEvent('Ky-', 0), lyricEvent('ri-', TPQ)));
    const result = await convertFile(midiBytes(s));
    const soprano = outputTrack(result, 'Soprano');
    expect(soprano.events.filter(e => e.type === 'meta' && e.metaType === META.LYRIC)).toHaveLength(2);
  });

  test('keeps notes and repeated pitches exactly', async () => {
    const s = song([
      track('Soprano', notes(0, [[0, 72, 480], [480, 72, 480], [960, 72, 240], [1200, 74, 720]])),
      track('Alto', line(1, 65))
    ]);
    const result = await convertFile(midiBytes(s));
    const out = extractNotes(outputTrack(result, 'Soprano').events).map(n => [n.tick, n.note, n.duration]);
    expect(out).toEqual([[0, 72, 480], [480, 72, 480], [960, 72, 240], [1200, 74, 720]]);
  });

  test('leaves out zero-length notes', async () => {
    const s = satb();
    s.tracks[1].events.push(...notes(0, [[TPQ * 70, 80, 0]]));
    const result = await convertFile(midiBytes(s));
    expect(extractNotes(outputTrack(result, 'Soprano').events).some(n => n.note === 80)).toBe(false);
  });

  test('keeps a percussion part on channel 9', async () => {
    const s = satb();
    s.tracks.push(track('Drums', notes(9, [[0, 36, 100], [480, 38, 100]])));
    const result = await convertFile(midiBytes(s));
    const drums = result.summary.parts.find(p => p.role === 'percussion');
    expect(drums.channel).toBe(9);
  });

  test('carries a copyright notice from any track into the conductor track', async () => {
    const s = satb();
    s.tracks[1].events.push({ tick: 0, type: 'meta', metaType: META.COPYRIGHT, data: encodeText('CPDL licence') });
    const output = readMidi((await convertFile(midiBytes(s))).midi);
    expect(metaText(output.tracks[0], META.COPYRIGHT)).toBe('CPDL licence');
  });
});

describe('rejections', () => {
  test('voices merged into chords on one track', async () => {
    const chords = [];
    for (let i = 0; i < 32; i++) {
      chords.push([i * TPQ, 72, TPQ], [i * TPQ, 65, TPQ], [i * TPQ, 58, TPQ], [i * TPQ, 40, TPQ]);
    }
    const result = await convertFile(midiBytes(song([track('Piano', notes(0, chords))])));
    expect(result.status).toBe('rejected');
    expect(codes(result)).toEqual(['voices-merged']);
    expect(result.midi).toBeNull();
  });

  test('instruments only', async () => {
    const result = await convertFile(midiBytes(song([track('Violin', line(0, 72)), track('Cello', line(1, 48))])));
    expect(codes(result)).toEqual(['no-voices']);
  });

  test('no notes', async () => {
    expect(codes(await convertFile(midiBytes(song([track('Soprano')]))))).toEqual(['no-notes']);
  });

  test('double choir', async () => {
    const result = await convertFile(midiBytes(song([
      track('Soprano (Choir 1)', line(0, 72)), track('Soprano (Choir 2)', line(1, 72))
    ])));
    expect(codes(result)).toEqual(['double-choir']);
  });

  test('more than two parts in a section', async () => {
    const result = await convertFile(midiBytes(song([track('Soprano 1', line(0, 74)), track('Soprano 2', line(1, 72)), track('Soprano 3', line(2, 70))])));
    expect(codes(result)).toEqual(['too-many-voices']);
  });

  test('a damaged file', async () => {
    // A track containing an undefined status byte
    const data = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 2, 0x00, 0xf4]);
    const result = await convertFile(data);
    expect(result.status).toBe('rejected');
    expect(codes(result)).toEqual(['unreadable']);
  });

  test('a file over the size limit', async () => {
    expect(codes(await convertFile(new Uint8Array(5 * 1024 * 1024 + 1)))).toEqual(['too-large']);
  });

  test('a type 2 file', async () => {
    const s = satb();
    s.format = 2;
    expect(codes(await convertFile(midiBytes(s)))).toEqual(['unsupported-midi-format']);
  });

  test.each([
    ['%PDF-1.7', 'score.pdf', 'pdf'],
    ['<?xml version="1.0"?><museScore version="4.0"/>', 'score.mscx', 'musescore-file'],
    ['binary junk', 'score.sib', 'notation-file'],
    ['binary junk', 'score.mus', 'notation-file'],
    ['hello', 'notes.txt', 'unknown-format'],
    ['<?xml version="1.0"?><score-partwise version="4.0"/>', 'score.xml', 'musicxml-unreadable']
  ])('other formats: %s (%s)', async (content, filename, code) => {
    expect(codes(await convertFile(encodeText(content), filename))).toEqual([code]);
  });
});

describe('accompanimentName()', () => {
  test('keeps names the player would not take for a voice', () => {
    expect(accompanimentName({ sourceName: '1st violins' }, 1)).toBe('1st violins');
    expect(accompanimentName({ sourceName: 'D\'Bass/Strings, etc' }, 1)).toBe('D\'Bass/Strings, etc');
  });

  test('renames the rest', () => {
    expect(accompanimentName({ sourceName: 'Bass (continuo)' }, 1)).toBe('Continuo');
    expect(accompanimentName({ sourceName: 'Organ (Tenor)' }, 1)).toBe('Organ');
    expect(accompanimentName({ sourceName: 'Tenor viol' }, 3)).toBe('Accompaniment 3');
    expect(accompanimentName({ sourceName: '' }, 2)).toBe('Accompaniment 2');
  });
});

describe('assignAccompanimentChannels()', () => {
  const part = (sourceChannel, program) => ({
    sourceChannel,
    controlEvents: program === undefined ? [] : [{ tick: 0, type: 'program', channel: sourceChannel, program }]
  });

  test('keeps allowed source channels and fills the rest in order', () => {
    const parts = [part(12), part(0), part(9), part(12)];
    expect([...assignAccompanimentChannels(parts).values()]).toEqual([12, 8, 10, 11]);
  });

  test('shares a channel between parts with the same instrument when channels run out', () => {
    const parts = [...Array.from({ length: 7 }, (_, i) => part(i, i + 40)), part(0, 42)];
    const channels = assignAccompanimentChannels(parts);
    expect(channels.get(parts[7])).toBe(channels.get(parts[2]));
  });

  test('gives up when channels run out and nothing matches', () => {
    const parts = Array.from({ length: 8 }, (_, i) => part(i, i + 40));
    expect(assignAccompanimentChannels(parts)).toBeNull();
  });
});
