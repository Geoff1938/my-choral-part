/**
 * Error Handling Middleware
 * Centralized error handling for all routes
 */

/**
 * Error handler middleware
 * @param {Error} err - Error object
 * @param {express.Request} req - Express request
 * @param {express.Response} res - Express response
 * @param {express.NextFunction} next - Express next function
 */
function errorHandler(err, req, res, next) {
  // Log error for debugging
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  console.error('Path:', req.path);

  // Default to 500 server error
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  // Send error response
  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

/**
 * 404 handler for unknown routes
 * @param {express.Request} req - Express request
 * @param {express.Response} res - Express response
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Route not found',
    path: req.path
  });
}

module.exports = {
  errorHandler,
  notFoundHandler
};
