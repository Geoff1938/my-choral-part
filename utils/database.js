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

/**
 * Initialize the database connection and create tables if needed
 */
async function initDatabase() {
    if (db) return db;

    // Initialize sql.js
    SQL = await initSqlJs();

    // Load existing database or create new one
    try {
        if (await fs.pathExists(DB_PATH)) {
            const fileBuffer = await fs.readFile(DB_PATH);
            db = new SQL.Database(fileBuffer);
            console.log('[Database] Loaded existing database');
        } else {
            db = new SQL.Database();
            console.log('[Database] Created new database');
        }
    } catch (error) {
        console.error('[Database] Error loading database, creating new one:', error.message);
        db = new SQL.Database();
    }

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

    // Seed admin users if they don't exist
    await seedAdminUsers();

    // Save database to disk
    await saveDatabase();

    console.log('[Database] Initialized successfully');
    return db;
}

/**
 * Save the database to disk
 */
async function saveDatabase() {
    if (!db) return;

    try {
        await fs.ensureDir(path.dirname(DB_PATH));
        const data = db.export();
        const buffer = Buffer.from(data);
        await fs.writeFile(DB_PATH, buffer);
    } catch (error) {
        console.error('[Database] Error saving database:', error.message);
    }
}

/**
 * Seed initial admin users
 */
async function seedAdminUsers() {
    const adminUsers = [
        { email: 'gichapman@gmail.com', password: 'GeoffMcp' },
        { email: 'john@learnchoralmusic.co.uk', password: 'JohnMcp' }
    ];

    for (const user of adminUsers) {
        const existing = db.exec(`SELECT id FROM admin_users WHERE email = '${user.email}'`);
        if (existing.length === 0 || existing[0].values.length === 0) {
            const passwordHash = await bcrypt.hash(user.password, 10);
            db.run(`INSERT INTO admin_users (email, password_hash) VALUES (?, ?)`, [user.email, passwordHash]);
            console.log(`[Database] Created admin user: ${user.email}`);
        }
    }
}

/**
 * Log an activity event
 */
async function logActivity(deviceId, eventType, composer, work, movement, userAgent, ipAddress) {
    await initDatabase();

    db.run(`
        INSERT INTO activities (device_id, event_type, composer, work, movement, user_agent, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [deviceId, eventType, composer, work, movement, userAgent, ipAddress]);

    // Save to disk after each write
    await saveDatabase();
}

/**
 * Validate admin credentials
 */
async function validateAdmin(email, password) {
    await initDatabase();

    const result = db.exec(`SELECT password_hash FROM admin_users WHERE email = ?`, [email]);
    if (result.length === 0 || result[0].values.length === 0) {
        return false;
    }

    const passwordHash = result[0].values[0][0];
    return bcrypt.compare(password, passwordHash);
}

/**
 * Get activity summary for a time period
 */
async function getActivitySummary(startDate, endDate) {
    await initDatabase();

    const start = startDate.toISOString();
    const end = endDate.toISOString();

    // Total events by type
    const eventCounts = db.exec(`
        SELECT event_type, COUNT(*) as count
        FROM activities
        WHERE timestamp >= '${start}' AND timestamp <= '${end}'
        GROUP BY event_type
    `);

    // Unique devices
    const uniqueDevices = db.exec(`
        SELECT COUNT(DISTINCT device_id) as count
        FROM activities
        WHERE timestamp >= '${start}' AND timestamp <= '${end}'
    `);

    // Top works (by download count)
    const topWorks = db.exec(`
        SELECT composer, work, COUNT(*) as count
        FROM activities
        WHERE timestamp >= '${start}' AND timestamp <= '${end}'
        AND event_type = 'download'
        AND composer IS NOT NULL
        GROUP BY composer, work
        ORDER BY count DESC
        LIMIT 10
    `);

    return {
        eventCounts: eventCounts.length > 0 ? eventCounts[0].values.map(row => ({
            eventType: row[0],
            count: row[1]
        })) : [],
        uniqueDevices: uniqueDevices.length > 0 && uniqueDevices[0].values.length > 0
            ? uniqueDevices[0].values[0][0] : 0,
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

    const start = startDate.toISOString();
    const end = endDate.toISOString();

    const result = db.exec(`
        SELECT timestamp, device_id, event_type, composer, work, movement, ip_address, user_agent
        FROM activities
        WHERE timestamp >= '${start}' AND timestamp <= '${end}'
        ORDER BY timestamp DESC
    `);

    if (result.length === 0) return [];

    return result[0].values.map(row => ({
        timestamp: row[0],
        deviceId: row[1],
        eventType: row[2],
        composer: row[3],
        work: row[4],
        movement: row[5],
        ipAddress: row[6],
        userAgent: row[7]
    }));
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
    initDatabase,
    saveDatabase,
    logActivity,
    validateAdmin,
    getActivitySummary,
    getActivitiesForExport,
    getDateRanges,
    setLastRebuildTime,
    getLastRebuildTime
};
