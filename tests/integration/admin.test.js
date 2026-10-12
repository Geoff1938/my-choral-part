/**
 * Integration tests for admin authentication (users come from ADMIN_USERS)
 * Uses a throwaway database so the real data/activity.db is untouched
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const request = require('supertest');

const TEST_DB_PATH = path.join(os.tmpdir(), `admin-test-${process.pid}.db`);
process.env.DATABASE_PATH = TEST_DB_PATH;
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

  afterAll(() => {
    fs.rmSync(TEST_DB_PATH, { force: true });
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
