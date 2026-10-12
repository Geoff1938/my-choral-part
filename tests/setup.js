// Global test setup

const os = require('os');
const path = require('path');
const fs = require('fs');

// Point the activity database and index data directory at a throwaway
// folder so tests never touch the repo's data/ folder. Test files may
// override these before requiring the server.
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choral-test-'));
process.env.DATABASE_PATH = path.join(testDataDir, 'activity.db');
process.env.DATA_DIR = testDataDir;

afterAll(() => {
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

// Mock browser APIs for Node.js environment
global.localStorage = {
  data: {},
  getItem(key) {
    return this.data[key] || null;
  },
  setItem(key, value) {
    this.data[key] = String(value);
  },
  removeItem(key) {
    delete this.data[key];
  },
  clear() {
    this.data = {};
  }
};

global.navigator = {
  userAgent: 'Mozilla/5.0 (Test Environment)',
  deviceMemory: undefined,
  connection: undefined
};

global.fetch = jest.fn();

// Extend Jest matchers
expect.extend({
  toBeValidMIDIUrl(received) {
    const pass = /^https?:\/\/.+\.(mid|midi)$/i.test(received);
    return {
      message: () => `expected ${received} to be a valid MIDI URL`,
      pass
    };
  }
});

// Reset mocks after each test
afterEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});
