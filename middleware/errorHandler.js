/**
 * Error Handling Middleware
 * Centralized error handling for all routes
 * SECURITY: Sanitizes error messages to avoid information disclosure
 */

// Generic error messages for production (avoid leaking internal details)
const GENERIC_ERRORS = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  500: 'Internal server error',
  502: 'Bad gateway',
  503: 'Service unavailable',
  504: 'Gateway timeout'
};

// Safe error messages that can be shown to users
const SAFE_ERROR_PATTERNS = [
  /URL parameter/i,
  /Invalid URL/i,
  /Domain not allowed/i,
  /Composer and work are required/i,
  /copyright/i,
  /rate limit/i,
  /timeout/i,
  /MIDI file/i,
  /HTTP/i
];

/**
 * Check if an error message is safe to show to users
 * @param {string} message - Error message
 * @returns {boolean} True if message is safe
 */
function isSafeErrorMessage(message) {
  if (!message) return false;
  return SAFE_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Sanitize error message for client response
 * @param {string} message - Original error message
 * @param {number} statusCode - HTTP status code
 * @returns {string} Sanitized message
 */
function sanitizeErrorMessage(message, statusCode) {
  // In development, show full messages
  if (process.env.NODE_ENV === 'development') {
    return message;
  }

  // If message is known to be safe, return it
  if (isSafeErrorMessage(message)) {
    return message;
  }

  // Otherwise return generic message based on status code
  return GENERIC_ERRORS[statusCode] || GENERIC_ERRORS[500];
}

/**
 * Error handler middleware
 * @param {Error} err - Error object
 * @param {express.Request} req - Express request
 * @param {express.Response} res - Express response
 * @param {express.NextFunction} next - Express next function
 */
function errorHandler(err, req, res, next) {
  // Log error for debugging (server-side only)
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  console.error('Path:', req.path);

  // Default to 500 server error
  const statusCode = err.statusCode || 500;
  const rawMessage = err.message || 'Internal server error';

  // Sanitize message for client response
  const sanitizedMessage = sanitizeErrorMessage(rawMessage, statusCode);

  // Send error response
  res.status(statusCode).json({
    error: sanitizedMessage,
    // Only include stack trace in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

/**
 * 404 handler for unknown routes
 * @param {express.Request} req - Express request
 * @param {express.Response} res - Express response
 */
function notFoundHandler(req, res) {
  // Don't expose the path in production to avoid information leakage
  const response = { error: 'Route not found' };
  if (process.env.NODE_ENV === 'development') {
    response.path = req.path;
  }
  res.status(404).json(response);
}

module.exports = {
  errorHandler,
  notFoundHandler
};
