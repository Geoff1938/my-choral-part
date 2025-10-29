const express = require('express');
const path = require('path');
const compression = require('compression');
const ChoralMusicScraper = require('./scraper');

// Import routes
const createApiRoutes = require('./routes/api');
const proxyRouter = require('./routes/proxy');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;
const scraper = new ChoralMusicScraper();

// Enable gzip compression for all responses
app.use(compression());

// Middleware to parse JSON
app.use(express.json());

// Serve static files from the public directory
app.use(express.static('public'));

// Mount API routes
app.use('/api', createApiRoutes(scraper));

// Mount proxy route
app.use('/proxy', proxyRouter);

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

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}`);

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

  // Background indexing strategy:
  // - The full index is pre-built locally (run: npm run build-index)
  // - The pre-built index is committed to the repository
  // - Render uses the pre-built index (no scraping on startup)
  // - Optional: Schedule weekly updates with long delays to stay current

  console.log('Using pre-built index. Background scraping disabled.');

  // Optional: Uncomment to enable weekly index updates (runs every 7 days)
  // This is disabled by default to avoid rate limiting
  /*
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  setInterval(() => {
    console.log('Starting weekly index update...');
    scraper.buildIndexInBackground(false);
  }, ONE_WEEK);
  console.log('Weekly index updates enabled (runs every 7 days).');
  */
});

// Export app for testing
module.exports = app;
