/**
 * API Routes
 * Handles all /api/* endpoints for MIDI index operations
 */

const express = require('express');
const router = express.Router();

/**
 * Initialize routes with scraper instance
 * @param {ChoralMusicScraper} scraper - Scraper instance
 * @returns {express.Router} Configured router
 */
function createApiRoutes(scraper) {
  // Search across composers, works, and movements
  router.get('/search', async (req, res, next) => {
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
      next(error);
    }
  });

  // Get works for a composer
  router.get('/composer/:composerName/works', async (req, res, next) => {
    try {
      const works = await scraper.getComposerWorks(req.params.composerName);
      res.json(works);
    } catch (error) {
      next(error);
    }
  });

  // Get sections for a work
  router.get('/composer/:composerName/work/:workName/sections', async (req, res, next) => {
    try {
      const sections = await scraper.getWorkSections(
        req.params.composerName,
        req.params.workName
      );
      res.json(sections);
    } catch (error) {
      next(error);
    }
  });

  // Resolve slug to actual composer/work names
  router.get('/resolve/:composerSlug/:workSlug', async (req, res, next) => {
    try {
      const result = await scraper.resolveSlug(
        req.params.composerSlug,
        req.params.workSlug
      );
      if (result) {
        res.json(result);
      } else {
        // Log details to help diagnose intermittent 404s
        const index = await scraper.loadIndex();
        console.warn(`[resolve] 404 for "${req.params.composerSlug}/${req.params.workSlug}" - index has ${index.length} composers`);
        res.status(404).json({ error: 'Composer or work not found' });
      }
    } catch (error) {
      next(error);
    }
  });

  // Log time signature override for analytics
  router.post('/log-signature-override', async (req, res, next) => {
    try {
      const { composer, work, movement, barNumber, originalSignature, overrideSignature, timestamp } = req.body;

      // Log to console (in future, could save to database)
      console.log('Time Signature Override:', {
        composer,
        work,
        movement,
        barNumber,
        originalSignature,
        overrideSignature,
        timestamp
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Catch-all 404 handler for unknown API routes
  // This prevents API routes from falling through to the main app's catch-all route
  router.use((req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return router;
}

module.exports = createApiRoutes;
