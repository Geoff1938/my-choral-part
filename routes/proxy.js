/**
 * CORS Proxy Route
 * Handles proxying MIDI file requests to avoid CORS issues
 * SECURITY: Only allows requests to whitelisted domains
 */

const express = require('express');
const https = require('https');
const http = require('http');
const router = express.Router();

// Whitelist of allowed domains for the proxy
// This prevents the proxy from being abused as an open relay
const ALLOWED_DOMAINS = [
  'www.learnchoralmusic.co.uk',
  'learnchoralmusic.co.uk'
];

// MIDI files on the source site are static, so successful responses can be
// cached by browsers and Cloudflare for a day
const SUCCESS_CACHE_CONTROL = 'public, max-age=86400';

/**
 * Check if a URL's domain is in the allowed list
 * @param {URL} parsedUrl - Parsed URL object
 * @returns {boolean} True if domain is allowed
 */
function isDomainAllowed(parsedUrl) {
  const hostname = parsedUrl.hostname.toLowerCase();
  return ALLOWED_DOMAINS.some(domain =>
    hostname === domain || hostname.endsWith('.' + domain)
  );
}

// CORS proxy endpoint for fetching MIDI files
router.get('/', async (req, res) => {
  // Prevent browser from caching error responses (replaced on success)
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

  // SECURITY: Only allow requests to whitelisted domains
  if (!isDomainAllowed(parsedUrl)) {
    return res.status(403).json({
      error: 'Domain not allowed. Proxy only supports learnchoralmusic.co.uk'
    });
  }

  // Only allow http/https protocols
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only HTTP and HTTPS protocols are allowed' });
  }

  // Configure request options with browser-like headers to avoid blocking.
  // No Accept-Encoding: the body is piped straight through, so it must not
  // arrive compressed (our own compression middleware handles that).
  const requestOptions = {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'audio/midi,audio/*,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.learnchoralmusic.co.uk/',
      'Cache-Control': 'no-cache'
    }
  };

  // The upstream request in flight (replaced on each redirect)
  let upstream = null;

  // If the client goes away before we finish, stop fetching
  res.on('close', () => {
    if (!res.writableFinished && upstream) {
      upstream.destroy();
    }
  });

  /**
   * Send an error response, or cut the connection if the body has started
   * (so the client sees a failed download rather than a truncated file)
   */
  let failed = false;
  const fail = (status, message) => {
    if (failed) {
      return;
    }
    failed = true;
    if (!res.headersSent) {
      res.status(status).json({ error: message });
    } else {
      res.destroy();
    }
  };

  // Fetch the MIDI file with browser-like headers (with redirect following)
  const fetchWithRedirects = (url, redirectCount = 0) => {
    const maxRedirects = 5;

    if (redirectCount > maxRedirects) {
      return fail(502, 'Too many redirects');
    }

    let currentUrl;
    try {
      currentUrl = new URL(url);
    } catch (error) {
      return fail(400, 'Invalid redirect URL');
    }

    // SECURITY: Validate domain for each redirect to prevent open redirect attacks
    if (!isDomainAllowed(currentUrl)) {
      return fail(403, 'Redirect to non-allowed domain blocked');
    }

    const currentProtocol = currentUrl.protocol === 'https:' ? https : http;

    const request = currentProtocol.get(url, requestOptions, (midiRes) => {
      // Handle redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(midiRes.statusCode) && midiRes.headers.location) {
        // Discard the redirect body so the socket is released
        midiRes.resume();

        let absoluteRedirectUrl;
        try {
          // Handles relative redirects too
          absoluteRedirectUrl = new URL(midiRes.headers.location, url).href;
        } catch (urlError) {
          console.error(`Failed to parse redirect URL from ${url}`);
          return fail(502, 'Invalid redirect URL from server');
        }
        console.log(`Following redirect from ${url} to ${absoluteRedirectUrl}`);
        return fetchWithRedirects(absoluteRedirectUrl, redirectCount + 1);
      }

      if (midiRes.statusCode !== 200) {
        // Discard the error body so the socket is released
        midiRes.resume();
        console.error(`MIDI fetch failed: ${midiRes.statusCode} ${midiRes.statusMessage} for ${url}`);
        let errorMsg = `Failed to fetch MIDI file: HTTP ${midiRes.statusCode}`;

        // Special handling for rate limiting
        if (midiRes.statusCode === 429) {
          errorMsg = 'The source server is temporarily rate limiting requests. Please try again in a few moments.';
        }

        // Pass client errors (e.g. 404) through; report upstream server errors as a bad gateway
        return fail(midiRes.statusCode < 500 ? midiRes.statusCode : 502, errorMsg);
      }

      // Set appropriate headers
      res.setHeader('Content-Type', 'audio/midi');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', SUCCESS_CACHE_CONTROL);
      if (midiRes.headers['content-length']) {
        res.setHeader('Content-Length', midiRes.headers['content-length']);
      }

      // If the upstream connection breaks mid-file, don't leave the client waiting
      midiRes.on('aborted', () => fail(502, 'Failed to fetch MIDI file'));
      midiRes.on('error', () => fail(502, 'Failed to fetch MIDI file'));

      // Pipe the response
      midiRes.pipe(res);
    });
    upstream = request;

    request.on('error', (error) => {
      // Destroyed because the client disconnected - nothing to report
      if (res.destroyed || res.writableFinished) {
        return;
      }
      console.error(`Error fetching MIDI from ${url}: ${error.code || error.message}`);
      fail(502, 'Failed to fetch MIDI file');
    });

    // Fires when the socket is idle for the timeout - before the response
    // starts or part way through the body
    request.on('timeout', () => {
      console.error(`Timeout fetching MIDI from ${url}`);
      fail(504, 'Request timeout fetching MIDI file');
      request.destroy();
    });
  };

  fetchWithRedirects(midiUrl);
});

module.exports = router;
