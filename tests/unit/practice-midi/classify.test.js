/**
 * Unit tests for public/practice-midi/classify.js and voiceParts.js
 */

const { parseName, nameWords, chordShare } = require('../../../public/practice-midi/classify.js');
const { isChoralTrackName, detectVoicePartFromName } = require('../../../public/practice-midi/voiceParts.js');

describe('nameWords()', () => {
  test('splits camel case, numbers and ordinals', () => {
    expect(nameWords('CantusOne')).toEqual(['cantus', 'one']);
    expect(nameWords('1st Treble')).toEqual(['1', 'treble']);
    expect(nameWords('Soprano2')).toEqual(['soprano', '2']);
    expect(nameWords('S2')).toEqual(['s', '2']);
    expect(nameWords('Ténor')).toEqual(['tenor']);
    expect(nameWords('D\'Bass/Strings, etc')).toEqual(['doublebass', 'strings', 'etc']);
  });
});

describe('parseName()', () => {
  test.each([
    ['Soprano', 'soprano', null],
    ['Soprano I', 'soprano', 1],
    ['Soprano II', 'soprano', 2],
    ['1st Treble', 'soprano', 1],
    ['2nd Treble', 'soprano', 2],
    ['CantusOne', 'soprano', 1],
    ['Sopran 2', 'soprano', 2],
    ['S2', 'soprano', 2],
    ['S', 'soprano', null],
    ['Superius', 'soprano', null],
    ['Discantus', 'soprano', null],
    ['Dessus', 'soprano', null],
    ['Alto', 'alto', null],
    ['Alt', 'alto', null],
    ['Altus', 'alto', null],
    ['Contratenor', 'alto', null],
    ['Countertenor', 'alto', null],
    ['Counter tenor', 'alto', null],
    ['Mezzo-soprano', 'alto', null],
    ['A1', 'alto', 1],
    ['Tenor', 'tenor', null],
    ['Ténor', 'tenor', null],
    ['Taille', 'tenor', null],
    ['Tenor 2', 'tenor', 2],
    ['Bass', 'bass', null],
    ['Bassus', 'bass', null],
    ['Basse', 'bass', null],
    ['Baritone', 'bass', null],
    ['B2', 'bass', 2]
  ])('"%s" is a %s voice (number %s)', (name, section, number) => {
    expect(parseName(name)).toEqual({ kind: 'voice', section, number, choir: null });
  });

  test.each([
    'Organ', 'Piano', 'Grand Piano', 'Basso continuo', 'Bass (continuo)', 'Tenor viol', 'Bassoon',
    'D\'Bass/Strings, etc', 'Double bass', 'Trumpets', 'Timpani', '1st violins', 'Synth strings 2', 'Bass guitar'
  ])('"%s" is an instrument', name => {
    expect(parseName(name).kind).toBe('instrument');
  });

  test.each(['Quintus', 'Vagans', '', 'Staff 3', 'Track 5'])('"%s" is unknown', name => {
    expect(parseName(name).kind).toBe('unknown');
  });

  test('solo parts are recognised', () => {
    expect(parseName('Soprano solo')).toEqual({ kind: 'solo', section: 'soprano', choir: null });
  });

  test('a choir number is not a voice number', () => {
    expect(parseName('Soprano (Choir 2)')).toEqual({ kind: 'voice', section: 'soprano', number: null, choir: 2 });
    expect(parseName('Coro I Alto')).toEqual({ kind: 'voice', section: 'alto', number: null, choir: 1 });
  });

  test('single letters count only as the whole name', () => {
    expect(parseName('A minor theme').kind).toBe('unknown');
  });
});

describe('chordShare()', () => {
  test('is zero for a legato line', () => {
    expect(chordShare([{ tick: 0, duration: 10 }, { tick: 10, duration: 10 }, { tick: 20, duration: 10 }])).toBe(0);
  });

  test('counts notes that start together or overlap', () => {
    expect(chordShare([{ tick: 0, duration: 10 }, { tick: 0, duration: 10 }, { tick: 5, duration: 10 }, { tick: 20, duration: 1 }])).toBe(0.5);
  });
});

describe('voiceParts', () => {
  test('the converter\'s output names are all recognised by the player', () => {
    for (const name of ['Soprano', 'Soprano 1', 'Soprano 2', 'Alto', 'Alto 2', 'Tenor', 'Tenor 2', 'Bass', 'Bass 2']) {
      expect(isChoralTrackName(name)).toBe(true);
    }
  });

  test('solo parts and instruments are not choral', () => {
    expect(isChoralTrackName('Soprano solo')).toBe(false);
    expect(isChoralTrackName('Organ')).toBe(false);
    expect(detectVoicePartFromName('D\'Bass')).toBeNull();
  });
});
