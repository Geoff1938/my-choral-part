const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static('public'));

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}`);
});
