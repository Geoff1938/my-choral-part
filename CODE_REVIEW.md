# Code Review & Testing Strategy

## Current Codebase Analysis

**Total Lines of Code**: ~3,400 lines
- `public/app.js`: 1,877 lines (main application)
- `scraper.js`: 506 lines (MIDI index builder)
- `test-midi-index.js`: 430 lines (validation script)
- `server.js`: 241 lines (Express server)
- `analyze-cached-works.js`: 159 lines (analysis tool)
- `public/service-worker.js`: 121 lines (PWA caching)

---

## A) CLEANUP RECOMMENDATIONS

### 1. **CRITICAL: Refactor `public/app.js` (1,877 lines)**

**Problem**: Single monolithic class is too large to maintain

**Recommendation**: Split into modules
```
src/
├── player/
│   ├── MIDIPlayer.js          (core playback)
│   ├── AudioSetup.js           (Tone.js/Soundfont setup)
│   └── InstrumentLoader.js     (instrument caching)
├── ui/
│   ├── TabManager.js           (tab switching)
│   ├── ControlsManager.js      (playback controls)
│   ├── ChannelsManager.js      (channel selection)
│   └── StatusManager.js        (status messages)
├── api/
│   ├── IndexAPI.js             (MIDI index queries)
│   └── RecentWorksManager.js   (localStorage management)
└── utils/
    ├── deviceDetection.js      (memory checks)
    ├── urlUtils.js             (URL parsing/sharing)
    └── formatters.js           (time formatting)
```

### 2. **Extract Magic Numbers to Constants**

**Current Issues**:
- Hardcoded timeout values (30000, 10000, 500)
- Volume ranges (-Infinity to +10 dB)
- Tempo ranges (0.25 to 2.0)
- Memory thresholds (4GB, 6GB)

**Recommendation**: Create `constants.js`
```javascript
export const TIMEOUTS = {
    MIDI_FETCH: 30000,
    INSTRUMENT_LOAD: 10000,
    AUTO_PLAY_DELAY: 500
};

export const AUDIO = {
    MIN_VOLUME_DB: -60,
    MAX_VOLUME_DB: 10,
    DEFAULT_VOLUME_DB: -10,
    MIN_TEMPO: 0.25,
    MAX_TEMPO: 2.0
};

export const MEMORY_THRESHOLDS = {
    LOW_MEMORY_GB: 4,
    MOBILE_LOW_MEMORY_GB: 6
};
```

### 3. **Improve Error Handling**

**Current Issues**:
- Inconsistent error handling patterns
- Some try-catch blocks are too broad
- Not all async functions handle errors

**Recommendations**:
```javascript
// Create custom error classes
class MIDILoadError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = 'MIDILoadError';
        this.cause = cause;
    }
}

class InstrumentLoadError extends Error {
    constructor(instrumentName, cause) {
        super(`Failed to load ${instrumentName}`);
        this.name = 'InstrumentLoadError';
        this.instrumentName = instrumentName;
        this.cause = cause;
    }
}

// Use specific error types
async loadInstrument(name) {
    try {
        return await Soundfont.instrument(...);
    } catch (error) {
        throw new InstrumentLoadError(name, error);
    }
}
```

### 4. **Add Input Validation**

**Current Issues**:
- Limited validation on user inputs
- URLs not thoroughly validated
- No sanitization of localStorage data

**Recommendations**:
```javascript
// utils/validation.js
export function validateMIDIUrl(url) {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol');
        }
        if (!url.match(/\.(mid|midi)$/i) && !url.includes('learnchoralmusic.co.uk')) {
            throw new Error('Invalid MIDI URL');
        }
        return true;
    } catch (error) {
        throw new ValidationError('Invalid URL format', error);
    }
}

export function validateVoicePart(part) {
    const valid = ['soprano', 'alto', 'tenor', 'bass'];
    if (!valid.includes(part)) {
        throw new ValidationError(`Voice part must be one of: ${valid.join(', ')}`);
    }
    return true;
}
```

