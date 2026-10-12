/**
 * Integration tests for admin authentication (users come from ADMIN_USERS)
 * Uses the throwaway database set up in tests/setup.js
 */

const request = require('supertest');

// Never start a real index rebuild (it would scrape the live site)
jest.mock('../../utils/scheduler', () => ({
  ...jest.requireActual('../../utils/scheduler'),
  runIndexRebuild: jest.fn().mockResolvedValue({ success: true })
}));
const { runIndexRebuild } = require('../../utils/scheduler');

process.env.ADMIN_USERS = JSON.stringify({
  'Admin@Example.com': 'correct horse: battery staple'
});

const basicAuth = (email, password) =>
  'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');

describe('Admin authentication', () => {
  let app;

  beforeAll(() => {
    app = require('../../server').app;
  });

  test('rejects requests without credentials', async () => {
    const response = await request(app).get('/admin/api/summary');

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toMatch(/Basic/);
  });

  test('accepts a configured user, including a password containing a colon', async () => {
    const response = await request(app)
      .get('/admin/api/summary')
      .set('Authorization', basicAuth('admin@example.com', 'correct horse: battery staple'));

    expect(response.status).toBe(200);
  });

  test('rejects a wrong password', async () => {
    const response = await request(app)
      .get('/admin/api/summary')
      .set('Authorization', basicAuth('admin@example.com', 'wrong'));

    expect(response.status).toBe(401);
  });

  test('rejects users not listed in ADMIN_USERS', async () => {
    const response = await request(app)
      .get('/admin/api/summary')
      .set('Authorization', basicAuth('someone@example.com', 'correct horse: battery staple'));

    expect(response.status).toBe(401);
  });
});

describe('Admin request protection', () => {
  let app;
  const auth = basicAuth('admin@example.com', 'correct horse: battery staple');

  beforeAll(() => {
    app = require('../../server').app;
  });

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('blocks a rebuild POST without an Origin or Referer', async () => {
    const response = await request(app)
      .post('/admin/api/rebuild-index')
      .set('CF-Connecting-IP', '192.0.2.10')
      .set('Authorization', auth);

    expect(response.status).toBe(403);
    expect(runIndexRebuild).not.toHaveBeenCalled();
  });

  test('blocks a rebuild POST from another site', async () => {
    const response = await request(app)
      .post('/admin/api/rebuild-index')
      .set('CF-Connecting-IP', '192.0.2.10')
      .set('Host', 'player.example.test')
      .set('Origin', 'https://evil.example.test')
      .set('Authorization', auth);

    expect(response.status).toBe(403);
    expect(runIndexRebuild).not.toHaveBeenCalled();
  });

  test('allows a rebuild POST from the admin page itself', async () => {
    const response = await request(app)
      .post('/admin/api/rebuild-index')
      .set('CF-Connecting-IP', '192.0.2.10')
      .set('Host', 'player.example.test')
      .set('Referer', 'https://player.example.test/admin')
      .set('Authorization', auth);

    expect(response.status).toBe(200);
    expect(runIndexRebuild).toHaveBeenCalledTimes(1);
  });

  test('limits repeated failed requests from one client', async () => {
    for (let i = 0; i < 20; i++) {
      const response = await request(app)
        .get('/admin/api/summary')
        .set('CF-Connecting-IP', '192.0.2.20');
      expect(response.status).toBe(401);
    }

    const limited = await request(app)
      .get('/admin/api/summary')
      .set('CF-Connecting-IP', '192.0.2.20')
      .set('Authorization', auth);
    const otherClient = await request(app)
      .get('/admin/api/summary')
      .set('CF-Connecting-IP', '192.0.2.21')
      .set('Authorization', auth);

    expect(limited.status).toBe(429);
    expect(otherClient.status).toBe(200);
  });
});

describe('parseAdminUsers', () => {
  const { parseAdminUsers } = require('../../utils/database');

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('parses a JSON object of email to password', () => {
    expect(parseAdminUsers('{"A@B.com": "pw1", "c@d.com": "pw2"}')).toEqual([
      { email: 'a@b.com', password: 'pw1' },
      { email: 'c@d.com', password: 'pw2' }
    ]);
  });

  test('returns null when unset', () => {
    expect(parseAdminUsers(undefined)).toBeNull();
    expect(parseAdminUsers('')).toBeNull();
  });

  test('returns null for invalid JSON or the wrong shape', () => {
    expect(parseAdminUsers('not json')).toBeNull();
    expect(parseAdminUsers('["a@b.com", "pw"]')).toBeNull();
    expect(parseAdminUsers('"just a string"')).toBeNull();
  });

  test('ignores entries with empty or non-string passwords', () => {
    expect(parseAdminUsers('{"a@b.com": "", "c@d.com": 123}')).toBeNull();
    expect(parseAdminUsers('{"a@b.com": "", "c@d.com": "ok"}')).toEqual([
      { email: 'c@d.com', password: 'ok' }
    ]);
  });
});
