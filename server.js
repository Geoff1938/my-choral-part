const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const compression = require('compression');
const ChoralMusicScraper = require('./scraper');

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

// Import routes
const createApiRoutes = require('./routes/api');
const proxyRouter = require('./routes/proxy');
const activityRouter = require('./routes/activity');
const adminRouter = require('./routes/admin');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { apiLimiter, proxyLimiter } = require('./middleware/rateLimiter');
const basicAuthMiddleware = require('./middleware/basicAuth');
const { initDatabase } = require('./utils/database');
const { startScheduler } = require('./utils/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;
const scraper = new ChoralMusicScraper();

// Trust first proxy (Render) - required for rate limiting to work correctly
app.set('trust proxy', 1);

// Enable gzip compression for all responses
app.use(compression());

// Middleware to parse JSON
app.use(express.json());

// Serve the pre-rendered index.html for "/" and "/index.html" so the
// {{VERSION}} placeholder gets substituted with the current build version.
// Must come BEFORE express.static so static doesn't intercept the raw file.
function serveIndex(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(INDEX_HTML);
}
app.get('/', serveIndex);
app.get('/index.html', serveIndex);

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
    // JS/CSS at the root (app.js, styles.css): URL is version-busted in
    // index.html, so cache for a year.
    else if (filepath.match(/\.(js|css)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Health check endpoint for Render monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Activity logging routes (rate limited) - must be before general /api routes
app.use('/api/activity', apiLimiter, activityRouter);

// Apply rate limiting to API routes
app.use('/api', apiLimiter, createApiRoutes(scraper));

// Apply stricter rate limiting to proxy route
app.use('/proxy', proxyLimiter, proxyRouter);

// Admin routes (Basic Auth protected)
app.use('/admin', basicAuthMiddleware, adminRouter);

// Soundfont mode routes - serve index.html for different soundfont modes
// Default mode is 'standard' (SpessaSynth, ~31MB memory)
// Use /fullfonts for high-quality soundfonts (requires ~1.7GB memory)
app.get('/fullfonts', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all route for composer/work URLs (e.g., /domenico-scarlatti/magnificat)
// This allows sharing direct links to works
app.get('/:composer/:work', (req, res) => {
  // Serve index.html, which will read the URL and load the appropriate work
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

    // Initialize scraper
    console.log('Initializing MIDI index scraper...');

    // Ensure initial index is copied to data directory
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

      // Start the scheduler for nightly index rebuilds
      // Pass scraper reference so cache can be cleared after rebuild
      startScheduler(scraper);
    });
  })();
}

// Export app and scraper for testing and scheduler access
module.exports = { app, scraper };
