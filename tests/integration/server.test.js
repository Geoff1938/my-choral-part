/**
 * Integration tests for Server API endpoints
 * Tests all routes and error handling
 */

const https = require('https');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const request = require('supertest');

describe('API Integration Tests', () => {
  let app;

  beforeAll(() => {
    // Load the Express app (server.js exports { app, scraper })
    const server = require('../../server');
    app = server.app;
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

    describe('with the upstream site stubbed', () => {
      // Fake https.get: each call takes the next entry from `responses`,
      // either { status, headers, body } or 'timeout'
      let responses;
      let upstreamResponses;

      beforeEach(() => {
        responses = [];
        upstreamResponses = [];
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(https, 'get').mockImplementation((url, options, callback) => {
          const upstreamRequest = new EventEmitter();
          upstreamRequest.destroy = jest.fn();
          const next = responses.shift();
          process.nextTick(() => {
            if (next === 'timeout') {
              upstreamRequest.emit('timeout');
              return;
            }
            const upstreamResponse = new PassThrough();
            upstreamResponse.statusCode = next.status;
            upstreamResponse.headers = next.headers || {};
            upstreamResponse.resume = jest.fn(upstreamResponse.resume.bind(upstreamResponse));
            upstreamResponses.push(upstreamResponse);
            callback(upstreamResponse);
            upstreamResponse.end(next.body || '');
          });
          return upstreamRequest;
        });
      });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      const proxy = (url = 'https://www.learnchoralmusic.co.uk/test.mid') =>
        request(app).get('/proxy').query({ url }).buffer(true)
          .parse((res, done) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
          });

      test('allows learnchoralmusic.co.uk domain and streams the file with a day of caching', async () => {
        responses.push({ status: 200, headers: { 'content-length': '4' }, body: 'MThd' });

        const response = await proxy();

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('audio/midi');
        expect(response.headers['cache-control']).toBe('public, max-age=86400');
        expect(response.body.toString()).toBe('MThd');
        expect(https.get.mock.calls[0][1].headers).not.toHaveProperty('Accept-Encoding');
      });

      test('follows a redirect, drains it, and passes a 404 through uncached', async () => {
        responses.push({ status: 302, headers: { location: '/moved.mid' } });
        responses.push({ status: 404 });

        const response = await proxy();

        expect(https.get.mock.calls[1][0]).toBe('https://www.learnchoralmusic.co.uk/moved.mid');
        expect(upstreamResponses[0].resume).toHaveBeenCalled();
        expect(upstreamResponses[1].resume).toHaveBeenCalled();
        expect(response.status).toBe(404);
        expect(response.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
      });

      test('reports an upstream timeout as 504', async () => {
        responses.push('timeout');

        const response = await proxy();

        expect(response.status).toBe(504);
      });
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
