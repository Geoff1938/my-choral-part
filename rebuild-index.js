/**
 * Script to rebuild the MIDI index from scratch
 * Run with: node rebuild-index.js
 */

const ChoralMusicScraper = require('./scraper');

async function main() {
    console.log('Starting full index rebuild...');
    console.log('This will take several minutes.\n');

    const scraper = new ChoralMusicScraper();

    try {
        const index = await scraper.buildCompleteIndex();
        console.log('\nIndex rebuild complete!');
        console.log(`Total composers: ${index.length}`);

        // Count total works and sections
        let totalWorks = 0;
        let totalSections = 0;
        for (const composer of index) {
            totalWorks += composer.works.length;
            for (const work of composer.works) {
                totalSections += work.sections.length;
            }
        }
        console.log(`Total works: ${totalWorks}`);
        console.log(`Total sections/movements: ${totalSections}`);
    } catch (error) {
        console.error('Error rebuilding index:', error);
        process.exit(1);
    }
}

main();
