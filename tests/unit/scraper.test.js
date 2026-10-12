/**
 * Unit tests for the index rebuild safety checks, data directory handling
 * and the scheduler's one-rebuild-at-a-time guard.
 * Uses temp DATA_DIR / DATABASE_PATH so the repo's data folder is untouched.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ChoralMusicScraper = require('../../scraper');

const makeIndex = (composers, worksEach = 2) =>
  Array.from({ length: composers }, (_, c) => ({
    name: `Composer ${c}`,
    works: Array.from({ length: worksEach }, (_, w) => ({
      name: `Work ${w}`,
      url: `/c${c}/w${w}/`,
      sections: [{ name: 'Full', url: `/c${c}/w${w}/full.mid` }]
    }))
  }));

let tempDir;
const savedEnv = { DATA_DIR: process.env.DATA_DIR, DATABASE_PATH: process.env.DATABASE_PATH };

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choral-index-test-'));
  process.env.DATA_DIR = tempDir;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe('checkIndexSize', () => {
  test('accepts a rebuild of similar size', () => {
    expect(ChoralMusicScraper.checkIndexSize(makeIndex(100), makeIndex(95)).ok).toBe(true);
  });

  test('accepts any non-empty rebuild when there is no current index', () => {
    expect(ChoralMusicScraper.checkIndexSize(null, makeIndex(3)).ok).toBe(true);
  });

  test('rejects a rebuild with far fewer composers', () => {
    const result = ChoralMusicScraper.checkIndexSize(makeIndex(100), makeIndex(80));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/80 composers against 100/);
  });

  test('rejects a rebuild with far fewer works', () => {
    const result = ChoralMusicScraper.checkIndexSize(makeIndex(100, 10), makeIndex(100, 5));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/works/);
  });

  test('rejects an empty rebuild', () => {
    expect(ChoralMusicScraper.checkIndexSize(null, []).ok).toBe(false);
  });
});

describe('Data directory', () => {
  test('uses DATA_DIR, else the DATABASE_PATH folder', () => {
    expect(new ChoralMusicScraper().dataFile).toBe(path.join(tempDir, 'midi-index-full.json'));

    delete process.env.DATA_DIR;
    process.env.DATABASE_PATH = path.join(tempDir, 'sub', 'activity.db');
    expect(new ChoralMusicScraper().dataDir).toBe(path.join(tempDir, 'sub'));
  });

  test('seeds missing index files from the shipped copies without overwriting', async () => {
    fs.writeFileSync(path.join(tempDir, 'initial-index.json'), '[{"name":"Mine","works":[]}]');

    await new ChoralMusicScraper().ensureInitialIndex();

    expect(fs.existsSync(path.join(tempDir, 'midi-index-full.json'))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, 'initial-index.json'), 'utf8')).toContain('Mine');
  });

  test('loadIndex falls back to the shipped index if the file is unreadable', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(path.join(tempDir, 'midi-index-full.json'), '{ truncated');

    const index = await new ChoralMusicScraper().loadIndex();

    expect(index.length).toBeGreaterThan(100);
  });
});

describe('buildCompleteIndex', () => {
  const stubScraper = (composers) => {
    const scraper = new ChoralMusicScraper();
    scraper.requestDelay = 0;
    scraper.scrapeComposerList = async () => composers.map(c => ({
      name: c.name,
      works: c.works.map(w => ({ name: w.name, url: w.url }))
    }));
    scraper.scrapeWorkSections = async () => [{ name: 'Full', url: '/x/full.mid' }];
    scraper.mergeSongsIntoIndex = async () => {};
    return scraper;
  };

  test('does not overwrite the index when the rebuild is much smaller', async () => {
    const indexFile = path.join(tempDir, 'midi-index-full.json');
    fs.writeFileSync(indexFile, JSON.stringify(makeIndex(50)));

    await expect(stubScraper(makeIndex(10)).buildCompleteIndex())
      .rejects.toThrow(/not saved: only 10 composers against 50/);
    expect(JSON.parse(fs.readFileSync(indexFile, 'utf8'))).toHaveLength(50);
  });

  test('fails when the composer list cannot be scraped', async () => {
    await expect(stubScraper([]).buildCompleteIndex()).rejects.toThrow(/Composer list/);
  });

  test('writes a rebuild of similar size atomically', async () => {
    const indexFile = path.join(tempDir, 'midi-index-full.json');
    fs.writeFileSync(indexFile, JSON.stringify(makeIndex(50)));

    await stubScraper(makeIndex(49)).buildCompleteIndex();

    expect(JSON.parse(fs.readFileSync(indexFile, 'utf8'))).toHaveLength(49);
    expect(fs.existsSync(`${indexFile}.tmp`)).toBe(false);
  });
});

describe('fetchPage', () => {
  test('retries on 503 and then succeeds', async () => {
    const scraper = new ChoralMusicScraper();
    scraper.retryDelays = [1, 1];
    const get = jest.spyOn(axios, 'get')
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ data: 'ok' });

    await expect(scraper.fetchPage('https://example.test/')).resolves.toEqual({ data: 'ok' });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1].timeout).toBe(20000);
  });

  test('does not retry a 404', async () => {
    const scraper = new ChoralMusicScraper();
    const get = jest.spyOn(axios, 'get').mockRejectedValue({ response: { status: 404 } });

    await expect(scraper.fetchPage('https://example.test/')).rejects.toEqual({ response: { status: 404 } });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('Scheduler rebuild guard', () => {
  test('a second rebuild request while one is running does not start another', async () => {
    process.env.DATABASE_PATH = path.join(tempDir, 'activity.db');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let scheduler;
    let IsolatedScraper;
    jest.isolateModules(() => {
      scheduler = require('../../utils/scheduler');
      IsolatedScraper = require('../../scraper');
    });

    let finish;
    const build = jest.spyOn(IsolatedScraper.prototype, 'buildCompleteIndex')
      .mockImplementation(() => new Promise(resolve => { finish = resolve; }));

    const first = scheduler.runIndexRebuild();
    expect(scheduler.isRebuildRunning()).toBe(true);
    const second = await scheduler.runIndexRebuild();
    expect(second.alreadyRunning).toBe(true);

    finish(makeIndex(3));
    expect((await first).success).toBe(true);
    expect(scheduler.isRebuildRunning()).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);
  });
});
