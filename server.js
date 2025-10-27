const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const ChoralMusicScraper = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const scraper = new ChoralMusicScraper();

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

  // Fetch the MIDI file with timeout
  const request = protocol.get(midiUrl, { timeout: 10000 }, (midiRes) => {
    if (midiRes.statusCode !== 200) {
      console.error(`MIDI fetch failed: ${midiRes.statusCode} ${midiRes.statusMessage} for ${midiUrl}`);
      let errorMsg = `Failed to fetch MIDI file: ${midiRes.statusCode} ${midiRes.statusMessage}`;

      // Special handling for rate limiting
      if (midiRes.statusCode === 429) {
        errorMsg = 'The source server is temporarily rate limiting requests. Please try again in a few moments.';
      }

      return res.status(midiRes.statusCode).json({ error: errorMsg });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'audio/midi');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Pipe the response
    midiRes.pipe(res);
  }).on('error', (error) => {
    console.error(`Error fetching MIDI from ${midiUrl}:`, error);
    res.status(500).json({ error: `Failed to fetch MIDI file: ${error.message}` });
  }).on('timeout', () => {
    request.destroy();
    console.error(`Timeout fetching MIDI from ${midiUrl}`);
    res.status(504).json({ error: 'Request timeout fetching MIDI file' });
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

  // Background indexing disabled to avoid rate limiting from source server
  // The app will use the initial-index.json which contains A composers only
  console.log('Background indexing is disabled. Using static initial index.');
});
