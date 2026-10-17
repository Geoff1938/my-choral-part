/**
 * Scheduler for nightly jobs: index rebuild, activity retention purge and
 * database backup. Uses node-cron to run tasks at scheduled times
 */

const cron = require('node-cron');
const ChoralMusicScraper = require('../scraper');
const {
    setLastRebuildTime,
    getLastRebuildTime,
    purgeOldActivities,
    backupDatabase
} = require('./database');

// Activities older than this are deleted nightly (see the privacy notice)
const RETENTION_MONTHS = 60;

// Number of daily database backups to keep
const BACKUPS_TO_KEEP = 7;

let scheduledTasks = [];
let serverScraper = null; // Reference to server's scraper for cache invalidation
let rebuildInProgress = null; // Promise of the running rebuild, if any

/**
 * Whether an index rebuild is currently running
 * @returns {boolean}
 */
function isRebuildRunning() {
    return rebuildInProgress !== null;
}

/**
 * Run the index rebuild. Only one rebuild runs at a time - a request made
 * while one is running returns immediately without starting another.
 * @returns {Promise<Object>} Result of the rebuild
 */
async function runIndexRebuild() {
    if (rebuildInProgress) {
        console.log('[Scheduler] Index rebuild already running - not starting another');
        return { success: false, alreadyRunning: true, error: 'Index rebuild already running' };
    }

    rebuildInProgress = rebuildIndex();
    try {
        return await rebuildInProgress;
    } finally {
        rebuildInProgress = null;
    }
}

/**
 * Rebuild the index and record the result
 * @returns {Promise<Object>} Result of the rebuild
 */
async function rebuildIndex() {
    const startTime = new Date();
    console.log(`[Scheduler] Starting index rebuild at ${startTime.toISOString()}`);

    const scraper = new ChoralMusicScraper();

    try {
        const index = await scraper.buildCompleteIndex();

        // Count totals
        const { composers, works, sections } = ChoralMusicScraper.countIndex(index);

        const endTime = new Date();
        const durationMs = endTime - startTime;
        const durationMinutes = (durationMs / 60000).toFixed(1);

        const result = {
            success: true,
            timestamp: endTime.toISOString(),
            composers,
            works,
            sections,
            durationMinutes: parseFloat(durationMinutes)
        };

        // Store the result in the database
        await setLastRebuildTime(result);

        console.log(`[Scheduler] Index rebuild complete at ${endTime.toISOString()}`);
        console.log(`[Scheduler] Composers: ${composers}, Works: ${works}, Sections: ${sections}`);
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

        // Store the failed result (the previous index is left in place)
        await setLastRebuildTime(result);

        console.error('[Scheduler] Index rebuild failed - keeping the existing index:', error.message);
        return result;
    }
}

/**
 * Nightly database housekeeping: delete activities past the retention
 * period, then write a dated backup. Errors are logged, not thrown.
 */
async function runNightlyMaintenance() {
    try {
        await purgeOldActivities(RETENTION_MONTHS);
    } catch (error) {
        console.error('[Scheduler] Retention purge failed:', error.message);
    }

    try {
        await backupDatabase(new Date(), BACKUPS_TO_KEEP);
    } catch (error) {
        console.error('[Scheduler] Database backup failed:', error.message);
    }
}

/**
 * Start the scheduled tasks
 * Index rebuild at 2:00 AM, database maintenance at 3:30 AM (UK time)
 * @param {Object} scraper - Optional reference to server's scraper for cache invalidation
 */
function startScheduler(scraper = null) {
    if (scheduledTasks.length > 0) {
        console.log('[Scheduler] Scheduler already running');
        return;
    }

    // Store reference to server's scraper for cache invalidation after rebuild
    serverScraper = scraper;

    // Cron format: minute hour day-of-month month day-of-week
    scheduledTasks.push(cron.schedule('0 2 * * *', async () => {
        console.log('[Scheduler] Triggered nightly index rebuild');
        await runIndexRebuild();
    }, {
        timezone: 'Europe/London' // UK timezone
    }));

    scheduledTasks.push(cron.schedule('30 3 * * *', async () => {
        console.log('[Scheduler] Triggered nightly database maintenance');
        await runNightlyMaintenance();
    }, {
        timezone: 'Europe/London'
    }));

    console.log('[Scheduler] Scheduled nightly index rebuild at 2:00 AM and database maintenance at 3:30 AM (Europe/London)');
}

/**
 * Stop the scheduled tasks
 */
function stopScheduler() {
    if (scheduledTasks.length > 0) {
        scheduledTasks.forEach(task => task.stop());
        scheduledTasks = [];
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
    isRebuildRunning,
    runNightlyMaintenance,
    getLastRebuildStatus
};
