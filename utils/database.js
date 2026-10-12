/**
 * SQLite Database Utility for Activity Logging
 * Uses sql.js (WebAssembly-based SQLite)
 */

const initSqlJs = require('sql.js');
const fs = require('fs-extra');
const path = require('path');
const bcrypt = require('bcryptjs');

// Use DATABASE_PATH env var for Render persistence, fallback to local data folder
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'activity.db');

let db = null;
let SQL = null;
let initPromise = null;

// Saves are chained so two writes never overlap. pendingSave is a save that
// is queued but not yet started - later callers share it rather than queue
// another identical write.
let lastSave = Promise.resolve();
let pendingSave = null;

/**
 * Initialize the database connection and create tables if needed
 */
function initDatabase() {
    if (!initPromise) {
        initPromise = openDatabase().catch(error => {
            initPromise = null;
            throw error;
        });
    }
    return initPromise;
}

/**
 * Load the database file (or create a new database) and prepare the schema
 */
async function openDatabase() {
    // Initialize sql.js
    SQL = await initSqlJs();

    db = await loadDatabaseFile();

    // Create tables if they don't exist
    db.run(`
        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            composer TEXT,
            work TEXT,
            movement TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_agent TEXT,
            ip_address TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    `);

    // Add duration column for rehearsal_time events (databases created before Oct 2026)
    const columns = db.exec(`PRAGMA table_info(activities)`)[0].values.map(row => row[1]);
    if (!columns.includes('duration_seconds')) {
        db.run(`ALTER TABLE activities ADD COLUMN duration_seconds INTEGER`);
        console.log('[Database] Added duration_seconds column');
    }

    // Create indexes for common queries
    db.run(`CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_activities_device ON activities(device_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_activities_event ON activities(event_type)`);

    // Create settings table for storing app settings like last rebuild time
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);

    // IP addresses are no longer collected - clear any stored before that change
    db.run(`UPDATE activities SET ip_address = NULL WHERE ip_address IS NOT NULL`);
    const clearedIps = db.getRowsModified();
    if (clearedIps > 0) {
        console.log(`[Database] Cleared ${clearedIps} stored IP addresses`);
    }

    // Make the admin users match the ADMIN_USERS environment variable
    await syncAdminUsers();

    // Save database to disk
    await saveDatabase();

    console.log('[Database] Initialized successfully');
    return db;
}

/**
 * Load the database from DB_PATH, or create a new one if there is no file.
 * A file that cannot be read as a database is renamed aside (never
 * overwritten) so its data can still be recovered by hand.
 * @returns {Promise<Object>} sql.js Database
 */
