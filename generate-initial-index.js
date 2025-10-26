// Script to generate initial index with "A" composers only
// This will be run once to create the data/initial-index.json file that ships with the repo

const ChoralMusicScraper = require('./scraper');
const fs = require('fs-extra');
const path = require('path');

async function generateInitialIndex() {
  console.log('Generating initial index with "A" composers only...');

  const scraper = new ChoralMusicScraper();

  // Build index with test mode (A composers only)
  const index = await scraper.buildCompleteIndex(true);

  // Save to initial-index.json
  const initialIndexFile = path.join(__dirname, 'data', 'initial-index.json');
  await fs.writeJSON(initialIndexFile, index, { spaces: 2 });

  console.log(`Initial index saved to ${initialIndexFile}`);
  console.log(`Contains ${index.length} composers`);

  // Print summary
  index.forEach(composer => {
    console.log(`  ${composer.name}: ${composer.works.length} works`);
  });
}

generateInitialIndex().catch(console.error);
