// Example integration test - Server API endpoints
// NOTE: This requires 'supertest' package: npm install --save-dev supertest

const request = require('supertest');

// Mock the server without starting it
// You'll need to export 'app' from server.js: module.exports = app;
describe('API Integration Tests', () => {
  let app;

  beforeAll(() => {
    // Load the Express app
    // app = require('../../server');
  });

  describe('GET /api/index', () => {
    test('returns MIDI index array', async () => {
      const response = await request(app).get('/api/index');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    test('returns composers with correct structure', async () => {
      const response = await request(app).get('/api/index');

      const composer = response.body[0];
      expect(composer).toHaveProperty('name');
      expect(composer).toHaveProperty('works');
      expect(Array.isArray(composer.works)).toBe(true);
    });
  });

  describe('GET /api/search/composers', () => {
    test('filters by query parameter', async () => {
      const response = await request(app)
        .get('/api/search/composers')
        .query({ q: 'bach' });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      // All results should contain 'bach' (case-insensitive)
      response.body.forEach(composer => {
        expect(composer.name.toLowerCase()).toContain('bach');
      });
    });

    test('returns empty array for non-existent composer', async () => {
      const response = await request(app)
        .get('/api/search/composers')
        .query({ q: 'zzzzzzzzz' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    test('handles missing query parameter', async () => {
      const response = await request(app).get('/api/search/composers');

      expect(response.status).toBe(200);
      // Should return all composers when no query
    });
  });

  describe('GET /api/composer/:composerName/works', () => {
    test('returns works for existing composer', async () => {
      const response = await request(app)
        .get('/api/composer/Bach/works');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    test('handles URL-encoded composer names', async () => {
      const response = await request(app)
        .get('/api/composer/Alessandro%20Scarlatti/works');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('returns empty array for non-existent composer', async () => {
      const response = await request(app)
        .get('/api/composer/NonExistentComposer/works');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('GET /api/recent-works', () => {
    test('returns recent works array', async () => {
      const response = await request(app).get('/api/recent-works');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('POST /api/recent-works', () => {
    test('saves recent work', async () => {
      const response = await request(app)
        .post('/api/recent-works')
        .send({ composer: 'Bach', work: 'Mass in B Minor' });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('requires composer field', async () => {
      const response = await request(app)
        .post('/api/recent-works')
        .send({ work: 'Mass in B Minor' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('requires work field', async () => {
      const response = await request(app)
        .post('/api/recent-works')
        .send({ composer: 'Bach' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /proxy', () => {
    test('requires URL parameter', async () => {
      const response = await request(app).get('/proxy');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('URL parameter');
    });

    test('validates URL parameter', async () => {
      const response = await request(app)
        .get('/proxy')
        .query({ url: 'not-a-valid-url' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid URL');
    });

    // Note: Full proxy testing would require mocking external HTTP requests
  });

  describe('Error Handling', () => {
    test('returns 404 for unknown routes', async () => {
      const response = await request(app).get('/api/unknown-endpoint');

      expect(response.status).toBe(404);
    });

    test('handles malformed JSON in POST requests', async () => {
      const response = await request(app)
        .post('/api/recent-works')
        .send('{ invalid json }')
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
    });
  });
});

// To enable these tests, add this to server.js at the end:
// if (typeof module !== 'undefined' && module.exports) {
//   module.exports = app;
// }
