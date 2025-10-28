const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const compression = require('compression');
const ChoralMusicScraper = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const scraper = new ChoralMusicScraper();

// Enable gzip compression for all responses
app.use(compression());

// Middleware to parse JSON
app.use(express.json());

// Serve static files from the public directory
app.use(express.static('public'));

// API endpoints for MIDI index

// Get the complete MIDI index
app.get('/api/index', async (req, res) => {
  try {
    const index = await scraper.loadIndex();
    res.json(index);
  } catch (error) {
    console.error('Error loading index:', error);
    res.status(500).json({ error: 'Failed to load MIDI index' });
  }
});

// Search composers
app.get('/api/search/composers', async (req, res) => {
  try {
    const searchTerm = req.query.q || '';
    const results = await scraper.searchComposers(searchTerm);
    res.json(results);
  } catch (error) {
    console.error('Error searching composers:', error);
    res.status(500).json({ error: 'Failed to search composers' });
  }
});

// Advanced search across composers, works, and movements
app.get('/api/search', async (req, res) => {
  try {
    const searchTerm = req.query.q || '';
    const searchComposers = req.query.composers === 'true';
    const searchWorks = req.query.works === 'true';
    const searchMovements = req.query.movements === 'true';

    const results = await scraper.advancedSearch(searchTerm, {
      composers: searchComposers,
      works: searchWorks,
      movements: searchMovements
    });

    res.json(results);
  } catch (error) {
    console.error('Error performing advanced search:', error);
    res.status(500).json({ error: 'Failed to perform search' });
  }
});

// Get works for a composer
app.get('/api/composer/:composerName/works', async (req, res) => {
  try {
    const works = await scraper.getComposerWorks(req.params.composerName);
    res.json(works);
  } catch (error) {
    console.error('Error getting works:', error);
    res.status(500).json({ error: 'Failed to get works' });
  }
});

// Get sections for a work
app.get('/api/composer/:composerName/work/:workName/sections', async (req, res) => {
  try {
    const sections = await scraper.getWorkSections(
      req.params.composerName,
      req.params.workName
    );
    res.json(sections);
  } catch (error) {
    console.error('Error getting sections:', error);
    res.status(500).json({ error: 'Failed to get sections' });
  }
});

// Get recent works
app.get('/api/recent-works', async (req, res) => {
  try {
    const recentWorks = await scraper.getRecentWorks();
    res.json(recentWorks);
  } catch (error) {
    console.error('Error getting recent works:', error);
    res.status(500).json({ error: 'Failed to get recent works' });
  }
});

// Save recent work
app.post('/api/recent-works', async (req, res) => {
  try {
    const { composer, work } = req.body;
    if (!composer || !work) {
      return res.status(400).json({ error: 'Composer and work are required' });
    }
    const recentWorks = await scraper.saveRecentWork(composer, work);
    res.json(recentWorks);
  } catch (error) {
    console.error('Error saving recent work:', error);
    res.status(500).json({ error: 'Failed to save recent work' });
  }
});

// CORS proxy endpoint for fetching MIDI files
app.get('/proxy', async (req, res) => {
  const midiUrl = req.query.url;

  if (!midiUrl) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(midiUrl);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Choose http or https based on protocol
  const protocol = parsedUrl.protocol === 'https:' ? https : http;

  // Configure request options with browser-like headers to avoid blocking
  const requestOptions = {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'audio/midi,audio/*,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.learnchoralmusic.co.uk/',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache'
    }
  };

  // Fetch the MIDI file with browser-like headers
  const request = protocol.get(midiUrl, requestOptions, (midiRes) => {
    if (midiRes.statusCode !== 200) {
      console.error(`MIDI fetch failed: ${midiRes.statusCode} ${midiRes.statusMessage} for ${midiUrl}`);
      let errorMsg = `Failed to fetch MIDI file: ${midiRes.statusCode} ${midiRes.statusMessage}`;

      // Special handling for rate limiting
      if (midiRes.statusCode === 429) {
        errorMsg = 'The source server is temporarily rate limiting requests. Please try again in a few moments.';
      }

      // Only send error if headers haven't been sent yet
      if (!res.headersSent) {
        return res.status(midiRes.statusCode).json({ error: errorMsg });
      }
      return;
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'audio/midi');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Pipe the response
    midiRes.pipe(res);
  }).on('error', (error) => {
    console.error(`Error fetching MIDI from ${midiUrl}:`, error);
    // Only send error if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to fetch MIDI file: ${error.message}` });
    }
  }).on('timeout', () => {
    request.destroy();
    console.error(`Timeout fetching MIDI from ${midiUrl}`);
    // Only send error if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout fetching MIDI file' });
    }
  });
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
