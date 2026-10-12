/**
 * Integration tests for JS module versioning and cache headers
 */

const request = require('supertest');

describe('JS module versioning', () => {
  let app;

  beforeAll(() => {
    app = require('../../server').app;
  });

  test('versioned app.js has its relative imports version-busted', async () => {
    const response = await request(app).get('/app.js?v=test');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.text).toMatch(/from '\.\/constants\.js\?v=[^']+'/);
    expect(response.text).toMatch(/from '\.\/player\/InstrumentLoader\.js\?v=[^']+'/);
    expect(response.text).not.toMatch(/from '\.\/constants\.js'/);
  });

  test('nested modules rewrite parent-relative imports', async () => {
    const response = await request(app).get('/player/InstrumentLoader.js?v=test');

    expect(response.status).toBe(200);
    expect(response.text).toMatch(/from '\.\.\/constants\.js\?v=[^']+'/);
  });

  test('absolute vendor imports are left alone', async () => {
    const response = await request(app).get('/app.js?v=test');

    expect(response.text).toContain("import('/vendor/spessasynth_lib.js')");
  });

  test('unversioned module URLs must be revalidated', async () => {
    const response = await request(app).get('/constants.js');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  test('vendor files are still cached for a year', async () => {
    const response = await request(app).get('/vendor/midi.js');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  test('service worker is not rewritten or cached', async () => {
    const response = await request(app).get('/service-worker.js');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  test('missing JS files still 404', async () => {
    const response = await request(app).get('/does-not-exist.js');

    expect(response.status).toBe(404);
  });

  test('path traversal is not served', async () => {
    const response = await request(app).get('/..%2fserver.js');

    expect(response.status).not.toBe(200);
  });
});
