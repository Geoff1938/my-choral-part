/**
 * Integration tests for the activity database: atomic saves, handling of a
 * corrupt file, date ranges, retention purge, IP clearing and backups.
 * Every test uses its own throwaway database in a temp folder.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

let tempDir;

/**
 * Load a fresh copy of utils/database.js pointing at dbPath
 */
function loadDatabaseModule(dbPath) {
  process.env.DATABASE_PATH = dbPath;
  let database;
  jest.isolateModules(() => {
    database = require('../../utils/database');
  });
  return database;
}

/**
 * Write a database file in the old schema with the given activity rows
 */
async function writeFixture(dbPath, rows) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE activities (
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
  for (const row of rows) {
    db.run(
      `INSERT INTO activities (device_id, event_type, composer, work, timestamp, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.deviceId, row.eventType, row.composer || null, row.work || null, row.timestamp, row.ip || null]
    );
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

/**
 * Read a column from a database file directly
 */
async function readColumn(dbPath, sql) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const result = db.exec(sql);
  db.close();
  return result.length > 0 ? result[0].values.map(row => row[0]) : [];
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choral-db-test-'));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Saving', () => {
  test('saves atomically and keeps every write when many overlap', async () => {
    const dbPath = path.join(tempDir, 'activity.db');
    const database = loadDatabaseModule(dbPath);

    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      database.logActivity(`device-${i}`, 'download', 'Bach', 'Mass', null, 'UA', null)
    ));
    await database.flushDatabase();

    expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);
    const devices = await readColumn(dbPath, 'SELECT device_id FROM activities');
    expect(devices).toHaveLength(20);
  });

  test('moves a corrupt database aside instead of overwriting it', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const dbPath = path.join(tempDir, 'activity.db');
    fs.writeFileSync(dbPath, 'this is not a sqlite database at all, just some text');

    const database = loadDatabaseModule(dbPath);
    await database.logActivity('device-1', 'download', null, null, null, 'UA', null);

    const corrupt = fs.readdirSync(tempDir).filter(name => name.startsWith('activity.db.corrupt-'));
    expect(corrupt).toHaveLength(1);
    expect(fs.readFileSync(path.join(tempDir, corrupt[0]), 'utf8')).toContain('not a sqlite database');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('COULD NOT LOAD'));

    const devices = await readColumn(dbPath, 'SELECT device_id FROM activities');
    expect(devices).toEqual(['device-1']);
  });
});

describe('Date ranges', () => {
  const rows = [
    { deviceId: 'a', eventType: 'download', composer: 'Bach', work: 'Mass', timestamp: '2026-10-01 00:30:00' },
    { deviceId: 'b', eventType: 'download', composer: 'Bach', work: 'Mass', timestamp: '2026-10-01 23:59:59' },
    { deviceId: 'c', eventType: 'download', composer: 'Bach', work: 'Mass', timestamp: '2026-10-02 10:00:00' },
    { deviceId: 'd', eventType: 'download', composer: 'Bach', work: 'Mass', timestamp: '2026-09-30 23:59:59' }
  ];
  const start = new Date('2026-10-01T00:00:00.000Z');
  const end = new Date('2026-10-01T23:59:59.999Z');

  test('summary includes the first day and stops at the end time', async () => {
    const dbPath = path.join(tempDir, 'activity.db');
    await writeFixture(dbPath, rows);
    const database = loadDatabaseModule(dbPath);

    const summary = await database.getActivitySummary(start, end);

    expect(summary.uniqueDevices).toBe(2);
    expect(summary.topWorks).toEqual([{ composer: 'Bach', work: 'Mass', count: 2 }]);
  });

  test('export includes the first day and stops at the end time', async () => {
    const dbPath = path.join(tempDir, 'activity.db');
    await writeFixture(dbPath, rows);
    const database = loadDatabaseModule(dbPath);

    const activities = await database.getActivitiesForExport(start, end);

    expect(activities.map(activity => activity.deviceId).sort()).toEqual(['a', 'b']);
  });
});

describe('Privacy', () => {
  test('clears stored IP addresses on startup and does not export them', async () => {
    const dbPath = path.join(tempDir, 'activity.db');
    await writeFixture(dbPath, [
      { deviceId: 'a', eventType: 'download', timestamp: '2026-10-01 10:00:00', ip: '203.0.113.7' }
    ]);
    const database = loadDatabaseModule(dbPath);

    const activities = await database.getActivitiesForExport(
      new Date('2026-10-01T00:00:00Z'), new Date('2026-10-02T00:00:00Z'));

    expect(activities).toHaveLength(1);
    expect(activities[0]).not.toHaveProperty('ipAddress');
    expect(await readColumn(dbPath, 'SELECT ip_address FROM activities')).toEqual([null]);
  });

  test('retention purge deletes activities older than 12 months only', async () => {
    const dbPath = path.join(tempDir, 'activity.db');
    const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    await writeFixture(dbPath, [
      { deviceId: 'old', eventType: 'download', timestamp: daysAgo(400) },
      { deviceId: 'recent', eventType: 'download', timestamp: daysAgo(300) }
    ]);
    const database = loadDatabaseModule(dbPath);

    const deleted = await database.purgeOldActivities(12);

    expect(deleted).toBe(1);
    expect(await readColumn(dbPath, 'SELECT device_id FROM activities')).toEqual(['recent']);
  });
});

describe('Backups', () => {
  test('writes dated backups and keeps the newest seven', async () => {
    const dbPath = path.join(tempDir, 'activity.db');
    const database = loadDatabaseModule(dbPath);
    await database.logActivity('device-1', 'download', null, null, null, 'UA', null);

    for (let day = 1; day <= 9; day++) {
      await database.backupDatabase(new Date(Date.UTC(2026, 9, day, 3, 30)));
    }

    const backups = fs.readdirSync(path.join(tempDir, 'backups')).sort();
    expect(backups).toEqual([3, 4, 5, 6, 7, 8, 9].map(day => `activity-2026-10-0${day}.db`));
    const devices = await readColumn(path.join(tempDir, 'backups', backups[6]), 'SELECT device_id FROM activities');
    expect(devices).toEqual(['device-1']);
  });
});
