#!/usr/bin/env node

/**
 * Build Full MIDI Index Locally
 *
 * This script scrapes the learnchoralmusic.co.uk website to build a complete
 * index of all composers, works, and MIDI files. Run this locally to avoid
 * rate limiting on Render.
 *
 * Usage: node build-index.js
 */

const ChoralMusicScraper = require('./scraper');

async function buildIndex() {
  console.log('='.repeat(60));
  console.log('Building Full MIDI Index Locally');
  console.log('='.repeat(60));
  console.log('');
  console.log('This will scrape all composers from learnchoralmusic.co.uk');
  console.log('and save the complete index to data/midi-index-full.json');
  console.log('');
  console.log('Note: This may take 15-30 minutes due to rate limiting delays.');
  console.log('');
  console.log('Starting in 5 seconds...');
  console.log('');

  await new Promise(resolve => setTimeout(resolve, 5000));

  const scraper = new ChoralMusicScraper();

  try {
    // Ensure data directory exists
    await scraper.initializeDataDirectory();

    // Build the complete index (all composers)
    console.log('Building complete index...');
    const index = await scraper.buildCompleteIndex(false); // false = all composers, not just "A"

    console.log('');
    console.log('='.repeat(60));
    console.log('✓ Index Build Complete!');
    console.log('='.repeat(60));
    console.log('');
    console.log(`Total composers indexed: ${index.length}`);
    console.log(`Index saved to: data/midi-index-full.json`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Review the index file to ensure it looks correct');
    console.log('2. Commit the file: git add data/midi-index-full.json');
    console.log('3. Push to GitHub: git push');
    console.log('4. Render will automatically use the pre-built index');
    console.log('');
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('✗ Error building index:');
    console.error('='.repeat(60));
    console.error(error.message);
    console.error('');
    process.exit(1);
  }
}

// Run the script
buildIndex();
