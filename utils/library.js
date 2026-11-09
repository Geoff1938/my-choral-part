/**
 * Library storage: practice MIDIs that users save from their own files.
 *
 * Metadata (libraries, pieces) is in a small sql.js database, library.db, in
 * the data directory. The MIDI files themselves are stored as separate files
 * (library/<piece id>.mid) so the database, which sql.js keeps in memory,
 * stays small. A piece's file never changes once saved (renaming only
 * changes the database), so the nightly backup copies only the database.
 *
 * A library is identified by a random key held in the user's cookie; only
 * the key's SHA-256 hash is stored, so the database alone cannot be used to
 * open anyone's library.
 */

const crypto = require('crypto');
const initSqlJs = require('sql.js');
const fs = require('fs-extra');
const path = require('path');

// Limits, all adjustable
const LIMITS = {
    PIECES_PER_LIBRARY: 100,
    MAX_PIECE_BYTES: 5 * 1024 * 1024,
    // Stop accepting new pieces when the stored files reach this total, so
    // the library can never fill the 1 GB disk the index and backups share
    MAX_TOTAL_BYTES: Number(process.env.LIBRARY_MAX_TOTAL_BYTES) || 400 * 1024 * 1024,
    MAX_TEXT_LENGTH: 200,
    RETENTION_YEARS: 3
};

let db = null;
let initPromise = null;
let lastSave = Promise.resolve();
let pendingSave = null;
let paths = null;

/**
 * Folder for library.db and the library/ files: DATA_DIR if set, else the
 * folder holding DATABASE_PATH, else the repo's data folder
 * @returns {{dataDir: string, dbPath: string, filesDir: string}}
 */
function resolvePaths() {
    const dataDir = process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR)
        : process.env.DATABASE_PATH
            ? path.dirname(path.resolve(process.env.DATABASE_PATH))
            : path.join(__dirname, '..', 'data');
    return {
        dataDir,
        dbPath: path.join(dataDir, 'library.db'),
        filesDir: path.join(dataDir, 'library')
    };
}

/**
 * Open (or create) the library database. Safe to call repeatedly.
 * @returns {Promise<void>}
 */
function initLibrary() {
    if (!initPromise) {
        initPromise = openLibrary().catch(error => {
            initPromise = null;
            throw error;
        });
    }
    return initPromise;
}

