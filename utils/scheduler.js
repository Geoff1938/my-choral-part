/**
 * Scheduler for nightly index rebuild
 * Uses node-cron to run tasks at scheduled times
 */

const cron = require('node-cron');
const ChoralMusicScraper = require('../scraper');
const { setLastRebuildTime, getLastRebuildTime } = require('./database');

let scheduledTask = null;
let serverScraper = null; // Reference to server's scraper for cache invalidation

/**
 * Run the index rebuild
 * @returns {Promise<Object>} Result of the rebuild
 */
async function runIndexRebuild() {
    const startTime = new Date();
    console.log(`[Scheduler] Starting index rebuild at ${startTime.toISOString()}`);

    const scraper = new ChoralMusicScraper();

    try {
        const index = await scraper.buildCompleteIndex();

        // Count totals
        let totalWorks = 0;
        let totalSections = 0;
        for (const composer of index) {
            totalWorks += composer.works.length;
            for (const work of composer.works) {
                totalSections += work.sections.length;
            }
        }

        const endTime = new Date();
        const durationMs = endTime - startTime;
        const durationMinutes = (durationMs / 60000).toFixed(1);

        const result = {
            success: true,
            timestamp: endTime.toISOString(),
            composers: index.length,
            works: totalWorks,
            sections: totalSections,
            durationMinutes: parseFloat(durationMinutes)
        };

        // Store the result in the database
        await setLastRebuildTime(result);

        console.log(`[Scheduler] Index rebuild complete at ${endTime.toISOString()}`);
        console.log(`[Scheduler] Composers: ${index.length}, Works: ${totalWorks}, Sections: ${totalSections}`);
        console.log(`[Scheduler] Duration: ${durationMinutes} minutes`);

        // Clear the server's cached index so it reloads from disk
        if (serverScraper && typeof serverScraper.clearCache === 'function') {
            serverScraper.clearCache();
            console.log('[Scheduler] Server index cache cleared - new index now active');
        }

        return result;
    } catch (error) {
        const endTime = new Date();
        const result = {
            success: false,
            timestamp: endTime.toISOString(),
            error: error.message
        };

        // Store the failed result
        await setLastRebuildTime(result);

        console.error(`[Scheduler] Index rebuild failed:`, error.message);
        return result;
    }
}

/**
 * Start the scheduled index rebuild task
 * Runs at 2:00 AM every day
 * @param {Object} scraper - Optional reference to server's scraper for cache invalidation
 */
function startScheduler(scraper = null) {
    if (scheduledTask) {
        console.log('[Scheduler] Scheduler already running');
        return;
    }

    // Store reference to server's scraper for cache invalidation after rebuild
    serverScraper = scraper;

    // Schedule for 2:00 AM every day
    // Cron format: second minute hour day-of-month month day-of-week
    scheduledTask = cron.schedule('0 2 * * *', async () => {
        console.log('[Scheduler] Triggered nightly index rebuild');
        await runIndexRebuild();
    }, {
        scheduled: true,
        timezone: 'Europe/London' // UK timezone
    });

    console.log('[Scheduler] Scheduled nightly index rebuild at 2:00 AM (Europe/London)');
}

/**
 * Stop the scheduled task
 */
function stopScheduler() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        console.log('[Scheduler] Scheduler stopped');
    }
}

/**
 * Get the status of the last rebuild
 * @returns {Promise<Object|null>} Last rebuild info or null
 */
async function getLastRebuildStatus() {
    return await getLastRebuildTime();
}

module.exports = {
    startScheduler,
    stopScheduler,
    runIndexRebuild,
    getLastRebuildStatus
};
