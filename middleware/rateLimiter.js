/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse
 */

const net = require('net');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Rate limit key for a request: the client's IP address.
 * With 'trust proxy' set to 1, req.ip is the Cloudflare edge that forwarded
 * the request, so everyone using the same edge would share one bucket.
 * Cloudflare puts the real client address in CF-Connecting-IP, so prefer
 * that. The header can be spoofed by calling the onrender.com URL directly,
 * which only lets someone choose their own bucket - acceptable for a rate
 * limiter, but never use this for anything security-sensitive.
 * IPv6 addresses are grouped by /56 subnet (ipKeyGenerator) so a client
 * cannot dodge the limit by rotating through its own addresses.
 * @param {express.Request} req - Express request
 * @returns {string} Rate limit key
 */
function clientKey(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  const ip = typeof cfIp === 'string' && net.isIP(cfIp.trim()) ? cfIp.trim() : req.ip;
  return ipKeyGenerator(ip || 'unknown');
}

// Options shared by every limiter
const commonOptions = {
  keyGenerator: clientKey,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
};

// General API rate limiter - more permissive
const apiLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each client to 100 requests per windowMs
  message: {
    error: 'Too many requests. Please try again later.'
  },
});

// Stricter limiter for proxy endpoint (prevent abuse)
const proxyLimiter = rateLimit({
  ...commonOptions,
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each client to 30 proxy requests per minute
  message: {
    error: 'Too many MIDI file requests. Please slow down.'
  },
});

// Very strict limiter for search to prevent scraping
const searchLimiter = rateLimit({
  ...commonOptions,
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit each client to 60 searches per minute
  message: {
    error: 'Too many search requests. Please slow down.'
  },
});

// Limiter for POST endpoints (save operations)
const writeLimiter = rateLimit({
  ...commonOptions,
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // Limit each client to 20 writes per minute
  message: {
    error: 'Too many save requests. Please slow down.'
  },
});

// Activity logging (POST /api/activity/log) - a normal page sends a handful
// of events per minute at most
const activityLogLimiter = rateLimit({
  ...commonOptions,
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit each client to 60 activity events per minute
  message: {
    error: 'Too many activity events. Please slow down.'
  },
});

// Admin area - only failed requests (wrong password etc.) count, to slow
// down password guessing without getting in the way of real admins
const adminLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each client to 20 failed admin requests per windowMs
  skipSuccessfulRequests: true,
  message: {
    error: 'Too many failed requests. Please try again later.'
  },
});

module.exports = {
  clientKey,
  apiLimiter,
  proxyLimiter,
  searchLimiter,
  writeLimiter,
  activityLogLimiter,
  adminLimiter
};
