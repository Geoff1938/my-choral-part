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

  // Fetch the MIDI file
  protocol.get(midiUrl, (midiRes) => {
    if (midiRes.statusCode !== 200) {
      return res.status(midiRes.statusCode).json({
        error: `Failed to fetch MIDI file: ${midiRes.statusMessage}`
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'audio/midi');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Pipe the response
    midiRes.pipe(res);
  }).on('error', (error) => {
    console.error('Error fetching MIDI:', error);
    res.status(500).json({ error: `Failed to fetch MIDI file: ${error.message}` });
  });
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}`);

  // Initialize scraper with test mode (A composers only)
  console.log('Initializing MIDI index scraper...');

  // Check if index already exists
  const existingIndex = await scraper.loadIndex();

  if (existingIndex.length === 0) {
    console.log('No existing index found. Building new index...');
    // Build index in background (test mode - A composers only)
    scraper.buildIndexInBackground(true);
  } else {
    console.log(`Loaded existing index with ${existingIndex.length} composers`);
  }

  // Schedule index rebuild every 24 hours
  setInterval(() => {
    console.log('Starting scheduled index rebuild...');
    scraper.buildIndexInBackground(true); // Keep test mode for now
  }, 24 * 60 * 60 * 1000); // 24 hours
});
