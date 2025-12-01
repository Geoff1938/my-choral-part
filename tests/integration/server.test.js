/**
 * Integration tests for Server API endpoints
 * Tests all routes and error handling
 */

const request = require('supertest');

describe('API Integration Tests', () => {
  let app;

  beforeAll(() => {
    // Load the Express app (server.js exports the app)
    app = require('../../server');
  });

  describe('GET /api/composer/:composerName/works', () => {
    test('returns works for existing composer', async () => {
      const response = await request(app)
        .get('/api/composer/Bach, JS/works');

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

    test('rejects non-allowed domains', async () => {
      const response = await request(app)
        .get('/proxy')
        .query({ url: 'https://evil-site.com/malware.mid' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Domain not allowed');
    });

    test('rejects non-HTTP protocols', async () => {
      const response = await request(app)
        .get('/proxy')
        .query({ url: 'ftp://www.learnchoralmusic.co.uk/file.mid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('HTTP');
    });

    test('allows learnchoralmusic.co.uk domain', async () => {
      // Note: This test only validates URL acceptance, not actual fetching
      // The actual fetch will fail since we're not mocking the HTTP request
      const response = await request(app)
        .get('/proxy')
        .query({ url: 'https://www.learnchoralmusic.co.uk/test.mid' });

      // Should not be 400 (bad URL) or 403 (forbidden domain)
      // It will likely be 500 or timeout since the file doesn't exist
      expect(response.status).not.toBe(400);
      expect(response.status).not.toBe(403);
    });
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
