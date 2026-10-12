module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],

  // Coverage configuration
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    '*.js',
    'routes/**/*.js',
    'utils/**/*.js',
    'middleware/**/*.js',
    'public/**/*.js',
    '!public/vendor/**',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!jest.config.js',
    '!babel.config.js'
  ],

  // No coverageThreshold yet: app.js and the root scripts are untested, so
  // global coverage is ~10%. Add thresholds once real coverage justifies them.

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    '/data/',
    '/.claude/'
  ],

  // Verbose output
  verbose: true
};
