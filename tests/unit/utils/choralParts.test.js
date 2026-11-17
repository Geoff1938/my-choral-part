/**
 * Unit tests for public/utils/choralParts.js
 */

const { listChoralParts, choosePart, rememberPart } = require('../../../public/utils/choralParts.js');

const named = names => names.map((name, index) => ({ index, name }));
const labels = parts => parts.map(part => part.label);

// Track names from the learnchoralmusic.co.uk Duruflé Requiem files
const DURUFLE_KYRIE = named(['Treble 1', 'Sop 2', 'Alto 1', 'Tenor 1', 'Bass 1', 'Strings', 'Synth Strings', 'Strings 1 b']);
const DURUFLE_SANCTUS = named(['Treble 1', 'Sop 2', 'Alto 1', 'Alto 2', 'Tenor 1', 'Tenor 2', 'Bass 1', 'Bass 2', 'Strings']);
const DURUFLE_AGNUS = named(['Treble 1', 'Alto 1', 'Tenor 1', 'Bass 1', 'Strings', 'Synth Strings b']);
const DURUFLE_LIBERA = named(['Baritone solo', 'Treble 1', 'Alto 1', 'Tenor 1', 'Bass 1', 'Strings']);

describe('listChoralParts', () => {
  test('a section with one line has no number, even if the track has one', () => {
    expect(labels(listChoralParts(DURUFLE_AGNUS))).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass']);
    expect(listChoralParts(DURUFLE_AGNUS).map(part => part.number)).toEqual([null, null, null, null]);
  });

  test('a section that divides lists every line, numbered', () => {
    expect(labels(listChoralParts(DURUFLE_SANCTUS))).toEqual(
      ['Soprano 1', 'Soprano 2', 'Alto 1', 'Alto 2', 'Tenor 1', 'Tenor 2', 'Bass 1', 'Bass 2']);
    expect(labels(listChoralParts(DURUFLE_KYRIE))).toEqual(['Soprano 1', 'Soprano 2', 'Alto', 'Tenor', 'Bass']);
  });

  test('solo parts and instruments are left out', () => {
    expect(labels(listChoralParts(DURUFLE_LIBERA))).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass']);
    expect(labels(listChoralParts(named(['Bass (continuo)', 'Tenor viol', 'Organ', 'Bass'])))).toEqual(['Bass']);
  });

  test('keeps the track index and other properties', () => {
    const parts = listChoralParts([{ index: 7, name: 'Tenor', instrumentName: 'french_horn' }]);
    expect(parts).toEqual([{ index: 7, name: 'Tenor', instrumentName: 'french_horn', voicePart: 'tenor', number: null, label: 'Tenor' }]);
  });

  test('reads roman numerals and ordinals', () => {
    expect(labels(listChoralParts(named(['Tenor I', 'Tenor II', '1st Bass', '2nd Bass'])))).toEqual(
      ['Tenor 1', 'Tenor 2', 'Bass 1', 'Bass 2']);
  });

  test('numbers unnumbered lines with the numbers not already used', () => {
    expect(labels(listChoralParts(named(['Soprano', 'Soprano 1'])))).toEqual(['Soprano 2', 'Soprano 1']);
    expect(labels(listChoralParts(named(['Soprano', 'Soprano'])))).toEqual(['Soprano 1', 'Soprano 2']);
    expect(labels(listChoralParts(named(['Baritone', 'Bass'])))).toEqual(['Bass 1', 'Bass 2']);
  });

  test('numbers in order when the same number appears twice (two choirs)', () => {
    const parts = listChoralParts(named(['Soprano 1 (Choir 1)', 'Soprano 2 (Choir 1)', 'Soprano 1 (Choir 2)', 'Soprano 2 (Choir 2)']));
    expect(labels(parts)).toEqual(['Soprano 1', 'Soprano 2', 'Soprano 3', 'Soprano 4']);
  });
});

describe('choosePart', () => {
  const pick = (tracks, voicePart, number) => choosePart(listChoralParts(tracks), { voicePart, number })?.label;

  test('picks the remembered line where the section divides', () => {
    expect(pick(DURUFLE_SANCTUS, 'tenor', 2)).toBe('Tenor 2');
    expect(pick(DURUFLE_SANCTUS, 'alto', 1)).toBe('Alto 1');
  });

  test('picks the single line where the section does not divide', () => {
    expect(pick(DURUFLE_AGNUS, 'tenor', 2)).toBe('Tenor');
    expect(pick(DURUFLE_AGNUS, 'tenor', null)).toBe('Tenor');
  });

  test('picks the first line when no line number is remembered', () => {
    expect(pick(DURUFLE_SANCTUS, 'bass', null)).toBe('Bass 1');
  });

  test('picks the nearest line below when the section divides less', () => {
    expect(pick(DURUFLE_SANCTUS, 'soprano', 3)).toBe('Soprano 2');
  });

  test('returns null when the file has no line for the section', () => {
    expect(pick(named(['Soprano', 'Alto']), 'tenor', 1)).toBeUndefined();
  });
});

describe('rememberPart', () => {
  test('remembers the line number picked', () => {
    expect(rememberPart({ voicePart: 'tenor', number: null }, { voicePart: 'tenor', number: 2 })).toEqual({ voicePart: 'tenor', number: 2 });
    expect(rememberPart({ voicePart: 'alto', number: 2 }, { voicePart: 'tenor', number: 1 })).toEqual({ voicePart: 'tenor', number: 1 });
  });

  test('picking the single line of the same section keeps the line number', () => {
    expect(rememberPart({ voicePart: 'tenor', number: 2 }, { voicePart: 'tenor', number: null })).toEqual({ voicePart: 'tenor', number: 2 });
  });

  test('picking the single line of another section forgets the line number', () => {
    expect(rememberPart({ voicePart: 'tenor', number: 2 }, { voicePart: 'bass', number: null })).toEqual({ voicePart: 'bass', number: null });
  });

  test('the Duruflé Requiem: a second tenor stays on Tenor 2 through the movements', () => {
    let preference = { voicePart: 'soprano', number: null };
    preference = rememberPart(preference, listChoralParts(DURUFLE_SANCTUS).find(part => part.label === 'Tenor 2'));
    expect(choosePart(listChoralParts(DURUFLE_AGNUS), preference).label).toBe('Tenor');
    expect(choosePart(listChoralParts(named(['Treble 1', 'Alto 1', 'Alto 2', 'Tenor 1', 'Tenor 2', 'Bass 1', 'Bass 2'])), preference).label)
      .toBe('Tenor 2');
  });
});