async function openLibrary() {
    paths = resolvePaths();
    const SQL = await initSqlJs();
    await fs.ensureDir(paths.filesDir);

    if (await fs.pathExists(paths.dbPath)) {
        try {
            db = new SQL.Database(await fs.readFile(paths.dbPath));
            db.exec('SELECT COUNT(*) FROM sqlite_master');
        } catch (error) {
            // Never overwrite a file we could not read: move it aside for recovery
            const aside = `${paths.dbPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            await fs.rename(paths.dbPath, aside);
            console.error(`[Library] COULD NOT LOAD ${paths.dbPath} (${error.message}); moved to ${aside}`);
            db = new SQL.Database();
        }
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS libraries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_hash TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS pieces (
            id TEXT PRIMARY KEY,
            library_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            composer TEXT,
            size_bytes INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_used_at TEXT NOT NULL
        )
    `);
    // Sets (e.g. a choir's concert programme) group pieces in order. Created
    // now so the schema is ready; the screens and sharing come later.
    db.run(`
        CREATE TABLE IF NOT EXISTS sets (
            id TEXT PRIMARY KEY,
            library_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS set_pieces (
            set_id TEXT NOT NULL,
            piece_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (set_id, piece_id)
        )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_pieces_library ON pieces(library_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sets_library ON sets(library_id)');

    await saveLibrary();
}

async function writeDatabaseFile(targetPath) {
    await fs.ensureDir(path.dirname(targetPath));
    const tmpPath = `${targetPath}.tmp`;
    await fs.writeFile(tmpPath, Buffer.from(db.export()));
    await fs.rename(tmpPath, targetPath);
}

/**
 * Save the database; saves run one at a time (see utils/database.js)
 * @returns {Promise<void>}
 */
function saveLibrary() {
    if (!db) return Promise.resolve();
    if (!pendingSave) {
        pendingSave = lastSave.then(async () => {
            pendingSave = null;
            try {
                await writeDatabaseFile(paths.dbPath);
            } catch (error) {
                console.error('[Library] Error saving database:', error.message);
            }
        });
        lastSave = pendingSave;
    }
    return pendingSave;
}

async function flushLibrary() {
    await saveLibrary();
}

function now() {
    return new Date().toISOString();
}

function rows(sql, params = []) {
    const statement = db.prepare(sql);
    statement.bind(params);
    const result = [];
    while (statement.step()) {
        result.push(statement.getAsObject());
    }
    statement.free();
    return result;
}

function hashKey(key) {
    return crypto.createHash('sha256').update(String(key)).digest('hex');
}

/**
 * A new library key (to go in the user's cookie)
 * @returns {string} 43-character URL-safe key
 */
function newKey() {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Whether a string looks like a key we issued
 * @param {*} key - Value from the cookie
 * @returns {boolean}
 */
function isValidKey(key) {
    return typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key);
}

/**
 * Find the library for a key, optionally creating it, and mark it used
 * @param {string} key - Library key from the cookie
 * @param {{create?: boolean}} [options]
 * @returns {Promise<{id: number}|null>} Library, or null if none
 */
async function findLibrary(key, { create = false } = {}) {
    await initLibrary();
    if (!isValidKey(key)) return null;
    const keyHash = hashKey(key);
    let library = rows('SELECT id FROM libraries WHERE key_hash = ?', [keyHash])[0];
    if (!library && create) {
        const time = now();
        db.run('INSERT INTO libraries (key_hash, created_at, last_used_at) VALUES (?, ?, ?)', [keyHash, time, time]);
        library = rows('SELECT id FROM libraries WHERE key_hash = ?', [keyHash])[0];
        await saveLibrary();
    }
    return library || null;
}

/**
 * Record that a library is in use (keeps it from being deleted after 3 years)
 * @param {number} libraryId - Library
 */
function touchLibrary(libraryId) {
    db.run('UPDATE libraries SET last_used_at = ? WHERE id = ?', [now(), libraryId]);
}

function toPiece(row) {
    return {
        id: row.id,
        title: row.title,
        composer: row.composer || '',
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at
    };
}

/**
 * Pieces in a library, most recently used first
 * @param {number} libraryId - Library
 * @returns {Promise<Array<Object>>} Pieces
 */
async function listPieces(libraryId) {
    await initLibrary();
    return rows('SELECT * FROM pieces WHERE library_id = ? ORDER BY last_used_at DESC, created_at DESC', [libraryId])
        .map(toPiece);
}

/**
 * Error with an HTTP status, for the routes to pass on
 */
class LibraryError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/**
 * Tidy a title or composer: a trimmed string within the length limit
 * @param {*} value - Value from the request
 * @param {boolean} required - Whether an empty value is an error
 * @returns {string} Cleaned text
 */
function cleanText(value, required, field) {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string') {
        throw new LibraryError(400, `The ${field} must be text.`);
    }
    const text = value.replace(/\s+/g, ' ').trim();
    if (required && !text) {
        throw new LibraryError(400, `Please give the piece a ${field}.`);
    }
    if (text.length > LIMITS.MAX_TEXT_LENGTH) {
        throw new LibraryError(400, `The ${field} is too long (at most ${LIMITS.MAX_TEXT_LENGTH} characters).`);
    }
    return text;
}

async function storedBytes() {
    const total = rows('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM pieces')[0];
    return total.total;
}

/**
 * Save a practice MIDI to a library
 * @param {number} libraryId - Library
 * @param {{title: string, composer?: string, midi: Buffer}} piece - Piece to save
 * @returns {Promise<Object>} The saved piece
 */
async function addPiece(libraryId, { title, composer, midi }) {
    await initLibrary();
    const cleanTitle = cleanText(title, true, 'title');
    const cleanComposer = cleanText(composer, false, 'composer');
    if (!Buffer.isBuffer(midi) || midi.length === 0) {
        throw new LibraryError(400, 'No MIDI file was received.');
    }
    if (midi.length > LIMITS.MAX_PIECE_BYTES) {
        throw new LibraryError(413, 'This file is too large to save.');
    }
    const count = rows('SELECT COUNT(*) AS n FROM pieces WHERE library_id = ?', [libraryId])[0].n;
    if (count >= LIMITS.PIECES_PER_LIBRARY) {
        throw new LibraryError(409, `Your library is full (${LIMITS.PIECES_PER_LIBRARY} pieces). Delete a piece to make room.`);
    }
    if (await storedBytes() + midi.length > LIMITS.MAX_TOTAL_BYTES) {
        console.error('[Library] Storage limit reached - refusing new pieces');
        throw new LibraryError(507, 'Sorry, we can\'t save new pieces at the moment. Please try again later.');
    }

    const id = crypto.randomBytes(9).toString('base64url');
    await fs.writeFile(path.join(paths.filesDir, `${id}.mid`), midi);
    const time = now();
    db.run(
        `INSERT INTO pieces (id, library_id, title, composer, size_bytes, created_at, updated_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, libraryId, cleanTitle, cleanComposer || null, midi.length, time, time, time]
    );
    touchLibrary(libraryId);
    await saveLibrary();
    return toPiece(rows('SELECT * FROM pieces WHERE id = ?', [id])[0]);
}

function ownedPiece(libraryId, pieceId) {
    if (typeof pieceId !== 'string' || !/^[A-Za-z0-9_-]{12}$/.test(pieceId)) return null;
    return rows('SELECT * FROM pieces WHERE id = ? AND library_id = ?', [pieceId, libraryId])[0] || null;
}

/**
 * Read a piece's MIDI file and mark the piece used
 * @param {number} libraryId - Library
 * @param {string} pieceId - Piece
 * @returns {Promise<{piece: Object, midi: Buffer}|null>} The piece, or null if not in this library
 */
async function readPiece(libraryId, pieceId) {
    await initLibrary();
    const row = ownedPiece(libraryId, pieceId);
    if (!row) return null;
    const midi = await fs.readFile(path.join(paths.filesDir, `${row.id}.mid`));
    db.run('UPDATE pieces SET last_used_at = ? WHERE id = ?', [now(), row.id]);
    touchLibrary(libraryId);
    saveLibrary();
    return { piece: toPiece(row), midi };
}

/**
 * Change a piece's title and/or composer
 * @param {number} libraryId - Library
 * @param {string} pieceId - Piece
 * @param {{title?: string, composer?: string}} changes - New values
 * @returns {Promise<Object|null>} The updated piece, or null if not in this library
 */
async function updatePiece(libraryId, pieceId, changes) {
    await initLibrary();
    const row = ownedPiece(libraryId, pieceId);
    if (!row) return null;
    const title = changes.title === undefined ? row.title : cleanText(changes.title, true, 'title');
    const composer = changes.composer === undefined ? (row.composer || '') : cleanText(changes.composer, false, 'composer');
    db.run('UPDATE pieces SET title = ?, composer = ?, updated_at = ? WHERE id = ?',
        [title, composer || null, now(), row.id]);
    touchLibrary(libraryId);
    await saveLibrary();
    return toPiece(rows('SELECT * FROM pieces WHERE id = ?', [row.id])[0]);
}

async function removePieceRows(pieceIds) {
    for (const id of pieceIds) {
        db.run('DELETE FROM set_pieces WHERE piece_id = ?', [id]);
        db.run('DELETE FROM pieces WHERE id = ?', [id]);
        await fs.remove(path.join(paths.filesDir, `${id}.mid`));
    }
}

/**
 * Delete a piece and its file
 * @param {number} libraryId - Library
 * @param {string} pieceId - Piece
 * @returns {Promise<boolean>} True if deleted, false if not in this library
 */
async function deletePiece(libraryId, pieceId) {
    await initLibrary();
    const row = ownedPiece(libraryId, pieceId);
    if (!row) return false;
    await removePieceRows([row.id]);
    touchLibrary(libraryId);
    await saveLibrary();
    return true;
}

/**
 * Delete libraries (with their pieces, sets and files) not used for the
 * retention period
 * @param {number} [years] - Retention period
 * @returns {Promise<number>} Number of libraries deleted
 */
async function purgeOldLibraries(years = LIMITS.RETENTION_YEARS) {
    await initLibrary();
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - years);
    const old = rows('SELECT id FROM libraries WHERE last_used_at < ?', [cutoff.toISOString()]);
    for (const { id } of old) {
        await removePieceRows(rows('SELECT id FROM pieces WHERE library_id = ?', [id]).map(r => r.id));
        for (const set of rows('SELECT id FROM sets WHERE library_id = ?', [id])) {
            db.run('DELETE FROM set_pieces WHERE set_id = ?', [set.id]);
        }
        db.run('DELETE FROM sets WHERE library_id = ?', [id]);
        db.run('DELETE FROM libraries WHERE id = ?', [id]);
    }
    if (old.length) await saveLibrary();
    console.log(`[Library] Retention purge removed ${old.length} libraries unused for ${years} years`);
    return old.length;
}

