/**
 * Integration tests for per-work page metadata, sitemap and robots.txt
 */

const request = require('supertest');

describe('Search engine support', () => {
  let app;

  beforeAll(() => {
    app = require('../../server').app;
  });

  test('home page has its own title, description and canonical URL', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>MyChoralPart Player - Find and Rehearse Your Choir Part</title>');
    expect(response.text).toContain('<meta name="description"');
    expect(response.text).toContain('<link rel="canonical" href="https://player.mychoralpart.com/">');
    expect(response.text).toContain('<html lang="en-GB">');
    expect(response.text).not.toContain('seo:body');
  });

  test('work pages get the work title and canonical URL', async () => {
    const response = await request(app).get('/handel/messiah');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Messiah (Handel) - Practise Your Choir Part | MyChoralPart</title>');
    expect(response.text).toContain('<link rel="canonical" href="https://player.mychoralpart.com/handel/messiah">');
    expect(response.text).toContain('<noscript>');
    expect(response.text).not.toContain('noindex');
    expect(response.text).toMatch(/app\.js\?v=\d{4}-\d{2}-\d{2}\./);
  });

  test('percent-encoded share links resolve', async () => {
    const response = await request(app).get('/bach%2C-js/cantata-140');

    expect(response.status).toBe(200);
    expect(response.text).toContain('(Bach, JS)');
  });

  test('unknown works return 404 with noindex but still load the player', async () => {
    const response = await request(app).get('/nobody/nothing');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('<meta name="robots" content="noindex">');
    expect(response.text).not.toContain('rel="canonical"');
    expect(response.text).toContain('app.js?v=');
  });

  test('sitemap lists the home page and works', async () => {
    const response = await request(app).get('/sitemap.xml');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/xml/);
    expect(response.text).toContain('<loc>https://player.mychoralpart.com/</loc>');
    expect(response.text).toContain('<loc>https://player.mychoralpart.com/handel/messiah</loc>');
    expect(response.text.match(/<url>/g).length).toBeGreaterThan(1000);
  });

  test('robots.txt blocks the proxy and admin and points to the sitemap', async () => {
    const response = await request(app).get('/robots.txt');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Disallow: /proxy');
    expect(response.text).toContain('Disallow: /admin');
    expect(response.text).not.toContain('Disallow: /api');
    expect(response.text).toContain('Sitemap: https://player.mychoralpart.com/sitemap.xml');
  });

  test('admin page is marked noindex', async () => {
    const response = await request(app).get('/admin.html');

    expect(response.text).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});
