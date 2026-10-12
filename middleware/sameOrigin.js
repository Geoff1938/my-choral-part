/**
 * Same-Origin Check for State-Changing Requests
 * CSRF guard: the browser re-sends Basic Auth credentials automatically, so
 * without this another site could make a logged-in admin's browser POST to
 * /admin/api/rebuild-index. Browsers always send Origin (or at least Referer)
 * on cross-site POSTs, and pages cannot forge either.
 */

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Host (hostname[:port]) of a URL, or null if it is not a valid URL
 * @param {string} value - URL
 * @returns {string|null}
 */
function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch (error) {
    return null;
  }
}

/**
 * Reject non-GET requests whose Origin (or, failing that, Referer) is not
 * this server's own host
 */
function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.includes(req.method)) {
    return next();
  }

  const source = req.headers.origin || req.headers.referer;
  const host = (req.headers.host || '').toLowerCase();

  if (!source || !host || hostOf(source) !== host) {
    console.warn(`[Security] Blocked cross-origin ${req.method} ${req.originalUrl} from ${source || 'unknown origin'}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = requireSameOrigin;
