/**
 * CORS Proxy Route
 * Handles proxying MIDI file requests to avoid CORS issues
 */

const express = require('express');
const https = require('https');
const http = require('http');
const router = express.Router();


// CORS proxy endpoint for fetching MIDI files
router.get('/', async (req, res) => {
  // Prevent browser from caching error responses
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

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

  // Fetch the MIDI file with browser-like headers (with redirect following)
  const fetchWithRedirects = (url, redirectCount = 0) => {
    const maxRedirects = 5;

    if (redirectCount > maxRedirects) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Too many redirects' });
      }
      return;
    }

    let currentUrl;
    try {
      currentUrl = new URL(url);
    } catch (error) {
      if (!res.headersSent) {
        res.status(400).json({ error: 'Invalid redirect URL' });
      }
      return;
    }

    const currentProtocol = currentUrl.protocol === 'https:' ? https : http;

    const request = currentProtocol.get(url, requestOptions, (midiRes) => {
      // Handle redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(midiRes.statusCode)) {
        const redirectUrl = midiRes.headers.location;
        if (redirectUrl) {
          // Handle relative redirects
          const absoluteRedirectUrl = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          return fetchWithRedirects(absoluteRedirectUrl, redirectCount + 1);
        }
      }

      if (midiRes.statusCode !== 200) {
        console.error(`MIDI fetch failed: ${midiRes.statusCode} ${midiRes.statusMessage} for ${url}`);
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
      console.error(`Error fetching MIDI from ${url}:`, error);
      // Only send error if headers haven't been sent yet
      if (!res.headersSent) {
        res.status(500).json({ error: `Failed to fetch MIDI file: ${error.message}` });
      }
    }).on('timeout', () => {
      request.destroy();
      console.error(`Timeout fetching MIDI from ${url}`);
      // Only send error if headers haven't been sent yet
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timeout fetching MIDI file' });
      }
    });
  };

  fetchWithRedirects(midiUrl);
});

module.exports = router;
