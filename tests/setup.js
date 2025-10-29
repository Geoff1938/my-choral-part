// Global test setup

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
