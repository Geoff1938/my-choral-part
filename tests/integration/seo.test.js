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

  test('clean slugs resolve', async () => {
    const response = await request(app).get('/bach-js/cantata-140');

    expect(response.status).toBe(200);
    expect(response.text).toContain('(Bach, JS)');
    expect(response.text).toContain('"@type":"MusicComposition"');
  });

  test('old-style share links redirect permanently to the clean URL', async () => {
    const cases = [
      ['/bach%2C-js/cantata-140', '/bach-js/cantata-140'],
      ['/haydn-(joseph)/10.-paukenmesse-(mass-in-time-of-war)-(second-mass)',
        '/haydn-joseph/10-paukenmesse-mass-in-time-of-war-second-mass'],
      ['/Handel/Messiah', '/handel/messiah'],
      ['/handel/messiah.', '/handel/messiah'],
      ['/Handel/Messiah?part=alto', '/handel/messiah?part=alto']
    ];
    for (const [from, to] of cases) {
      const response = await request(app).get(from);
      expect(response.status).toBe(301);
      expect(response.headers.location).toBe(to);
    }
  });

  test('composer pages list works with links', async () => {
    const response = await request(app).get('/handel');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Handel - Choral Works to Rehearse | MyChoralPart</title>');
    expect(response.text).toContain('href="/handel/messiah"');
    expect(response.text).toContain('<link rel="canonical" href="https://player.mychoralpart.com/handel">');
  });

  test('old-style composer URLs redirect and unknown composers 404', async () => {
    const old = await request(app).get('/haydn-(joseph)');
    expect(old.status).toBe(301);
    expect(old.headers.location).toBe('/haydn-joseph');

    const unknown = await request(app).get('/no-such-composer');
    expect(unknown.status).toBe(404);
    expect(unknown.text).toContain('<meta name="robots" content="noindex">');
  });

  test('composer list links every composer', async () => {
    const response = await request(app).get('/composers');

    expect(response.status).toBe(200);
    expect(response.text).toContain('href="/handel"');
    expect(response.text.match(/<li><a href=/g).length).toBeGreaterThan(350);
  });

  test('missing files and unknown API routes are not treated as pages', async () => {
    for (const url of ['/favicon.ico', '/api/unknown', '/branding/missing.png']) {
      const response = await request(app).get(url);
      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    }
  });

  test('player page no longer loads the Font Awesome stylesheet', async () => {
    const response = await request(app).get('/');

    expect(response.text).not.toContain('font-awesome');
    expect(response.text.match(/<svg class="icon"/g)).toHaveLength(10);
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
    expect(response.text).toContain('<loc>https://player.mychoralpart.com/composers</loc>');
    expect(response.text).toContain('<loc>https://player.mychoralpart.com/handel</loc>');
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
