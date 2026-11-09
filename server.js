const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const compression = require('compression');
const ChoralMusicScraper = require('./scraper');
const seo = require('./utils/seo');

// Generate version.json at startup so it's available as a static file.
// Returns the version string so we can also use it to cache-bust HTML asset references.
function generateVersionFile() {
  let versionInfo;
  try {
    let hash;
    if (process.env.RENDER_GIT_COMMIT) {
      hash = process.env.RENDER_GIT_COMMIT.substring(0, 7);
    } else {
      hash = execSync('git rev-parse --short HEAD').toString().trim();
    }
    const date = new Date().toISOString().split('T')[0];
    versionInfo = {
      version: `${date}.${hash}`,
      commit: hash,
      date: date,
      built: new Date().toISOString()
    };
    console.log(`Version: ${versionInfo.version}`);
  } catch (error) {
    console.error('Failed to generate version file:', error.message);
    versionInfo = {
      version: 'unknown',
      commit: 'unknown',
      date: new Date().toISOString().split('T')[0],
      built: new Date().toISOString()
    };
  }
  const outputPath = path.join(__dirname, 'public', 'version.json');
  fs.writeFileSync(outputPath, JSON.stringify(versionInfo, null, 2));
  return versionInfo.version;
}

const APP_VERSION = generateVersionFile();

// Pre-render index.html at startup with the version baked into asset URLs.
// We substitute {{VERSION}} placeholders once and serve the cached string for
// every request. This keeps the HTML always-fresh (no-cache below) while
// allowing /vendor/ and other JS/CSS to be cached aggressively because their
// URLs change on every deploy.
function buildIndexHtml() {
  const src = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  return src.replace(/\{\{VERSION\}\}/g, encodeURIComponent(APP_VERSION));
}

const INDEX_HTML = buildIndexHtml();
const HOME_HTML = seo.renderPage(INDEX_HTML, seo.homeMeta());

// Import routes
const createApiRoutes = require('./routes/api');
const proxyRouter = require('./routes/proxy');
const activityRouter = require('./routes/activity');
const adminRouter = require('./routes/admin');
const { createLibraryRoutes, createSharedRoutes } = require('./routes/library');
const library = require('./utils/library');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const {
  apiLimiter,
  proxyLimiter,
  activityLogLimiter,
  adminLimiter,
  libraryLimiter
} = require('./middleware/rateLimiter');
const basicAuthMiddleware = require('./middleware/basicAuth');
const requireSameOrigin = require('./middleware/sameOrigin');
const { initDatabase, flushDatabase } = require('./utils/database');
const { initLibrary, flushLibrary } = require('./utils/library');
const { startScheduler, stopScheduler } = require('./utils/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;
const scraper = new ChoralMusicScraper();

// Trust first proxy (Render) - required for rate limiting to work correctly
app.set('trust proxy', 1);

// Enable gzip compression for all responses
app.use(compression());

// Activity events are tiny - parse them with a small body limit (this runs
// first, so the general parser below skips these requests)
app.use('/api/activity', express.json({ limit: '10kb' }));

// Saved library pieces arrive as base64 MIDI (up to 5 MB, a third more as base64)
app.use('/api/library', express.json({ limit: '7mb' }));

// Middleware to parse JSON
app.use(express.json());

// Serve the pre-rendered index.html for "/" and "/index.html" so the
// {{VERSION}} placeholder gets substituted with the current build version.
// Must come BEFORE express.static so static doesn't intercept the raw file.
function serveIndex(req, res, html = HOME_HTML) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}
app.get('/', (req, res) => serveIndex(req, res));
app.get('/index.html', (req, res) => serveIndex(req, res));

// Note whether the request carries the ?v= version, so the static handler
// below only caches for a year when the URL changes on every deploy.
app.use((req, res, next) => {
  res.locals.versioned = req.query.v !== undefined;
  next();
});

// Our own ES modules (app.js and the files it imports) are served with their
// relative imports rewritten to carry ?v=VERSION. Otherwise a returning
// browser could pair a new app.js with old cached copies of constants.js etc.
// and fail to start. The vendor libraries and the service worker are excluded.
const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.\.?\/[^'"?]+\.js)\2/g;
app.get(/^\/(?!vendor\/)(?!service-worker\.js$).+\.js$/, async (req, res, next) => {
  const filePath = path.join(__dirname, 'public', path.normalize(req.path));
  if (!filePath.startsWith(path.join(__dirname, 'public') + path.sep)) {
    return next();
  }
  let source;
  try {
    source = await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    return next();
  }
  const version = encodeURIComponent(APP_VERSION);
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', res.locals.versioned
    ? 'public, max-age=31536000, immutable'
    : 'no-cache');
  res.send(source.replace(RELATIVE_IMPORT, `$1$2$3?v=${version}$2`));
});