/**
 * Write a dated copy of library.db to the backups folder, keeping the newest few
 * @param {Date} date - Date to name the backup after
 * @param {number} keep - How many to keep
 * @returns {Promise<string>} Backup path
 */
async function backupLibrary(date = new Date(), keep = 7) {
    await initLibrary();
    const backupDir = path.join(paths.dataDir, 'backups');
    const backupPath = path.join(backupDir, `library-${date.toISOString().slice(0, 10)}.db`);
    await saveLibrary();
    await writeDatabaseFile(backupPath);
    const backups = (await fs.readdir(backupDir)).filter(name => /^library-\d{4}-\d{2}-\d{2}\.db$/.test(name)).sort();
    for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
        await fs.remove(path.join(backupDir, name));
    }
    console.log(`[Library] Backup written to ${backupPath}`);
    return backupPath;
}

/**
 * For tests: forget the open database so the next call reopens it
 */
function resetForTests() {
    db = null;
    initPromise = null;
    pendingSave = null;
    lastSave = Promise.resolve();
}

module.exports = {
    LIMITS,
    LibraryError,
    initLibrary,
    flushLibrary,
    newKey,
    isValidKey,
    findLibrary,
    listPieces,
    addPiece,
    readPiece,
    updatePiece,
    deletePiece,
    purgeOldLibraries,
    backupLibrary,
    resetForTests
};
