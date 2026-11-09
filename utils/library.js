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
const { toSlug } = require('./slug');

// Limits, all adjustable
const LIMITS = {
    PIECES_PER_LIBRARY: 100,
    SETS_PER_LIBRARY: 50,
    ITEMS_PER_SET: 200,
    // Shared pieces and sets added from other people's links
    REFERENCES_PER_LIBRARY: 200,
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
    // What a set contains, in order: an uploaded piece ('upload', piece_id),
    // a whole catalogue work ('work', composer + work) or one catalogue
    // movement ('movement', composer + work + movement + midi_url)
    db.run(`
        CREATE TABLE IF NOT EXISTS set_items (
            set_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            kind TEXT NOT NULL,
            piece_id TEXT,
            composer TEXT,
            work TEXT,
            movement TEXT,
            midi_url TEXT,
            PRIMARY KEY (set_id, position)
        )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_set_items_piece ON set_items(piece_id)');
    // Sets saved before November 2026 listed uploaded pieces in set_pieces
    const oldRows = rows('SELECT set_id, piece_id, position FROM set_pieces ORDER BY set_id, position');
    for (const row of oldRows) {
        db.run('INSERT OR IGNORE INTO set_items (set_id, position, kind, piece_id) VALUES (?, ?, ?, ?)',
            [row.set_id, row.position, 'upload', row.piece_id]);
    }
    if (oldRows.length) db.run('DELETE FROM set_pieces');

    // Pieces and sets other people shared that this library has added (a
    // reference by share code, not a copy: if the owner stops sharing or
    // deletes it, it is no longer available here either)
    db.run(`
        CREATE TABLE IF NOT EXISTS library_refs (
            library_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            token TEXT NOT NULL,
            added_at TEXT NOT NULL,
            PRIMARY KEY (library_id, kind, token)
        )
    `);
    // Sharing (M5): share codes, and when the owner confirmed they may share
    addColumnIfMissing('pieces', 'share_token', 'TEXT');
    addColumnIfMissing('sets', 'share_token', 'TEXT');
    addColumnIfMissing('libraries', 'attested_at', 'TEXT');
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pieces_share ON pieces(share_token)');
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_sets_share ON sets(share_token)');
    db.run('CREATE INDEX IF NOT EXISTS idx_pieces_library ON pieces(library_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sets_library ON sets(library_id)');

    await saveLibrary();
}

function addColumnIfMissing(table, column, type) {
    const columns = db.exec(`PRAGMA table_info(${table})`)[0].values.map(row => row[1]);
    if (!columns.includes(column)) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
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
        lastUsedAt: row.last_used_at,
        shareToken: row.share_token || null
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
        throw new LibraryError(409, `My uploaded files is full (${LIMITS.PIECES_PER_LIBRARY} files). Delete a file to make room.`);
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
        db.run('DELETE FROM set_items WHERE kind = ? AND piece_id = ?', ['upload', id]);
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

// ===== Sharing (M5) =====

const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/**
 * A share code made from the title plus a short random ending, e.g.
 * "spring-concert-2027-k7q2". The random part makes codes impractical to
 * guess (about a million possibilities per title); unique across pieces and sets.
 * @param {string} title - Piece or set title
 * @param {string} fallback - Used if the title has no letters or digits
 * @returns {string} Share code
 */
function newToken(title, fallback) {
    const base = (toSlug(title).slice(0, 40).replace(/-+$/, '')) || fallback;
    for (;;) {
        let ending = '';
        for (let i = 0; i < 4; i++) {
            ending += TOKEN_ALPHABET[crypto.randomInt(TOKEN_ALPHABET.length)];
        }
        const token = `${base}-${ending}`;
        const taken = rows('SELECT 1 FROM pieces WHERE share_token = ? UNION SELECT 1 FROM sets WHERE share_token = ?', [token, token]);
        if (!taken.length) return token;
    }
}

/**
 * Whether text could be a share code: the current "title-abcd" form, or the
 * 16-character random codes used before November 2026
 */
function isToken(token) {
    return typeof token === 'string' &&
        (/^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{4}$/.test(token) && token.length <= 50 ||
         /^[A-Za-z0-9_-]{16}$/.test(token));
}

function isId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{12}$/.test(id);
}

/**
 * Whether the library's owner has confirmed they may share files
 * @param {number} libraryId - Library
 * @returns {Promise<boolean>}
 */
async function hasAttested(libraryId) {
    await initLibrary();
    const row = rows('SELECT attested_at FROM libraries WHERE id = ?', [libraryId])[0];
    return Boolean(row && row.attested_at);
}

/**
 * Record the owner's confirmation that they have the right to share
 * @param {number} libraryId - Library
 */
async function attest(libraryId) {
    await initLibrary();
    db.run('UPDATE libraries SET attested_at = COALESCE(attested_at, ?) WHERE id = ?', [now(), libraryId]);
    await saveLibrary();
}

async function requireAttested(libraryId) {
    if (!(await hasAttested(libraryId))) {
        throw new LibraryError(403, 'Please confirm that you have the right to share before sharing.');
    }
}

/**
 * Share a piece: give it a share code (keeping an existing one)
 * @param {number} libraryId - Library
 * @param {string} pieceId - Piece
 * @returns {Promise<string|null>} Share code, or null if the piece isn't in this library
 */
async function sharePiece(libraryId, pieceId) {
    await initLibrary();
    await requireAttested(libraryId);
    const row = ownedPiece(libraryId, pieceId);
    if (!row) return null;
    if (!row.composer) {
        throw new LibraryError(400, 'Please add the composer before sharing, so people know what the piece is.');
    }
    if (!row.share_token) {
        db.run('UPDATE pieces SET share_token = ? WHERE id = ?', [newToken(`${row.composer} ${row.title}`, 'piece'), row.id]);
        await saveLibrary();
    }
    return rows('SELECT share_token FROM pieces WHERE id = ?', [row.id])[0].share_token;
}

/**
 * Stop sharing a piece: its link stops working. Sharing again gives a new link.
 * @param {number} libraryId - Library
 * @param {string} pieceId - Piece
 * @returns {Promise<boolean>} False if the piece isn't in this library
 */
async function unsharePiece(libraryId, pieceId) {
    await initLibrary();
    const row = ownedPiece(libraryId, pieceId);
    if (!row) return false;
    db.run('UPDATE pieces SET share_token = NULL WHERE id = ?', [row.id]);
    await saveLibrary();
    return true;
}

/**
 * Record that a shared piece was used: keeps the piece and its owner's
 * library from being deleted as unused while anyone is playing it
 */
function touchShared(pieceIds, libraryId) {
    const time = now();
    for (const id of pieceIds) {
        db.run('UPDATE pieces SET last_used_at = ? WHERE id = ?', [time, id]);
    }
    db.run('UPDATE libraries SET last_used_at = ? WHERE id = ?', [time, libraryId]);
    saveLibrary();
}

/**
 * A shared piece by its share code
 * @param {string} token - Share code
 * @returns {Promise<{piece: Object, libraryId: number}|null>}
 */
async function findSharedPiece(token) {
    await initLibrary();
    if (!isToken(token)) return null;
    const row = rows('SELECT * FROM pieces WHERE share_token = ?', [token])[0];
    return row ? { piece: toPiece(row), libraryId: row.library_id } : null;
}

/**
 * The MIDI file of a shared piece (marks it used)
 * @param {string} token - Share code
 * @returns {Promise<Buffer|null>}
 */
async function readSharedPiece(token) {
    const found = await findSharedPiece(token);
    if (!found) return null;
    touchShared([found.piece.id], found.libraryId);
    return fs.readFile(path.join(paths.filesDir, `${found.piece.id}.mid`));
}

// ----- Sets -----

/**
 * A set's items in order. Uploaded pieces carry their current title and
 * composer; pieces since deleted are left out.
 * @param {string} setId - Set
 * @returns {Array<Object>} Items: { kind: 'upload', pieceId, title, composer },
 *     { kind: 'work', composer, work } or { kind: 'movement', composer, work, movement, midiUrl }
 */
function setItems(setId) {
    const items = [];
    for (const row of rows('SELECT * FROM set_items WHERE set_id = ? ORDER BY position', [setId])) {
        if (row.kind === 'upload') {
            const piece = rows('SELECT title, composer FROM pieces WHERE id = ?', [row.piece_id])[0];
            if (piece) {
                items.push({ kind: 'upload', pieceId: row.piece_id, title: piece.title, composer: piece.composer || '' });
            }
        } else if (row.kind === 'work') {
            items.push({ kind: 'work', composer: row.composer, work: row.work });
        } else {
            items.push({ kind: 'movement', composer: row.composer, work: row.work, movement: row.movement, midiUrl: row.midi_url });
        }
    }
    return items;
}

function toSet(row) {
    return {
        id: row.id,
        title: row.title,
        items: setItems(row.id),
        createdAt: row.created_at,
        shareToken: row.share_token || null
    };
}

function ownedSet(libraryId, setId) {
    if (!isId(setId)) return null;
    return rows('SELECT * FROM sets WHERE id = ? AND library_id = ?', [setId, libraryId])[0] || null;
}

/**
 * The library's sets, newest first
 * @param {number} libraryId - Library
 * @returns {Promise<Array<Object>>}
 */
async function listSets(libraryId) {
    await initLibrary();
    return rows('SELECT * FROM sets WHERE library_id = ? ORDER BY created_at DESC', [libraryId]).map(toSet);
}

/**
 * Check and tidy a set's items. Uploaded pieces must be the library's own;
 * catalogue works and movements are looked up with resolveCatalogue (from
 * the route, which has the catalogue index) so only real ones are stored.
 * @param {number} libraryId - Library
 * @param {Array<Object>} items - Items from the request
 * @param {Function} resolveCatalogue - (item) => tidied catalogue item, or null if not found
 * @returns {Array<Object>} Items to store
 */
function checkSetItems(libraryId, items, resolveCatalogue) {
    if (!Array.isArray(items) || items.length > LIMITS.ITEMS_PER_SET) {
        throw new LibraryError(400, `A set can have at most ${LIMITS.ITEMS_PER_SET} items.`);
    }
    return items.map(item => {
        if (item && item.kind === 'upload') {
            if (!ownedPiece(libraryId, item.pieceId)) {
                throw new LibraryError(400, 'A set can only contain your own uploaded files.');
            }
            return { kind: 'upload', pieceId: item.pieceId };
        }
        if (item && (item.kind === 'work' || item.kind === 'movement')) {
            // November 2026: sets are limited to uploaded files until adding
            // from the catalogue is designed properly (no resolver is passed)
            if (!resolveCatalogue) {
                throw new LibraryError(400, 'For now, sets can only contain your uploaded files. Take out any works or movements from our collection, then save again.');
            }
            const found = resolveCatalogue(item);
            if (!found) {
                throw new LibraryError(400, 'A work or movement in this set couldn\'t be found in our collection.');
            }
            return found;
        }
        throw new LibraryError(400, 'The list of items in the set isn\'t valid.');
    });
}

function writeSetItems(setId, items) {
    db.run('DELETE FROM set_items WHERE set_id = ?', [setId]);
    items.forEach((item, position) => {
        db.run(`INSERT INTO set_items (set_id, position, kind, piece_id, composer, work, movement, midi_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [setId, position, item.kind, item.pieceId || null, item.composer || null,
                item.work || null, item.movement || null, item.midiUrl || null]);
    });
}