### 5. **Reduce Code Duplication**

**Current Issues**:
- Similar error handling patterns repeated
- Duplicate gain node creation code
- Repeated status message patterns

**Recommendations**:
```javascript
// Extract common patterns
async function withRetry(fn, maxAttempts = 3, delayMs = 1000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxAttempts - 1) throw error;
            await delay(delayMs * Math.pow(2, attempt));
        }
    }
}

// Use throughout codebase
const midi = await withRetry(() =>
    fetch(url).then(r => r.arrayBuffer())
);
```

### 6. **Server.js Improvements**

**Current Issues**:
- Large route handlers inline
- No request validation middleware
- Limited logging

**Recommendations**:
```javascript
// routes/api.js
const express = require('express');
const router = express.Router();
const { validateComposerName, validateWorkName } = require('./middleware/validation');

router.get('/composer/:composerName/works',
    validateComposerName,
    async (req, res) => {
        // Handler logic
    }
);

// middleware/validation.js
function validateComposerName(req, res, next) {
    const { composerName } = req.params;
    if (!composerName || composerName.length > 200) {
        return res.status(400).json({ error: 'Invalid composer name' });
    }
    next();
}

// Add request logging
const morgan = require('morgan');
app.use(morgan('combined'));
```

### 7. **Service Worker Improvements**

**Current**: Hardcoded instrument list

**Recommendation**: Dynamic cache based on usage statistics
```javascript
// Generate from test results automatically
const CACHED_INSTRUMENTS = [
    'acoustic_grand_piano',  // 890 uses
    'piccolo',               // 3139 uses
    'clarinet',              // 3184 uses
    'bassoon',               // 3347 uses
    'french_horn',           // 3561 uses
    'string_ensemble_1'      // 5666 uses
];

// Add version checking
const CACHE_VERSION = 'v2'; // Increment when changing cache
```

### 8. **Add TypeScript or JSDoc**

**Recommendation**: At minimum, add JSDoc comments for type safety
```javascript
/**
 * Load a MIDI file from a URL
 * @param {string} url - The URL of the MIDI file
 * @param {string|null} title - Optional title for the movement
 * @returns {Promise<void>}
 * @throws {MIDILoadError} If the MIDI file cannot be loaded
 */
async loadMIDIFromURL(url, title = null) {
    // ...
}

/**
 * @typedef {Object} DeviceInfo
 * @property {boolean} hasLimitedMemory
 * @property {boolean} isMobile
 * @property {number|undefined} deviceMemory
 * @property {string} info
 */
```

---

## B) UNIT TESTING STRATEGY

### Testing Framework Recommendation

**Jest** - Best choice because:
- Zero config for Node.js
- Built-in mocking
- Code coverage reports
- Snapshot testing
- Works with ES6 modules

### Installation
```bash
npm install --save-dev jest @testing-library/jest-dom
```

### Test Structure
```
tests/
├── unit/
│   ├── player/
│   │   ├── MIDIPlayer.test.js
│   │   ├── InstrumentLoader.test.js
│   │   └── AudioSetup.test.js
│   ├── ui/
│   │   ├── TabManager.test.js
│   │   └── ControlsManager.test.js
│   ├── api/
│   │   ├── IndexAPI.test.js
│   │   └── RecentWorksManager.test.js
│   └── utils/
│       ├── deviceDetection.test.js
│       ├── urlUtils.test.js
│       └── validation.test.js
├── integration/
│   ├── server.test.js
│   ├── scraper.test.js
│   └── api-endpoints.test.js
└── e2e/
    └── playback.test.js (Playwright/Cypress)
```

---

## PRIORITY UNIT TESTS

### 1. **Utils Tests** (Start Here - Easiest)

