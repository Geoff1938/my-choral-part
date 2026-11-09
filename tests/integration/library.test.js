/**
 * Integration tests for the library API (/api/library) and its storage
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { convertFile } = require('../../public/practice-midi/convert.js');
const { TPQ, track, song, line, notes, midiBytes } = require('../unit/practice-midi/helpers.js');
const library = require('../../utils/library');

const HOST = 'player.test';

function satb() {
  return song([
    track('Soprano', line(0, 72), notes(0, [[64 * TPQ, 72, TPQ, 100]])),
    track('Alto', line(1, 65)),
    track('Tenor', line(2, 59)),
    track('Bass', line(3, 50))
  ]);
}

describe('Library API', () => {
  let app;
  let practiceMidi;

  beforeAll(async () => {
    app = require('../../server').app;
    practiceMidi = Buffer.from((await convertFile(midiBytes(satb()), 'Anthem.mid')).midi);
  });

  // Requests as the site itself sends them (same-origin)
  const send = (method, url, cookie) => {
    const req = request(app)[method](url).set('Host', HOST).set('Origin', `http://${HOST}`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const cookieOf = response => response.headers['set-cookie'][0].split(';')[0];
  const save = (cookie, body = {}) => send('post', '/api/library/pieces', cookie)
    .send({ title: 'Anthem', composer: 'Smith', midi: practiceMidi.toString('base64'), ...body });

  test('a new visitor has an empty library and no cookie', async () => {
    const response = await send('get', '/api/library');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ pieces: [], sets: [], references: [], attested: false, limit: 100 });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('the first save creates the library and sets an HttpOnly cookie', async () => {
    const response = await save();
    expect(response.status).toBe(201);
    expect(response.body.piece).toMatchObject({ title: 'Anthem', composer: 'Smith', sizeBytes: practiceMidi.length });
    expect(response.headers['set-cookie'][0]).toMatch(/^mcp_library=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax/);

    const list = await send('get', '/api/library', cookieOf(response));
    expect(list.body.pieces.map(p => p.title)).toEqual(['Anthem']);
  });

  test('a saved piece can be played, renamed and deleted', async () => {
    const saved = await save(undefined, { title: '  Gloria   in excelsis ' });
    const cookie = cookieOf(saved);
    const id = saved.body.piece.id;
    expect(saved.body.piece.title).toBe('Gloria in excelsis');

    const midi = await send('get', `/api/library/pieces/${id}/midi`, cookie).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(midi.status).toBe(200);
    expect(midi.headers['content-type']).toBe('audio/midi');
    expect(Buffer.compare(midi.body, practiceMidi)).toBe(0);

    const renamed = await send('patch', `/api/library/pieces/${id}`, cookie).send({ title: 'Gloria', composer: '' });
    expect(renamed.body.piece).toMatchObject({ title: 'Gloria', composer: '' });

    const deleted = await send('delete', `/api/library/pieces/${id}`, cookie);
    expect(deleted.status).toBe(204);
    expect((await send('get', '/api/library', cookie)).body.pieces).toEqual([]);
    expect((await send('get', `/api/library/pieces/${id}/midi`, cookie)).status).toBe(404);
  });

  test('one library cannot see or change another\'s pieces', async () => {
    const mine = await save();
    const theirs = await save();
    const id = mine.body.piece.id;
    const otherCookie = cookieOf(theirs);

    expect((await send('get', `/api/library/pieces/${id}/midi`, otherCookie)).status).toBe(404);
    expect((await send('patch', `/api/library/pieces/${id}`, otherCookie).send({ title: 'Mine now' })).status).toBe(404);
    expect((await send('delete', `/api/library/pieces/${id}`, otherCookie)).status).toBe(404);
    expect((await send('get', `/api/library/pieces/${id}/midi`)).status).toBe(404);
  });

  test('changes from another site are refused', async () => {
    const response = await request(app).post('/api/library/pieces')
      .set('Host', HOST).set('Origin', 'https://evil.example')
      .send({ title: 'x', midi: practiceMidi.toString('base64') });
    expect(response.status).toBe(403);
  });

  test('files that are not practice MIDIs are refused', async () => {
    const junk = await save(undefined, { midi: Buffer.from('not a midi file').toString('base64') });
    expect(junk.status).toBe(400);
    expect(junk.body.error).toMatch(/valid MIDI/);

    const instrumentsOnly = midiBytes(song([track('Organ', line(0, 60))]));
    const noVoices = await save(undefined, { midi: Buffer.from(instrumentsOnly).toString('base64') });
    expect(noVoices.status).toBe(400);
    expect(noVoices.body.error).toMatch(/practice file/);

    expect((await save(undefined, { midi: undefined })).status).toBe(400);
    expect((await save(undefined, { title: '   ' })).status).toBe(400);
    expect((await save(undefined, { title: 'x'.repeat(201) })).status).toBe(400);
  });

  test('a full library refuses new pieces', async () => {
    const original = library.LIMITS.PIECES_PER_LIBRARY;
    library.LIMITS.PIECES_PER_LIBRARY = 1;
    try {
      const first = await save();
      const second = await save(cookieOf(first));
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/My uploaded files is full/);
    } finally {
      library.LIMITS.PIECES_PER_LIBRARY = original;
    }
  });

  test('saving stops when the storage limit is reached', async () => {
    const original = library.LIMITS.MAX_TOTAL_BYTES;
    library.LIMITS.MAX_TOTAL_BYTES = 1;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await save()).status).toBe(507);
    } finally {
      library.LIMITS.MAX_TOTAL_BYTES = original;
      console.error.mockRestore();
    }
  });

  test('libraries unused for the retention period are deleted with their files', async () => {
    const saved = await save();
    const cookie = cookieOf(saved);
    const file = path.join(process.env.DATA_DIR, 'library', `${saved.body.piece.id}.mid`);
    expect(fs.existsSync(file)).toBe(true);

    jest.spyOn(console, 'log').mockImplementation(() => {});
    // A retention period of 0 years treats every library as unused
    const removed = await library.purgeOldLibraries(0);
    console.log.mockRestore();

    expect(removed).toBeGreaterThan(0);
    expect(fs.existsSync(file)).toBe(false);
    expect((await send('get', '/api/library', cookie)).body.pieces).toEqual([]);
  });

  test('the nightly backup copies library.db', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const backupPath = await library.backupLibrary(new Date('2026-11-09T12:00:00Z'));
    console.log.mockRestore();
    expect(path.basename(backupPath)).toBe('library-2026-11-09.db');
    expect(fs.existsSync(backupPath)).toBe(true);
  });
});