/**
 * Create a set
 * @param {number} libraryId - Library
 * @param {{title: string, items?: Array<Object>}} set - Title and items in order
 * @param {Function} [resolveCatalogue] - See checkSetItems
 * @returns {Promise<Object>} The set
 */
async function createSet(libraryId, { title, items = [] }, resolveCatalogue = null) {
    await initLibrary();
    const cleanTitle = cleanText(title, true, 'title');
    const cleanItems = checkSetItems(libraryId, items, resolveCatalogue);
    const count = rows('SELECT COUNT(*) AS n FROM sets WHERE library_id = ?', [libraryId])[0].n;
    if (count >= LIMITS.SETS_PER_LIBRARY) {
        throw new LibraryError(409, `You can have at most ${LIMITS.SETS_PER_LIBRARY} sets. Delete one to make room.`);
    }
    const id = crypto.randomBytes(9).toString('base64url');
    const time = now();
    db.run('INSERT INTO sets (id, library_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, libraryId, cleanTitle, time, time]);
    writeSetItems(id, cleanItems);
    touchLibrary(libraryId);
    await saveLibrary();
    return toSet(rows('SELECT * FROM sets WHERE id = ?', [id])[0]);
}

/**
 * Rename a set and/or change its items
 * @param {number} libraryId - Library
 * @param {string} setId - Set
 * @param {{title?: string, items?: Array<Object>}} changes
 * @param {Function} [resolveCatalogue] - See checkSetItems
 * @returns {Promise<Object|null>} The set, or null if not in this library
 */
async function updateSet(libraryId, setId, { title, items }, resolveCatalogue = null) {
    await initLibrary();
    const row = ownedSet(libraryId, setId);
    if (!row) return null;
    const cleanTitle = title === undefined ? row.title : cleanText(title, true, 'title');
    if (items !== undefined) {
        writeSetItems(row.id, checkSetItems(libraryId, items, resolveCatalogue));
    }
    db.run('UPDATE sets SET title = ?, updated_at = ? WHERE id = ?', [cleanTitle, now(), row.id]);
    touchLibrary(libraryId);
    await saveLibrary();
    return toSet(rows('SELECT * FROM sets WHERE id = ?', [row.id])[0]);
}

/**
 * Delete a set (its pieces stay in the library)
 * @returns {Promise<boolean>} False if not in this library
 */
async function deleteSet(libraryId, setId) {
    await initLibrary();
    const row = ownedSet(libraryId, setId);
    if (!row) return false;
    db.run('DELETE FROM set_items WHERE set_id = ?', [row.id]);
    db.run('DELETE FROM sets WHERE id = ?', [row.id]);
    await saveLibrary();
    return true;
}

/**
 * Share a set (keeping an existing share code)
 * @returns {Promise<string|null>} Share code, or null if not in this library
 */
async function shareSet(libraryId, setId) {
    await initLibrary();
    await requireAttested(libraryId);
    const row = ownedSet(libraryId, setId);
    if (!row) return null;
    if (!row.share_token) {
        db.run('UPDATE sets SET share_token = ? WHERE id = ?', [newToken(row.title, 'set'), row.id]);
        await saveLibrary();
    }
    return rows('SELECT share_token FROM sets WHERE id = ?', [row.id])[0].share_token;
}

/**
 * Stop sharing a set
 * @returns {Promise<boolean>} False if not in this library
 */
async function unshareSet(libraryId, setId) {
    await initLibrary();
    const row = ownedSet(libraryId, setId);
    if (!row) return false;
    db.run('UPDATE sets SET share_token = NULL WHERE id = ?', [row.id]);
    await saveLibrary();
    return true;
}

/**
 * A shared set by its share code, with its items in order
 * @param {string} token - Share code
 * @returns {Promise<{set: Object, libraryId: number}|null>}
 */
async function findSharedSet(token) {
    await initLibrary();
    if (!isToken(token)) return null;
    const row = rows('SELECT * FROM sets WHERE share_token = ?', [token])[0];
    return row ? { set: toSet(row), libraryId: row.library_id } : null;
}

/**
 * The MIDI file of one piece in a shared set (marks it used)
 * @param {string} token - Set share code
 * @param {string} pieceId - Piece in the set
 * @returns {Promise<Buffer|null>}
 */
async function readSharedSetPiece(token, pieceId) {
    const found = await findSharedSet(token);
    if (!found || !found.set.items.some(item => item.kind === 'upload' && item.pieceId === pieceId)) return null;
    touchShared([pieceId], found.libraryId);
    return fs.readFile(path.join(paths.filesDir, `${pieceId}.mid`));
}

// ----- Pieces and sets added from other people's links -----

/**
 * Add a shared piece or set to a library (as a reference)
 * @param {number} libraryId - Library
 * @param {'piece'|'set'} kind - What the link is to
 * @param {string} token - Its share code
 * @returns {Promise<boolean>} False if the link isn't (or is no longer) shared
 */
async function addReference(libraryId, kind, token) {
    await initLibrary();
    const found = kind === 'piece' ? await findSharedPiece(token)
        : kind === 'set' ? await findSharedSet(token) : null;
    if (!found) return false;
    if (found.libraryId === libraryId) {
        throw new LibraryError(400, 'This is already in your list.');
    }
    const count = rows('SELECT COUNT(*) AS n FROM library_refs WHERE library_id = ?', [libraryId])[0].n;
    if (count >= LIMITS.REFERENCES_PER_LIBRARY) {
        throw new LibraryError(409, `You can add at most ${LIMITS.REFERENCES_PER_LIBRARY} shared pieces and sets. Remove one to make room.`);
    }
    db.run('INSERT OR IGNORE INTO library_refs (library_id, kind, token, added_at) VALUES (?, ?, ?, ?)',
        [libraryId, kind, token, now()]);
    touchLibrary(libraryId);
    await saveLibrary();
    return true;
}

/**
 * Remove a shared piece or set from a library
 * @returns {Promise<boolean>} False if it wasn't there
 */
async function removeReference(libraryId, kind, token) {
    await initLibrary();
    db.run('DELETE FROM library_refs WHERE library_id = ? AND kind = ? AND token = ?', [libraryId, kind, token]);
    const removed = db.getRowsModified() > 0;
    if (removed) await saveLibrary();
    return removed;
}

/**
 * Shared pieces and sets a library has added, with their current titles,
 * or available: false if the owner has stopped sharing or deleted them
 * @param {number} libraryId - Library
 * @returns {Promise<Array<Object>>}
 */
async function listReferences(libraryId) {
    await initLibrary();
    const result = [];
    for (const ref of rows('SELECT * FROM library_refs WHERE library_id = ? ORDER BY added_at DESC', [libraryId])) {
        const base = { kind: ref.kind, token: ref.token, addedAt: ref.added_at };
        if (ref.kind === 'piece') {
            const found = await findSharedPiece(ref.token);
            result.push(found
                ? { ...base, available: true, title: found.piece.title, composer: found.piece.composer }
                : { ...base, available: false });
        } else {
            const found = await findSharedSet(ref.token);
            result.push(found
                ? { ...base, available: true, title: found.set.title, itemCount: found.set.items.length }
                : { ...base, available: false });
        }
    }
    return result;
}

/**
 * Whether a library has added a shared piece or set
 */
async function hasReference(libraryId, kind, token) {
    await initLibrary();
    return rows('SELECT 1 FROM library_refs WHERE library_id = ? AND kind = ? AND token = ?',
        [libraryId, kind, token]).length > 0;
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
            db.run('DELETE FROM set_items WHERE set_id = ?', [set.id]);
        }
        db.run('DELETE FROM sets WHERE library_id = ?', [id]);
        db.run('DELETE FROM library_refs WHERE library_id = ?', [id]);
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
    hasAttested,
    attest,
    sharePiece,
    unsharePiece,
    findSharedPiece,
    readSharedPiece,
    listSets,
    createSet,
    updateSet,
    deleteSet,
    shareSet,
    unshareSet,
    findSharedSet,
    readSharedSetPiece,
    addReference,
    removeReference,
    listReferences,
    hasReference,
    purgeOldLibraries,
    backupLibrary,
    resetForTests
};
