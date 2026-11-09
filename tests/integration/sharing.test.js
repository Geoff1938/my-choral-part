/**
 * Integration tests for sharing pieces and sets (M5)
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
    app = require('../../server').app;
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

  // A library with saved pieces; returns its cookie and piece ids
  async function owner(titles = ['Gloria']) {
    let cookie;
    const ids = [];
    for (const title of titles) {
      const saved = await send('post', '/api/library/pieces', cookie)
        .send({ title, composer: 'Vivaldi', midi: practiceMidi.toString('base64') });
      cookie = cookie || cookieOf(saved);
      ids.push(saved.body.piece.id);
    }
    return { cookie, ids };
  }

  test('sharing needs the owner\'s confirmation first', async () => {
    const { cookie, ids } = await owner();
    const refused = await send('post', `/api/library/pieces/${ids[0]}/share`, cookie);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/confirm/);

    expect((await send('post', '/api/library/attest', cookie).send({})).status).toBe(400);
    expect((await send('post', '/api/library/attest', cookie).send({ confirmed: true })).body).toEqual({ attested: true });
    expect((await send('get', '/api/library', cookie)).body.attested).toBe(true);
  });

  test('a shared piece can be opened and played by anyone with the link, then unshared', async () => {
    const { cookie, ids } = await owner();
    await send('post', '/api/library/attest', cookie).send({ confirmed: true });
    const shared = await send('post', `/api/library/pieces/${ids[0]}/share`, cookie);
    const token = shared.body.shareToken;
    expect(token).toMatch(/^[A-Za-z0-9_-]{16}$/);
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

  test('sets keep their pieces in order and can be shared', async () => {
    const { cookie, ids } = await owner(['Kyrie', 'Gloria', 'Credo']);
    const created = await send('post', '/api/library/sets', cookie).send({ title: 'Spring concert', pieceIds: [ids[2], ids[0]] });
    expect(created.status).toBe(201);
    const setId = created.body.set.id;
    expect(created.body.set.pieceIds).toEqual([ids[2], ids[0]]);

    const updated = await send('patch', `/api/library/sets/${setId}`, cookie).send({ pieceIds: [ids[0], ids[1], ids[2]] });
    expect(updated.body.set.pieceIds).toEqual(ids);

    await send('post', '/api/library/attest', cookie).send({ confirmed: true });
    const token = (await send('post', `/api/library/sets/${setId}/share`, cookie)).body.shareToken;

    const info = await request(app).get(`/api/shared/s/${token}`);
    expect(info.body.title).toBe('Spring concert');
    expect(info.body.pieces.map(p => p.title)).toEqual(['Kyrie', 'Gloria', 'Credo']);

    expect((await binary(request(app).get(`/api/shared/s/${token}/pieces/${ids[1]}/midi`))).status).toBe(200);
    // Only pieces in the set can be fetched through its link
    const other = await owner(['Not in the set']);
    expect((await request(app).get(`/api/shared/s/${token}/pieces/${other.ids[0]}/midi`)).status).toBe(404);

    // Deleting a piece removes it from the set
    await send('delete', `/api/library/pieces/${ids[1]}`, cookie);
    expect((await request(app).get(`/api/shared/s/${token}`)).body.pieces.map(p => p.title)).toEqual(['Kyrie', 'Credo']);

    expect((await request(app).get(`/s/${token}`)).text).toContain('Spring concert - Shared Set');
  });

  test('a set can only contain the owner\'s own pieces', async () => {
    const mine = await owner(['Mine']);
    const theirs = await owner(['Theirs']);
    const response = await send('post', '/api/library/sets', mine.cookie).send({ title: 'Mixed', pieceIds: [mine.ids[0], theirs.ids[0]] });
    expect(response.status).toBe(400);
    expect((await send('post', '/api/library/sets', mine.cookie).send({ title: 'Twice', pieceIds: [mine.ids[0], mine.ids[0]] })).status).toBe(400);
  });

  test('recipients can add shared pieces and sets to their library, which follow the owner', async () => {
    const { cookie, ids } = await owner(['Ave verum']);
    await send('post', '/api/library/attest', cookie).send({ confirmed: true });
    const pieceToken = (await send('post', `/api/library/pieces/${ids[0]}/share`, cookie)).body.shareToken;
    const setId = (await send('post', '/api/library/sets', cookie).send({ title: 'Motets', pieceIds: ids })).body.set.id;
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
    expect((await request(app).get(`/api/shared/p/${pieceToken}`).set('Cookie', recipient)).body.inLibrary).toBe(true);

    // The owner renames: the recipient sees the new title. The owner stops sharing: no longer available.
    await send('patch', `/api/library/pieces/${ids[0]}`, cookie).send({ title: 'Ave verum corpus' });
    await send('delete', `/api/library/sets/${setId}/share`, cookie);
    list = (await send('get', '/api/library', recipient)).body;
    expect(list.references.find(r => r.kind === 'piece').title).toBe('Ave verum corpus');
    expect(list.references.find(r => r.kind === 'set').available).toBe(false);

    // Owners can't add their own links; unknown links are refused
    expect((await send('post', '/api/library/references', cookie).send({ kind: 'piece', token: pieceToken })).status).toBe(400);
    expect((await send('post', '/api/library/references', recipient).send({ kind: 'piece', token: 'AAAAAAAAAAAAAAAA' })).status).toBe(404);

    expect((await send('delete', `/api/library/references/set/${setToken}`, recipient)).status).toBe(204);
    expect((await send('get', '/api/library', recipient)).body.references).toHaveLength(1);
  });

  test('unknown share links are not found', async () => {
    expect((await request(app).get('/api/shared/p/AAAAAAAAAAAAAAAA')).status).toBe(404);
    expect((await request(app).get('/api/shared/s/not-a-token')).status).toBe(404);
    const page = await request(app).get('/s/AAAAAAAAAAAAAAAA');
    expect(page.status).toBe(404);
    expect(page.text).toContain('Shared Link Not Available');
  });
});