**tests/unit/utils/deviceDetection.test.js**
```javascript
describe('Device Detection', () => {
    test('detects low memory devices', () => {
        // Mock navigator.deviceMemory
        global.navigator = { deviceMemory: 2 };
        expect(hasLimitedMemory()).toBe(true);
    });

    test('detects mobile devices', () => {
        global.navigator = {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)'
        };
        expect(isMobile()).toBe(true);
    });

    test('handles missing deviceMemory API', () => {
        global.navigator = {};
        expect(() => checkDeviceCapabilities()).not.toThrow();
    });
});
```

**tests/unit/utils/validation.test.js**
```javascript
describe('URL Validation', () => {
    test('accepts valid MIDI URLs', () => {
        const validUrls = [
            'https://example.com/file.mid',
            'http://example.com/file.midi',
            'https://www.learnchoralmusic.co.uk/Handel/Messiah/01.mid'
        ];
        validUrls.forEach(url => {
            expect(() => validateMIDIUrl(url)).not.toThrow();
        });
    });

    test('rejects invalid URLs', () => {
        expect(() => validateMIDIUrl('not-a-url')).toThrow();
        expect(() => validateMIDIUrl('ftp://example.com/file.mid')).toThrow();
        expect(() => validateMIDIUrl('javascript:alert(1)')).toThrow();
    });

    test('rejects HTML files as MIDI', () => {
        expect(() => validateMIDIUrl('https://example.com/file.html')).toThrow();
    });
});

describe('Voice Part Validation', () => {
    test('accepts valid voice parts', () => {
        ['soprano', 'alto', 'tenor', 'bass'].forEach(part => {
            expect(() => validateVoicePart(part)).not.toThrow();
        });
    });

    test('rejects invalid voice parts', () => {
        expect(() => validateVoicePart('baritone')).toThrow();
        expect(() => validateVoicePart('')).toThrow();
        expect(() => validateVoicePart(null)).toThrow();
    });
});
```

**tests/unit/utils/formatters.test.js**
```javascript
describe('Time Formatting', () => {
    test('formats seconds as MM:SS', () => {
        expect(formatTime(0)).toBe('0:00');
        expect(formatTime(65)).toBe('1:05');
        expect(formatTime(125)).toBe('2:05');
        expect(formatTime(3661)).toBe('61:01'); // Over an hour
    });

    test('handles negative times', () => {
        expect(formatTime(-5)).toBe('0:00');
    });

    test('handles NaN and undefined', () => {
        expect(formatTime(NaN)).toBe('0:00');
        expect(formatTime(undefined)).toBe('0:00');
    });
});
```

### 2. **API Tests** (Core Functionality)

**tests/unit/api/IndexAPI.test.js**
```javascript
describe('MIDI Index API', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    test('loads composers from index', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => [
                { name: 'Bach', works: [] },
                { name: 'Handel', works: [] }
            ]
        });

        const composers = await loadComposers();
        expect(composers).toHaveLength(2);
        expect(composers[0].name).toBe('Bach');
    });

    test('handles API errors gracefully', async () => {
        fetch.mockRejectedValueOnce(new Error('Network error'));

        await expect(loadComposers()).rejects.toThrow('Network error');
    });

    test('searches composers by prefix', async () => {
        const index = [
            { name: 'Bach', works: [] },
            { name: 'Beethoven', works: [] },
            { name: 'Handel', works: [] }
        ];

        const results = searchComposers('Ba', index);
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Bach');
    });
});
```

