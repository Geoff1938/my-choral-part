/**
 * Practice MIDI conversion of the reference files
 *
 * The files are copyrighted and live in tests/fixtures/private/, which is not
 * in git. Tests that need a missing file are skipped.
 */

const fs = require('fs');
const path = require('path');
const { readMidi, extractNotes, metaText, META } = require('../../../public/practice-midi/smf.js');
const { auditMidi, tempoMap } = require('../../../public/practice-midi/audit.js');
const { convertFile } = require('../../../public/practice-midi/convert.js');
const { VOICE_SLOTS, START_VOLUME, REVERB, CHORUS, DEFAULT_VELOCITY } = require('../../../public/practice-midi/recipe.js');
const { detectVoicePartFromName, normalizeChannelName, isChoralTrackName } = require('../../../public/practice-midi/voiceParts.js');

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'private');
const BACH = 'Bach, B minor Mass, Gloria (04-glori.mid)';
const SCHUTZ = 'Schütz, Beschluss (137_Beschluss.midi)';

function fixture(name) {
  const file = path.join(FIXTURES, name);
  return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
}

const files = {
  bach: fixture('04-glori.mid'),
  schutz: fixture('137_Beschluss.midi'),
  ursic: fixture('Ws-bach-m1a.mid')
};

const describeIf = data => (data ? describe : describe.skip);

/**
 * Multiset of (onset tick, pitch, duration) for a track, as sorted strings
 */
function noteSet(track) {
  return extractNotes(track.events).map(n => `${n.tick}:${n.note}:${n.duration}`).sort();
}

function noteSetWithVelocity(track) {
  return extractNotes(track.events).map(n => `${n.tick}:${n.note}:${n.duration}:${n.velocity}`).sort();
}

function trackByName(midi, name) {
  return midi.tracks.find(t => metaText(t, META.TRACK_NAME) === name);
}

function tempoEvents(midi) {
  return tempoMap(midi).map(t => [t.tick, t.microsecondsPerQuarter]);
}

/**
 * The recipe settings a voice track should have, from its name as the player
 * reads it ("1st Treble" and "Soprano 1" are both the first soprano)
 */
function expectedVoice(name) {
  const section = detectVoicePartFromName(normalizeChannelName(name));
  const number = (name.match(/\d/) || ['1'])[0];
  return VOICE_SLOTS.find(s => s.section === section && s.number === Number(number));
}

/**
 * Assert that every track with notes follows the recipe
 */
function expectAuditsToRecipe(midi) {
  const audit = auditMidi(midi);
  for (const track of audit.tracks.filter(t => t.noteCount > 0)) {
    expect(track.channels).toHaveLength(1);
    expect(track.reverb).toBe(REVERB);
    expect(track.chorus).toBe(CHORUS);
    if (isChoralTrackName(track.name)) {
      const slot = expectedVoice(track.name);
      expect({ name: track.name, channel: track.channels[0], program: track.program, pan: track.pan })
        .toEqual({ name: track.name, channel: slot.channel, program: slot.program, pan: slot.pan });
    } else {
      expect(track.channels[0]).not.toBe(9);
    }
  }
  return audit;
}

describeIf(files.bach)(`${BACH}: the reference recipe`, () => {
  test('audits to the recipe constants', () => {
    const audit = expectAuditsToRecipe(readMidi(files.bach));
    expect(audit.ticksPerQuarter).toBe(192);
    expect(audit.tempoCount).toBe(72);
    const voiceNames = audit.tracks.filter(t => t.noteCount > 0 && isChoralTrackName(t.name)).map(t => t.name);
    expect(voiceNames).toEqual(['1st Treble', '2nd Treble', 'Alto', 'Tenor', 'Bass']);
    for (const track of audit.tracks.filter(t => t.noteCount > 0)) {
      expect(track.volumeStart).toBe(START_VOLUME);
    }
  });
});