async function loadDatabaseFile() {
    if (!(await fs.pathExists(DB_PATH))) {
        console.log('[Database] Created new database');
        return new SQL.Database();
    }

    let loaded = null;
    try {
        const fileBuffer = await fs.readFile(DB_PATH);
        loaded = new SQL.Database(fileBuffer);
        // sql.js only notices a bad file on the first query
        loaded.exec(`SELECT COUNT(*) FROM sqlite_master`);
        console.log('[Database] Loaded existing database');
        return loaded;
    } catch (error) {
        if (loaded) {
            loaded.close();
        }
        const corruptPath = `${DB_PATH}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        // If this rename fails the error propagates and startup stops, rather
        // than a new empty database being saved over the old file
        await fs.rename(DB_PATH, corruptPath);
        console.error('[Database] ************************************************************');
        console.error(`[Database] COULD NOT LOAD ${DB_PATH}: ${error.message}`);
        console.error(`[Database] The file has been moved to ${corruptPath}`);
        console.error('[Database] Starting with an EMPTY activity database');
        console.error('[Database] ************************************************************');
        return new SQL.Database();
    }
}

/**
 * Write the database to disk: to a temporary file first, then renamed over
 * the real one, so a crash mid-write cannot leave a truncated database.
 * @param {string} targetPath - File to write
 */
async function writeDatabaseFile(targetPath = DB_PATH) {
    await fs.ensureDir(path.dirname(targetPath));
    const tmpPath = `${targetPath}.tmp`;
    await fs.writeFile(tmpPath, Buffer.from(db.export()));
    await fs.rename(tmpPath, targetPath);
}

/**
 * Save the database to disk. Saves run one at a time; the returned promise
 * resolves once a save that includes every change made so far has finished.
 * @returns {Promise<void>}
 */
function saveDatabase() {
    if (!db) return Promise.resolve();

    if (!pendingSave) {
        pendingSave = lastSave.then(async () => {
            pendingSave = null;
            try {
                await writeDatabaseFile();
            } catch (error) {
                console.error('[Database] Error saving database:', error.message);
            }
        });
        lastSave = pendingSave;
    }
    return pendingSave;
}

/**
 * Wait for any queued saves and write the latest state (used on shutdown)
 * @returns {Promise<void>}
 */
async function flushDatabase() {
    await saveDatabase();
}

/**
 * Parse the ADMIN_USERS environment variable
 * Format: a JSON object mapping email to password, e.g.
 *   {"someone@example.com": "a long password", "other@example.com": "another one"}
 * @param {string|undefined} value - Raw environment variable value
 * @returns {Array<{email: string, password: string}>|null} Users, or null if unset or invalid
 */
function parseAdminUsers(value) {
    if (!value) {
        return null;
    }

    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        console.error('[Database] ADMIN_USERS is not valid JSON - admin access disabled');
        return null;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.error('[Database] ADMIN_USERS must be a JSON object of email: password - admin access disabled');
        return null;
    }

    const users = Object.entries(parsed)
        .filter(([email, password]) => email && typeof password === 'string' && password.length > 0)
        .map(([email, password]) => ({ email: email.trim().toLowerCase(), password }));

    return users.length > 0 ? users : null;
}

/**
 * Make the admin_users table match the ADMIN_USERS environment variable.
 * Users not listed are removed, so changing the variable and restarting is
 * all it takes to change a password or revoke access. If the variable is
 * missing or invalid, every admin user is removed and the admin area is locked.
 */
async function syncAdminUsers() {
    const adminUsers = parseAdminUsers(process.env.ADMIN_USERS);

    if (!adminUsers) {
        db.run(`DELETE FROM admin_users`);
        console.warn('[Database] ADMIN_USERS not set - admin access disabled');
        return;
    }

    const emails = adminUsers.map(user => user.email);
    const placeholders = emails.map(() => '?').join(', ');
    db.run(`DELETE FROM admin_users WHERE email NOT IN (${placeholders})`, emails);

    for (const user of adminUsers) {
        const passwordHash = await bcrypt.hash(user.password, 10);
        db.run(`
            INSERT INTO admin_users (email, password_hash) VALUES (?, ?)
            ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash
        `, [user.email, passwordHash]);
    }
    console.log(`[Database] Admin users: ${emails.join(', ')}`);
}

/**
 * Log an activity event
 */
async function logActivity(deviceId, eventType, composer, work, movement, userAgent, ipAddress, durationSeconds = null) {
    await initDatabase();

    db.run(`
        INSERT INTO activities (device_id, event_type, composer, work, movement, user_agent, ip_address, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [deviceId, eventType, composer, work, movement, userAgent, ipAddress, durationSeconds]);

    // Save to disk after each write
    await saveDatabase();
}

/**
 * Validate admin credentials
 */
async function validateAdmin(email, password) {
    await initDatabase();

    const result = db.exec(`SELECT password_hash FROM admin_users WHERE email = ?`, [email.trim().toLowerCase()]);
    if (result.length === 0 || result[0].values.length === 0) {
        return false;
    }

    const passwordHash = result[0].values[0][0];
    return bcrypt.compare(password, passwordHash);
}

/**
 * Format a Date the way SQLite's CURRENT_TIMESTAMP stores it
 * ('YYYY-MM-DD HH:MM:SS', UTC) so it compares correctly with stored values.
 * An ISO string would not: 'T' sorts after ' ', which dropped the first day
 * of every range.
 * @param {Date} date - Date to format
 * @returns {string} SQLite timestamp
 */
function toSqlTimestamp(date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Get activity summary for a time period
 */
async function getActivitySummary(startDate, endDate) {
    await initDatabase();

    const range = [toSqlTimestamp(startDate), toSqlTimestamp(endDate)];

    // Total events by type
    const eventCounts = db.exec(`
        SELECT event_type, COUNT(*) as count
        FROM activities
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY event_type
    `, range);

    // Unique devices
    const uniqueDevices = db.exec(`
        SELECT COUNT(DISTINCT device_id) as count
        FROM activities
        WHERE timestamp >= ? AND timestamp <= ?
    `, range);

    // Total rehearsal (playing) time
    const rehearsalSeconds = db.exec(`
        SELECT COALESCE(SUM(duration_seconds), 0)
        FROM activities
        WHERE timestamp >= ? AND timestamp <= ?
        AND event_type = 'rehearsal_time'
    `, range);

    // Top works (by download count)
    const topWorks = db.exec(`
        SELECT composer, work, COUNT(*) as count
        FROM activities
        WHERE timestamp >= ? AND timestamp <= ?
        AND event_type = 'download'
        AND composer IS NOT NULL
        GROUP BY composer, work
        ORDER BY count DESC
        LIMIT 10
    `, range);

    return {
        eventCounts: eventCounts.length > 0 ? eventCounts[0].values.map(row => ({
            eventType: row[0],
            count: row[1]
        })) : [],
        uniqueDevices: uniqueDevices.length > 0 && uniqueDevices[0].values.length > 0
            ? uniqueDevices[0].values[0][0] : 0,
        rehearsalHours: rehearsalSeconds.length > 0 && rehearsalSeconds[0].values.length > 0
            ? Math.round(rehearsalSeconds[0].values[0][0] / 360) / 10 : 0,
        topWorks: topWorks.length > 0 ? topWorks[0].values.map(row => ({
            composer: row[0],
            work: row[1],
            count: row[2]
        })) : []
    };
}

/**
 * Get activities for export
 */
async function getActivitiesForExport(startDate, endDate) {
    await initDatabase();

    const range = [toSqlTimestamp(startDate), toSqlTimestamp(endDate)];

    const result = db.exec(`
        SELECT timestamp, device_id, event_type, composer, work, movement, user_agent, duration_seconds
        FROM activities
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp DESC
    `, range);

    if (result.length === 0) return [];

    return result[0].values.map(row => ({
        timestamp: row[0],
        deviceId: row[1],
        eventType: row[2],
        composer: row[3],
        work: row[4],
        movement: row[5],
        userAgent: row[6],
        durationSeconds: row[7]
    }));
}

/**
 * Delete activities older than the retention period
 * @param {number} months - How many months of activity to keep
 * @returns {Promise<number>} Number of activities deleted
 */
async function purgeOldActivities(months = 12) {
    await initDatabase();

    db.run(`DELETE FROM activities WHERE timestamp < datetime('now', ?)`, [`-${months} months`]);
    const deleted = db.getRowsModified();

    if (deleted > 0) {
        await saveDatabase();
    }
    console.log(`[Database] Retention purge removed ${deleted} activities older than ${months} months`);
    return deleted;
}

/**
 * Write a dated copy of the database to a backups folder next to it
 * (e.g. /var/data/backups/activity-2026-10-12.db), keeping the newest few.
 * @param {Date} date - Date to name the backup after
 * @param {number} keep - How many daily backups to keep
 * @returns {Promise<string>} Path of the backup written
 */
async function backupDatabase(date = new Date(), keep = 7) {
    await initDatabase();

    const backupDir = path.join(path.dirname(DB_PATH), 'backups');
    const baseName = path.basename(DB_PATH, path.extname(DB_PATH));
    const backupPath = path.join(backupDir, `${baseName}-${date.toISOString().slice(0, 10)}.db`);

    // Queue behind any pending save so the backup is not written mid-save
    await saveDatabase();
    await writeDatabaseFile(backupPath);

    // Remove the oldest backups (names sort by date)
    const pattern = new RegExp(`^${baseName}-\\d{4}-\\d{2}-\\d{2}\\.db$`);
    const backups = (await fs.readdir(backupDir)).filter(name => pattern.test(name)).sort();
    for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
        await fs.remove(path.join(backupDir, name));
    }

    console.log(`[Database] Backup written to ${backupPath}`);
    return backupPath;
}

/**
 * Get date ranges for summary periods
 */
function getDateRanges() {
    const now = new Date();

    // Last 24 hours
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Start of current week (Sunday)
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Start of current month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return {
        last24Hours: { start: last24Hours, end: now },
        weekToDate: { start: startOfWeek, end: now },
        monthToDate: { start: startOfMonth, end: now }
    };
}

/**
 * Store the last index rebuild time and result
 */
async function setLastRebuildTime(result) {
    await initDatabase();

    const value = JSON.stringify(result);
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('lastRebuild', ?)`, [value]);

    await saveDatabase();
}

/**
 * Get the last index rebuild time and result
 */
async function getLastRebuildTime() {
    await initDatabase();

    const result = db.exec(`SELECT value FROM settings WHERE key = 'lastRebuild'`);
    if (result.length === 0 || result[0].values.length === 0) {
        return null;
    }

    try {
        return JSON.parse(result[0].values[0][0]);
    } catch (e) {
        return null;
    }
}

module.exports = {
    DB_PATH,
    initDatabase,
    saveDatabase,
    flushDatabase,
    logActivity,
    purgeOldActivities,
    backupDatabase,
    validateAdmin,
    parseAdminUsers,
    getActivitySummary,
    getActivitiesForExport,
    getDateRanges,
    setLastRebuildTime,
    getLastRebuildTime
};