**tests/unit/api/RecentWorksManager.test.js**
```javascript
describe('Recent Works Manager', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    test('saves recent works to localStorage', async () => {
        await saveRecentWork('Bach', 'Mass in B Minor');

        const recent = await getRecentWorks();
        expect(recent).toHaveLength(1);
        expect(recent[0]).toEqual({
            composer: 'Bach',
            work: 'Mass in B Minor'
        });
    });

    test('limits recent works to 5 items', async () => {
        for (let i = 0; i < 10; i++) {
            await saveRecentWork(`Composer${i}`, `Work${i}`);
        }

        const recent = await getRecentWorks();
        expect(recent).toHaveLength(5);
        expect(recent[0].composer).toBe('Composer9'); // Most recent
    });

    test('deduplicates recent works', async () => {
        await saveRecentWork('Bach', 'Mass');
        await saveRecentWork('Handel', 'Messiah');
        await saveRecentWork('Bach', 'Mass'); // Duplicate

        const recent = await getRecentWorks();
        expect(recent).toHaveLength(2);
        expect(recent[0].composer).toBe('Bach'); // Moved to top
    });
});
```

### 3. **Player Tests** (Complex but Critical)

**tests/unit/player/InstrumentLoader.test.js**
```javascript
describe('Instrument Loader', () => {
    test('caches loaded instruments', async () => {
        const loader = new InstrumentLoader();
        const mockInstrument = { play: jest.fn() };

        // Mock Soundfont.instrument
        global.Soundfont = {
            instrument: jest.fn().mockResolvedValue(mockInstrument)
        };

        await loader.loadInstrument('piano');
        await loader.loadInstrument('piano'); // Second call

        // Should only call Soundfont once due to caching
        expect(Soundfont.instrument).toHaveBeenCalledTimes(1);
    });

    test('falls back to piano on error', async () => {
        const loader = new InstrumentLoader();

        global.Soundfont = {
            instrument: jest.fn()
                .mockRejectedValueOnce(new Error('Invalid instrument'))
                .mockResolvedValueOnce({ play: jest.fn() })
        };

        const result = await loader.loadInstrument('invalid_instrument');

        expect(result.instrumentName).toBe('acoustic_grand_piano');
        expect(result.isFallback).toBe(true);
    });

    test('handles memory errors', async () => {
        const loader = new InstrumentLoader();

        global.Soundfont = {
            instrument: jest.fn().mockRejectedValue(
                new Error('Quota exceeded')
            )
        };

        await expect(loader.loadInstrument('piano'))
            .rejects.toThrow(InstrumentLoadError);
    });
});
```

### 4. **Server Tests** (Integration)

**tests/integration/server.test.js**
```javascript
const request = require('supertest');
const app = require('../server');

describe('API Endpoints', () => {
    test('GET /api/index returns MIDI index', async () => {
        const response = await request(app).get('/api/index');

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
    });

    test('GET /api/search/composers filters by query', async () => {
        const response = await request(app)
            .get('/api/search/composers')
            .query({ q: 'bach' });

        expect(response.status).toBe(200);
        expect(response.body.every(c =>
            c.name.toLowerCase().includes('bach')
        )).toBe(true);
    });

    test('GET /api/composer/:name/works returns works', async () => {
        const response = await request(app)
            .get('/api/composer/Bach/works');

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
    });

    test('GET /proxy requires URL parameter', async () => {
        const response = await request(app).get('/proxy');

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('URL parameter');
    });

    test('POST /api/recent-works saves work', async () => {
        const response = await request(app)
            .post('/api/recent-works')
            .send({ composer: 'Bach', work: 'Mass in B Minor' });

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
    });
});

describe('Error Handling', () => {
    test('returns 404 for invalid routes', async () => {
        const response = await request(app).get('/api/invalid');
        expect(response.status).toBe(404);
    });

    test('handles malformed JSON gracefully', async () => {
        const response = await request(app)
            .post('/api/recent-works')
            .send('invalid json')
            .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
    });
});
```

### 5. **Scraper Tests**

