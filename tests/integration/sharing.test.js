/**
 * Integration tests for sharing pieces and sets
 */

const request = require('supertest');
const { convertFile } = require('../../public/practice-midi/convert.js');
const { TPQ, track, song, line, notes, midiBytes } = require('../unit/practice-midi/helpers.js');

const HOST = 'player.test';

function satb() {
  return song([
    track('Soprano', line(0, 72), notes(0, [[64 * TPQ, 72, TPQ, 100]])),
    track('Alto', line(1, 65)),
    track('Tenor', line(2, 59)),
    track('Bass', line(3, 50))
  ]);
}

describe('Sharing', () => {
  let app;
  let practiceMidi;

  beforeAll(async () => {
    const server = require('../../server');
    app = server.app;
    await server.scraper.loadIndex();
    practiceMidi = Buffer.from((await convertFile(midiBytes(satb()), 'Anthem.mid')).midi);
  });

  const send = (method, url, cookie) => {
    const req = request(app)[method](url).set('Host', HOST).set('Origin', `http://${HOST}`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const cookieOf = response => response.headers['set-cookie'][0].split(';')[0];
  const binary = req => req.buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  // A library with uploaded pieces; returns its cookie and piece ids
  async function owner(titles = ['Gloria'], composer = 'Vivaldi') {
    let cookie;
    const ids = [];
    for (const title of titles) {
      const saved = await send('post', '/api/library/pieces', cookie)
        .send({ title, composer, midi: practiceMidi.toString('base64') });
      cookie = cookie || cookieOf(saved);
      ids.push(saved.body.piece.id);
    }
    return { cookie, ids };
  }
  const attest = cookie => send('post', '/api/library/attest', cookie).send({ confirmed: true });
  const uploads = ids => ids.map(pieceId => ({ kind: 'upload', pieceId }));

  test('sharing needs the owner\'s confirmation first', async () => {
    const { cookie, ids } = await owner();
    const refused = await send('post', `/api/library/pieces/${ids[0]}/share`, cookie);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/confirm/);

    expect((await send('post', '/api/library/attest', cookie).send({})).status).toBe(400);
    expect((await attest(cookie)).body).toEqual({ attested: true });
    expect((await send('get', '/api/library', cookie)).body.attested).toBe(true);
  });

  test('a piece needs a composer before it can be shared', async () => {
    const { cookie, ids } = await owner(['Anthem'], '');
    await attest(cookie);
    const refused = await send('post', `/api/library/pieces/${ids[0]}/share`, cookie);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/composer/);
  });

  test('share links are made from the name plus a short random ending', async () => {
    const { cookie, ids } = await owner(['Gloria in excelsis']);
    await attest(cookie);
    const token = (await send('post', `/api/library/pieces/${ids[0]}/share`, cookie)).body.shareToken;
    expect(token).toMatch(/^vivaldi-gloria-in-excelsis-[a-z0-9]{4}$/);
  });

  test('a shared piece can be opened and played by anyone with the link, then unshared', async () => {
    const { cookie, ids } = await owner();
    await attest(cookie);
    const token = (await send('post', `/api/library/pieces/${ids[0]}/share`, cookie)).body.shareToken;
    // Sharing again keeps the same link
    expect((await send('post', `/api/library/pieces/${ids[0]}/share`, cookie)).body.shareToken).toBe(token);

    const info = await request(app).get(`/api/shared/p/${token}`);
    expect(info.body).toEqual({ kind: 'piece', title: 'Gloria', composer: 'Vivaldi', pieceId: ids[0], isOwner: false, inLibrary: false });
    expect(info.headers['x-robots-tag']).toBe('noindex');
    expect((await request(app).get(`/api/shared/p/${token}`).set('Cookie', cookie)).body.isOwner).toBe(true);

    const midi = await binary(request(app).get(`/api/shared/p/${token}/midi`));
    expect(Buffer.compare(midi.body, practiceMidi)).toBe(0);

    const page = await request(app).get(`/p/${token}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>Gloria - Shared Piece | MyChoralPart</title>');
    expect(page.text).toContain('<meta name="robots" content="noindex">');

    expect((await send('delete', `/api/library/pieces/${ids[0]}/share`, cookie)).status).toBe(204);
    expect((await request(app).get(`/api/shared/p/${token}`)).status).toBe(404);
    expect((await request(app).get(`/p/${token}`)).status).toBe(404);
  });

  test('sets mix uploaded files with catalogue works and movements, in order', async () => {
    const { cookie, ids } = await owner(['Kyrie', 'Credo']);
    const items = [
      { kind: 'work', composer: 'Handel', work: 'Messiah' },
      { kind: 'upload', pieceId: ids[1] },
      { kind: 'movement', composer: 'Handel', work: 'Messiah', movement: '3: And the glory of the Lord' },
      { kind: 'upload', pieceId: ids[0] }
    ];
    const created = await send('post', '/api/library/sets', cookie).send({ title: 'Spring concert 2027', items });
    expect(created.status).toBe(201);
    const set = created.body.set;
    expect(set.items).toEqual([
      { kind: 'work', composer: 'Handel', work: 'Messiah' },
      { kind: 'upload', pieceId: ids[1], title: 'Credo', composer: 'Vivaldi' },
      { kind: 'movement', composer: 'Handel', work: 'Messiah', movement: '3: And the glory of the Lord', midiUrl: '/Handel/Messiah/03-glory.mid' },
      { kind: 'upload', pieceId: ids[0], title: 'Kyrie', composer: 'Vivaldi' }
    ]);

    // Reorder
    const updated = await send('patch', `/api/library/sets/${set.id}`, cookie).send({ items: [items[3], items[0]] });
    expect(updated.body.set.items.map(i => i.kind)).toEqual(['upload', 'work']);

    await attest(cookie);
    const token = (await send('post', `/api/library/sets/${set.id}/share`, cookie)).body.shareToken;
    expect(token).toMatch(/^spring-concert-2027-[a-z0-9]{4}$/);

    const info = await request(app).get(`/api/shared/s/${token}`);
    expect(info.body.title).toBe('Spring concert 2027');
    expect(info.body.items.map(i => i.kind)).toEqual(['upload', 'work']);

    expect((await binary(request(app).get(`/api/shared/s/${token}/pieces/${ids[0]}/midi`))).status).toBe(200);
    // Only uploaded files in the set can be fetched through its link
    expect((await request(app).get(`/api/shared/s/${token}/pieces/${ids[1]}/midi`)).status).toBe(404);

    // Deleting an uploaded file removes it from the set
    await send('delete', `/api/library/pieces/${ids[0]}`, cookie);
    expect((await request(app).get(`/api/shared/s/${token}`)).body.items.map(i => i.kind)).toEqual(['work']);

    expect((await request(app).get(`/s/${token}`)).text).toContain('Spring concert 2027 - Shared Set');
  });

  test('set items must be the owner\'s uploads or real catalogue entries', async () => {
    const mine = await owner(['Mine']);
    const theirs = await owner(['Theirs']);
    const create = items => send('post', '/api/library/sets', mine.cookie).send({ title: 'Test', items });

    expect((await create([{ kind: 'upload', pieceId: theirs.ids[0] }])).status).toBe(400);
    expect((await create([{ kind: 'work', composer: 'Handel', work: 'No such work' }])).status).toBe(400);
    expect((await create([{ kind: 'movement', composer: 'Handel', work: 'Messiah', movement: 'Not a movement' }])).status).toBe(400);
    expect((await create([{ kind: 'something' }])).status).toBe(400);
    // The same piece twice is fine (e.g. a reprise)
    expect((await create(uploads([mine.ids[0], mine.ids[0]]))).status).toBe(201);
  });

  test('recipients can add shared pieces and sets to their list, which follow the owner', async () => {
    const { cookie, ids } = await owner(['Ave verum']);
    await attest(cookie);
    const pieceToken = (await send('post', `/api/library/pieces/${ids[0]}/share`, cookie)).body.shareToken;
    const setId = (await send('post', '/api/library/sets', cookie).send({ title: 'Motets', items: uploads(ids) })).body.set.id;
    const setToken = (await send('post', `/api/library/sets/${setId}/share`, cookie)).body.shareToken;

    // A new visitor adding a link gets a library (and cookie) of their own
    const added = await send('post', '/api/library/references').send({ kind: 'piece', token: pieceToken });
    expect(added.status).toBe(201);
    const recipient = cookieOf(added);
    expect((await send('post', '/api/library/references', recipient).send({ kind: 'set', token: setToken })).status).toBe(201);

    let list = (await send('get', '/api/library', recipient)).body;
    expect(list.pieces).toEqual([]);
    expect(list.references.map(r => [r.kind, r.title, r.available])).toEqual(
      expect.arrayContaining([['piece', 'Ave verum', true], ['set', 'Motets', true]]));
    expect(list.references.find(r => r.kind === 'set').itemCount).toBe(1);
    expect((await request(app).get(`/api/shared/p/${pieceToken}`).set('Cookie', recipient)).body.inLibrary).toBe(true);

    await send('patch', `/api/library/pieces/${ids[0]}`, cookie).send({ title: 'Ave verum corpus' });
    await send('delete', `/api/library/sets/${setId}/share`, cookie);
    list = (await send('get', '/api/library', recipient)).body;
    expect(list.references.find(r => r.kind === 'piece').title).toBe('Ave verum corpus');
    expect(list.references.find(r => r.kind === 'set').available).toBe(false);

    expect((await send('post', '/api/library/references', cookie).send({ kind: 'piece', token: pieceToken })).status).toBe(400);
    expect((await send('post', '/api/library/references', recipient).send({ kind: 'piece', token: 'no-such-link-abcd' })).status).toBe(404);

    expect((await send('delete', `/api/library/references/set/${setToken}`, recipient)).status).toBe(204);
    expect((await send('get', '/api/library', recipient)).body.references).toHaveLength(1);
  });

  test('unknown share links are not found', async () => {
    expect((await request(app).get('/api/shared/p/no-such-link-abcd')).status).toBe(404);
    expect((await request(app).get('/api/shared/s/Not_A_Token!')).status).toBe(404);
    const page = await request(app).get('/s/no-such-link-abcd');
    expect(page.status).toBe(404);
    expect(page.text).toContain('Shared Link Not Available');
  });
});
