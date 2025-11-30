/**
 * Simple Logger Utility
 * Provides logging with levels that can be controlled by environment
 *
 * Log levels:
 * - error: Always shown
 * - warn: Shown in development and production
 * - info: Shown in development only
 * - debug: Shown in development only when DEBUG=true
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Determine log level from environment
function getLogLevel() {
  if (process.env.DEBUG === 'true') {
    return LOG_LEVELS.debug;
  }
  if (process.env.NODE_ENV === 'production') {
    return LOG_LEVELS.warn;
  }
  return LOG_LEVELS.info;
}

const currentLevel = getLogLevel();

/**
 * Format log message with timestamp
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @returns {string} Formatted message
 */
function formatMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

const logger = {
  /**
   * Log error message (always shown)
   */
  error: (...args) => {
    console.error(formatMessage('error', args.join(' ')));
  },

  /**
   * Log warning message (shown in all environments)
   */
  warn: (...args) => {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', args.join(' ')));
    }
  },

  /**
   * Log info message (hidden in production)
   */
  info: (...args) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(formatMessage('info', args.join(' ')));
    }
  },

  /**
   * Log debug message (only when DEBUG=true)
   */
  debug: (...args) => {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(formatMessage('debug', args.join(' ')));
    }
  }
};

module.exports = logger;