**tests/integration/scraper.test.js**
```javascript
const ChoralMusicScraper = require('../scraper');

describe('Choral Music Scraper', () => {
    let scraper;

    beforeEach(() => {
        scraper = new ChoralMusicScraper();
    });

    test('loads existing index', async () => {
        const index = await scraper.loadIndex();
        expect(Array.isArray(index)).toBe(true);
    });

    test('searches composers case-insensitively', async () => {
        const results = await scraper.searchComposers('BACH');
        expect(results.some(c => c.name.includes('Bach'))).toBe(true);
    });

    test('filters works by search term', async () => {
        const results = await scraper.advancedSearch('magnificat', {
            works: true
        });

        expect(results.every(r =>
            r.work.toLowerCase().includes('magnificat')
        )).toBe(true);
    });

    test('gets works for composer', async () => {
        const works = await scraper.getComposerWorks('Bach');
        expect(Array.isArray(works)).toBe(true);
        expect(works.length).toBeGreaterThan(0);
    });

    test('handles non-existent composer', async () => {
        const works = await scraper.getComposerWorks('NonExistentComposer');
        expect(works).toEqual([]);
    });
});
```

---

## CONTINUOUS INTEGRATION

### GitHub Actions Workflow

**`.github/workflows/test.yml`**
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test

      - name: Run integration tests
        run: npm run test:integration

      - name: Check code coverage
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/coverage-final.json
```

### package.json Scripts

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:e2e": "playwright test",
    "lint": "eslint *.js public/*.js",
    "pretest": "npm run lint"
  }
}
```

---

## COVERAGE GOALS

- **Unit Tests**: 80%+ coverage
- **Integration Tests**: All API endpoints covered
- **Critical Paths**: 100% coverage
  - MIDI loading
  - Instrument loading
  - Playback controls
  - Error handling

---

## IMPLEMENTATION PLAN

### Phase 1: Setup (1-2 hours)
1. Install Jest and testing dependencies
2. Create test directory structure
3. Add npm test scripts
4. Configure Jest (jest.config.js)

### Phase 2: Utils Tests (2-3 hours)
1. Write validation tests
2. Write formatter tests
3. Write device detection tests
4. Achieve 80%+ coverage on utils

### Phase 3: API Tests (3-4 hours)
1. Write IndexAPI tests
2. Write RecentWorksManager tests
3. Mock fetch calls
4. Test error scenarios

### Phase 4: Server Tests (2-3 hours)
1. Install supertest
2. Write endpoint tests
3. Test error handling
4. Test CORS proxy

### Phase 5: Player Tests (4-6 hours)
1. Mock Tone.js and Soundfont
2. Test instrument loading
3. Test playback controls
4. Test memory error handling

### Phase 6: CI/CD (1-2 hours)
1. Create GitHub Actions workflow
2. Add code coverage reporting
3. Add linting checks
4. Configure deployment gates

**Total Estimate**: 15-20 hours

---

## PRIORITY ORDER

1. **Highest Priority** (Do First):
   - Utils tests (validation, formatters)
   - API endpoint tests
   - Error handling tests

2. **High Priority** (Do Soon):
   - Scraper tests
   - Recent works manager tests
   - URL parsing tests

3. **Medium Priority** (Important):
   - Instrument loading tests
   - Device detection tests
   - Service worker tests

4. **Lower Priority** (Nice to Have):
   - UI interaction tests
   - E2E tests with Playwright
   - Performance tests

---

## TESTING BEST PRACTICES

1. **AAA Pattern**: Arrange, Act, Assert
2. **One assertion per test** (when possible)
3. **Clear test names**: `test('should X when Y')`
4. **Mock external dependencies** (fetch, Tone.js, etc.)
5. **Test edge cases**: null, undefined, empty strings
6. **Test error paths**: Not just happy paths
7. **Use beforeEach/afterEach** for setup/cleanup
8. **Don't test implementation details**: Test behavior

---

## NEXT STEPS

1. Review and approve this plan
2. Install Jest: `npm install --save-dev jest`
3. Create test directory structure
4. Start with utils tests (easiest wins)
5. Gradually increase coverage
6. Add CI/CD pipeline
7. Make tests required before merge