// Serve static files from the public directory with caching headers.
// Asset URLs that reference /app.js, /styles.css, and /vendor/* are
// version-busted via ?v={{VERSION}} in index.html, so the URL changes
// on every deploy and we can cache aggressively without staleness risk.
app.use(express.static('public', {
  maxAge: '1d',
  setHeaders: (res, filepath) => {
    // /vendor/ files only change when copy-vendor.js runs (npm install or
    // explicit `npm run vendor`). Their script tags are version-busted, so
    // the URL changes per deploy. Safe to cache for a year.
    const normalized = filepath.replace(/\\/g, '/');
    if (normalized.includes('/public/vendor/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    // HTML: should not be cached; route handler above serves the real index.
    else if (filepath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // Service worker must never be cached - browser needs to check for updates.
    else if (filepath.endsWith('service-worker.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // version.json reports the live build - must never be cached, or the
    // displayed version (and any update check) lags behind the deploy.
    else if (filepath.endsWith('version.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // Longer cache for images and fonts.
    else if (filepath.match(/\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week
    }
    // Other JS/CSS: cache for a year only when the URL is version-busted
    // (?v=); otherwise make the browser check for a newer copy each time.
    else if (filepath.match(/\.(js|css)$/)) {
      res.setHeader('Cache-Control', res.locals.versioned
        ? 'public, max-age=31536000, immutable'
        : 'no-cache');
    }
  }
}));

// Health check endpoint for Render monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Activity logging routes (rate limited) - must be before general /api routes
app.use('/api/activity', activityLogLimiter, activityRouter);

// Apply rate limiting to API routes
// Users' saved pieces - mounted before /api so it has its own rate limit
// Sets are limited to uploaded files for now, so no catalogue lookup is
// passed (see checkSetItems in utils/library.js)
app.use('/api/library', libraryLimiter, requireSameOrigin, createLibraryRoutes());

// Opening shared links (read-only, anyone with the link)
app.use('/api/shared', libraryLimiter, createSharedRoutes());

app.use('/api', apiLimiter, createApiRoutes(scraper));

// Apply stricter rate limiting to proxy route
app.use('/proxy', proxyLimiter, proxyRouter);

// Admin routes (Basic Auth protected, failed attempts rate limited,
// POSTs must come from our own pages)
app.use('/admin', adminLimiter, requireSameOrigin, basicAuthMiddleware, adminRouter);

// The high-quality soundfont mode (/fullfonts) has been removed; send any
// old bookmarks to the normal player
app.get('/fullfonts', (req, res) => res.redirect(301, '/'));

// Sitemap of the home page and every playable work, rebuilt when the index
// changes (the scraper replaces its cached index object after a rebuild)
let sitemapCache = { index: null, xml: '' };
app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const index = await scraper.loadIndex();
    if (sitemapCache.index !== index) {
      sitemapCache = { index, xml: seo.buildSitemap(index) };
    }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(sitemapCache.xml);
  } catch (error) {
    next(error);
  }
});

// Send a permanent redirect to the clean URL when a page was requested by an
// older or untidy slug (e.g. /haydn-(joseph)/... -> /haydn-joseph/...), so
// links shared before November 2026 keep working. Returns true if redirected.
function redirectToCanonical(req, res, canonicalPath) {
  const requested = '/' + Object.values(req.params).map(encodeURIComponent).join('/');
  if (requested === canonicalPath) {
    return false;
  }
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, canonicalPath + query);
  return true;
}

// Paths the composer and work routes must leave alone: API and asset
// folders, and anything that looks like a missing file (e.g. /favicon.ico)
const RESERVED_SEGMENTS = new Set(['api', 'proxy', 'admin', 'vendor', 'branding', 'soundfonts', 'utils', 'ui', 'player', 'practice-midi']);
function isPagePath(req) {
  const first = String(req.params.composer || '').toLowerCase();
  if (RESERVED_SEGMENTS.has(first)) return false;
  const last = Object.values(req.params).pop();
  return !/\.(js|mjs|css|map|json|txt|xml|html?|png|jpe?g|gif|svg|ico|webp|webmanifest|woff2?|ttf|mid|midi|sf2|sf3)$/i.test(String(last));
}

// Server-rendered HTML pages (composer list and composer pages)
function sendHtml(res, html, status = 200) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(html);
}

// Shared links: /p/<code> (a piece) and /s/<code> (a set). The player loads
// them itself; the server only fills in a title for link previews. Must come
// before the composer and work page routes.
app.get(/^\/(p|s)\/([a-z0-9-]{6,50}|[A-Za-z0-9_-]{16})$/, async (req, res, next) => {
  try {
    const kind = req.params[0] === 's' ? 'set' : 'piece';
    const found = kind === 'set'
      ? await library.findSharedSet(req.params[1])
      : await library.findSharedPiece(req.params[1]);
    const title = found ? (kind === 'set' ? found.set.title : found.piece.title) : null;
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!found) res.status(404);
    serveIndex(req, res, seo.renderPage(INDEX_HTML, seo.sharedMeta(title, kind)));
  } catch (error) {
    next(error);
  }
});

// List of all composers, linking to their pages
app.get('/composers', async (req, res, next) => {
  try {
    sendHtml(res, seo.renderComposersPage(await scraper.loadIndex()));
  } catch (error) {
    next(error);
  }
});

// Composer pages (e.g. /handel) listing the composer's works
app.get('/:composer', async (req, res, next) => {
  if (!isPagePath(req)) return next();
  try {
    const composer = seo.findComposer(await scraper.loadIndex(), req.params.composer);
    if (!composer || composer.works.length === 0) {
      return sendHtml(res, seo.renderComposerNotFoundPage(), 404);
    }
    if (redirectToCanonical(req, res, seo.composerPath(composer.name))) {
      return;
    }
    sendHtml(res, seo.renderComposerPage(composer));
  } catch (error) {
    next(error);
  }
});

// Catch-all route for composer/work URLs (e.g., /domenico-scarlatti/magnificat)
// This allows sharing direct links to works. Uses the pre-rendered index so
// the asset URLs carry the real version, not the {{VERSION}} placeholder.
// Each work gets its own title, description and canonical URL for search
// engines; unknown works get a 404 status so they are not indexed.
app.get('/:composer/:work', async (req, res, next) => {
  if (!isPagePath(req)) return next();
  try {
    const index = await scraper.loadIndex();
    const found = seo.findWork(index, req.params.composer, req.params.work);
    if (!found) {
      res.status(404);
      return serveIndex(req, res, seo.renderPage(INDEX_HTML, seo.notFoundMeta()));
    }
    if (redirectToCanonical(req, res, seo.workPath(found.composer.name, found.work.name))) {
      return;
    }
    serveIndex(req, res, seo.renderPage(INDEX_HTML, seo.workMeta(found.composer, found.work)));
  } catch (error) {
    next(error);
  }
});

// 404 handler - must be after all other routes
app.use(notFoundHandler);

// Error handling middleware - must be last
app.use(errorHandler);

// Only start server if not being required by another module (e.g., tests)
if (require.main === module) {
  (async () => {
    // Initialize everything BEFORE accepting requests to avoid race conditions
    // (e.g., deep link resolve returning 404 because index isn't loaded yet)

    // Initialize activity logging database
    console.log('Initializing activity database...');
    await initDatabase();
    console.log('Activity database ready');

    // Users' saved pieces (library.db and the library/ folder)
    await initLibrary();
    console.log('Library ready');

    // Initialize scraper
    console.log('Initializing MIDI index scraper...');

    // Copy the shipped index files into the data directory if missing
    // (This handles Render's persistent disk mount which starts empty)
    await scraper.ensureInitialIndex();

    // Check if index already exists
    const existingIndex = await scraper.loadIndex();

    if (existingIndex.length === 0) {
      console.log('No existing index found. Using initial index only (A composers).');
    } else {
      console.log(`Loaded existing index with ${existingIndex.length} composers`);
    }

    console.log('Using pre-built index.');

    // Now start accepting requests - index is ready
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Visit http://localhost:${PORT}`);

      // Start the scheduler for nightly index rebuilds and database backups
      // Pass scraper reference so cache can be cleared after rebuild
      startScheduler(scraper);
    });
  })().catch((error) => {
    console.error('Startup failed:', error);
    process.exit(1);
  });

  // Render sends SIGTERM before stopping the instance (e.g. on deploy):
  // write any pending activity database changes before exiting
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received - saving activity database and exiting`);
    stopScheduler();
    try {
      await flushDatabase();
      await flushLibrary();
    } catch (error) {
      console.error('Error saving database on shutdown:', error);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Export app and scraper for testing and scheduler access
module.exports = { app, scraper };