describeIf(files.bach)(`${BACH}: conversion`, () => {
  const source = files.bach && readMidi(files.bach);
  const result = files.bach && convertFile(files.bach, '04-glori.mid');
  const output = result && result.midi && readMidi(result.midi);

  test('converts with no warnings', () => {
    expect(result.status).toBe('ok');
    expect(result.messages.filter(m => m.level !== 'info')).toEqual([]);
  });

  test('finds S1, S2, A, T, B by name and seven accompaniment parts', () => {
    const voices = result.summary.parts.filter(p => p.role === 'voice');
    expect(voices.map(p => [p.sourceName, p.name, p.classifiedBy])).toEqual([
      ['1st Treble', 'Soprano 1', 'name'],
      ['2nd Treble', 'Soprano 2', 'name'],
      ['Alto', 'Alto', 'name'],
      ['Tenor', 'Tenor', 'name'],
      ['Bass', 'Bass', 'name']
    ]);
    const accompaniment = result.summary.parts.filter(p => p.role === 'accompaniment');
    expect(accompaniment.map(p => p.name)).toEqual([
      '1st violins', 'Trumpets', 'Recorders', 'Synth strings 2', 'Synth strings, etc', 'D\'Bass/Strings, etc', 'Timpani'
    ]);
  });

  test('output audits to the recipe', () => {
    const audit = expectAuditsToRecipe(output);
    expect(audit.ticksPerQuarter).toBe(192);
  });

  test('changes no notes or dynamics in any part', () => {
    for (const part of result.summary.parts) {
      const sourceTrack = source.tracks.find(t => metaText(t, META.TRACK_NAME) === part.sourceName);
      expect(noteSetWithVelocity(trackByName(output, part.name))).toEqual(noteSetWithVelocity(sourceTrack));
    }
  });

  test('keeps the volume automation', () => {
    const sourceCc7 = t => t.events.filter(e => e.type === 'controller' && e.controller === 7).map(e => [e.tick, e.value]);
    expect(sourceCc7(trackByName(output, 'Soprano 1'))).toEqual(sourceCc7(trackByName(source, '1st Treble')));
    expect(sourceCc7(trackByName(output, 'Soprano 1'))).toHaveLength(248);
  });

  test('keeps the tempo map, resolution and length', () => {
    expect(tempoEvents(output)).toEqual(tempoEvents(source));
    expect(output.ticksPerQuarter).toBe(source.ticksPerQuarter);
    const lastTick = midi => Math.max(...midi.tracks.map(t => t.events[t.events.length - 1].tick));
    expect(lastTick(output)).toBe(lastTick(source));
    expect(result.summary.durationSeconds).toBeCloseTo(372.29, 1);
  });

  test('keeps the copyright notice', () => {
    expect(auditMidi(output).copyright).toEqual(['This version: Copyright © 2004/9 John', 'All Rights Reserved']);
  });

  test('suggests the title from the first track name and the composer from its text', () => {
    expect(result.suggested).toEqual({ title: 'Mass in B Minor - No: 4: Gloria in Excelsis', composer: 'J S Bach' });
  });

  test('no accompaniment track would be taken for a voice part by the player', () => {
    for (const part of result.summary.parts.filter(p => p.role === 'accompaniment')) {
      expect(detectVoicePartFromName(part.name)).toBeNull();
    }
  });
});

describeIf(files.schutz)(`${SCHUTZ}: conversion`, () => {
  const source = files.schutz && readMidi(files.schutz);
  const result = files.schutz && convertFile(files.schutz, '137_Beschluss.midi');
  const output = result && result.midi && readMidi(result.midi);

  test('classifies the Latin-named voices as S, A, T, B', () => {
    expect(result.summary.parts.map(p => [p.sourceName, p.name, p.role, p.classifiedBy])).toEqual([
      ['CantusOne', 'Soprano', 'voice', 'name'],
      ['Altus', 'Alto', 'voice', 'name'],
      ['Tenor', 'Tenor', 'voice', 'name'],
      ['Bassus', 'Bass', 'voice', 'name']
    ]);
  });

  test('converts with a warning that there are no dynamics', () => {
    expect(result.status).toBe('warning');
    expect(result.messages.filter(m => m.level === 'warning').map(m => m.code)).toEqual(['no-dynamics']);
  });

  test('output audits to the recipe with the default velocity', () => {
    const audit = expectAuditsToRecipe(output);
    for (const track of audit.tracks.filter(t => t.noteCount > 0)) {
      expect(Object.keys(track.velocities)).toEqual([String(DEFAULT_VELOCITY)]);
      expect(track.volumeStart).toBe(START_VOLUME);
    }
  });

  test('moves each lyric track onto the voice before it', () => {
    const lyricCounts = auditMidi(output).tracks.filter(t => t.noteCount > 0).map(t => [t.name, t.lyricCount]);
    expect(lyricCounts).toEqual([['Soprano', 126], ['Alto', 145], ['Tenor', 136], ['Bass', 129]]);
    expect(output.tracks).toHaveLength(5);
  });

  test('keeps every note and the tempo map', () => {
    const pairs = [['CantusOne', 'Soprano'], ['Altus', 'Alto'], ['Tenor', 'Tenor'], ['Bassus', 'Bass']];
    for (const [sourceName, outputName] of pairs) {
      expect(noteSet(trackByName(output, outputName))).toEqual(noteSet(trackByName(source, sourceName)));
    }
    expect(tempoEvents(output)).toEqual(tempoEvents(source));
    expect(output.ticksPerQuarter).toBe(384);
  });

  test('suggests a title from the file name, ignoring LilyPond\'s "control track"', () => {
    expect(result.suggested).toEqual({ title: '137 Beschluss', composer: '' });
  });
});

describeIf(files.ursic)('Bach, Kyrie, Ursic edition (Ws-bach-m1a.mid): merged voices', () => {
  test('is rejected because the voices cannot be separated', () => {
    const result = convertFile(files.ursic, 'Ws-bach-m1a.mid');
    expect(result.status).toBe('rejected');
    expect(result.midi).toBeNull();
    expect(result.messages.map(m => m.code)).toEqual(['voices-merged']);
  });
});
