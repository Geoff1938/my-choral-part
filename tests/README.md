# Testing Guide

## Quick Start

### 1. Install Test Dependencies
```bash
npm install --save-dev jest supertest
```

### 2. Run Tests
```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration
```

### 3. View Coverage Report
After running `npm run test:coverage`, open:
```
coverage/lcov-report/index.html
```

## Test Structure

```
tests/
├── setup.js                    # Global test setup (mocks, etc.)
├── unit/                       # Unit tests (isolated functions)
│   └── utils/
│       ├── formatters.test.js  # Time formatting tests
│       └── validation.test.js  # Input validation tests
└── integration/                # Integration tests (API endpoints)
    └── server.test.js          # Server API tests
```

## Writing New Tests

### Unit Test Example
```javascript
// tests/unit/myFunction.test.js
describe('My Function', () => {
    test('should do something', () => {
        expect(myFunction(input)).toBe(expectedOutput);
    });
});
```

### Integration Test Example
```javascript
// tests/integration/myEndpoint.test.js
const request = require('supertest');
const app = require('../../server');

describe('GET /api/myendpoint', () => {
    test('returns correct data', async () => {
        const response = await request(app).get('/api/myendpoint');
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('data');
    });
});
```

## Current Test Status

✅ **formatters.test.js** - Time formatting utilities (12 tests)
✅ **validation.test.js** - URL and voice part validation (20+ tests)
⏳ **server.test.js** - API endpoint tests (requires app export from server.js)

## Adding More Tests

See **CODE_REVIEW.md** for:
- Complete testing strategy
- Recommended test cases
- Coverage goals
- Priority order

## Continuous Integration

Tests will run automatically on:
- Every push to GitHub
- Every pull request
- Before deployment to Render

See `.github/workflows/test.yml` (to be created)
