/**
 * Unit tests for URL slugs (server utils/slug.js and browser public/utils/slug.js)
 */

const path = require('path');
const { toSlug, toLegacySlug, slugMatches, findWork, findByNameOrSlug } = require('../../../utils/slug');
const { toSlug: browserToSlug } = require('../../../public/utils/slug.js');
const index = require(path.join(__dirname, '../../../data/midi-index-full.json'));

describe('toSlug', () => {
  test.each([
    ['Haydn (Joseph)', 'haydn-joseph'],
    ['Bach, JS', 'bach-js'],
    ['10. Paukenmesse (Mass in Time of War) (Second Mass)', '10-paukenmesse-mass-in-time-of-war-second-mass'],
    ['O Holy Night [arr. Gibb]', 'o-holy-night-arr-gibb'],
    ["Mary's Child", 'marys-child'],
    ['Gilbert & Sullivan', 'gilbert-and-sullivan'],
    ['Fauré', 'faure'],
    ['  . . Autumn  ', 'autumn']
  ])('%s -> %s', (name, slug) => {
    expect(toSlug(name)).toBe(slug);
  });

  test('browser copy gives the same slug for every name in the index', () => {
    const names = index.flatMap(c => [c.name, ...c.works.map(w => w.name)]);
    const mismatches = names.filter(name => toSlug(name) !== browserToSlug(name));
    expect(mismatches).toEqual([]);
  });

  test('every composer and work has a non-empty slug', () => {
    const empty = index.flatMap(c => [c.name, ...c.works.map(w => w.name)]).filter(n => !toSlug(n));
    expect(empty).toEqual([]);
  });
});

describe('slugMatches', () => {
  test('accepts exact names, clean slugs and legacy slugs', () => {
    expect(slugMatches('Haydn (Joseph)', 'Haydn (Joseph)')).toBe(true);
    expect(slugMatches('Haydn (Joseph)', 'haydn-joseph')).toBe(true);
    expect(slugMatches('Haydn (Joseph)', 'HAYDN-JOSEPH')).toBe(true);
    expect(slugMatches('Haydn (Joseph)', toLegacySlug('Haydn (Joseph)'))).toBe(true);
    expect(slugMatches('Haydn (Joseph)', 'haydn-michael')).toBe(false);
  });
});

describe('findWork', () => {
  const sample = [
    { name: 'Gilbert & Sullivan', works: [{ name: 'Trial by Jury', sections: [] }] },
    { name: 'Gilbert&Sullivan', works: [{ name: 'Merry Madrigal', sections: [] }] },
    { name: 'Verdi', works: [{ name: 'Requiem', sections: [] }] }
  ];

  test('looks under every composer sharing a slug', () => {
    expect(findWork(sample, 'gilbert-and-sullivan', 'merry-madrigal').composer.name).toBe('Gilbert&Sullivan');
    expect(findWork(sample, 'gilbert-and-sullivan', 'trial-by-jury').composer.name).toBe('Gilbert & Sullivan');
  });

  test('prefers an exact name over a slug match', () => {
    expect(findByNameOrSlug(sample, 'Gilbert&Sullivan').name).toBe('Gilbert&Sullivan');
  });

  test('ignores trailing punctuation from a pasted link', () => {
    expect(findWork(sample, 'verdi', 'requiem.').work.name).toBe('Requiem');
    expect(findWork(sample, 'verdi', 'requiem),').work.name).toBe('Requiem');
  });

  test('returns null when nothing matches', () => {
    expect(findWork(sample, 'verdi', 'aida')).toBeNull();
    expect(findWork(sample, 'nobody', 'requiem')).toBeNull();
  });

  test('every work in the index is found by its clean slugs', () => {
    const missing = [];
    for (const composer of index) {
      for (const work of composer.works) {
        const found = findWork(index, toSlug(composer.name), toSlug(work.name));
        // Two copies of the same piece can share a slug; the first is used
        if (!found || toSlug(found.work.name) !== toSlug(work.name)) {
          missing.push(`${composer.name} / ${work.name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
