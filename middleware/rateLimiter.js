/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse
 */

const rateLimit = require('express-rate-limit');

// General API rate limiter - more permissive
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests. Please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Stricter limiter for proxy endpoint (prevent abuse)
const proxyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 proxy requests per minute
  message: {
    error: 'Too many MIDI file requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Very strict limiter for search to prevent scraping
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 searches per minute
  message: {
    error: 'Too many search requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for POST endpoints (save operations)
const writeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // Limit each IP to 20 writes per minute
  message: {
    error: 'Too many save requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  apiLimiter,
  proxyLimiter,
  searchLimiter,
  writeLimiter
};
