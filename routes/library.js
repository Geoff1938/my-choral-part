/**
 * Library API (/api/library): save, list, play, rename and delete practice
 * MIDIs converted from users' own files.
 *
 * The library is identified by a random key in an HttpOnly cookie, created
 * when the first piece is saved. There are no accounts. Changing requests
 * must come from this site (requireSameOrigin, applied in server.js).
 */

const express = require('express');
const library = require('../utils/library');

const COOKIE_NAME = 'mcp_library';
// Browsers cap cookie lifetimes at about 400 days; the cookie is renewed on
// every use, so it only lapses after 400 days without using the library
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * The library key from the request's cookie, or null
 * @param {express.Request} req - Request
 * @returns {string|null} Key
 */
function readKey(req) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === COOKIE_NAME) {
            const value = rest.join('=');
            return library.isValidKey(value) ? value : null;
        }
    }
    return null;
}

/**
 * Set (or renew) the library cookie
 * @param {express.Request} req - Request
 * @param {express.Response} res - Response
 * @param {string} key - Library key
 */
function setKeyCookie(req, res, key) {
    const secure = req.secure ? '; Secure' : '';
    res.append('Set-Cookie',
        `${COOKIE_NAME}=${key}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`);
}

/**
 * The library for this request (renewing its cookie), or null if the user
 * has none
 * @param {express.Request} req - Request
 * @param {express.Response} res - Response
 * @returns {Promise<{id: number}|null>}
 */
async function currentLibrary(req, res) {
    const key = readKey(req);
    if (!key) return null;
    const found = await library.findLibrary(key);
    if (found) setKeyCookie(req, res, key);
    return found;
}

/**
 * Check that bytes are a practice MIDI the player can use: a readable MIDI
 * file with at least one track named as a voice part. The browser converted
 * it, but anything can be sent to the server, so it is checked again here.
 * @param {Buffer} midi - File contents
 */
async function validatePracticeMidi(midi) {
    const { readMidi, metaText, META } = await import('../public/practice-midi/smf.js');
    const { detectVoicePartFromName } = await import('../public/practice-midi/voiceParts.js');
    let song;
    try {
        song = readMidi(new Uint8Array(midi));
    } catch (error) {
        throw new library.LibraryError(400, 'This isn\'t a valid MIDI file.');
    }
    const hasVoice = song.format !== 2 &&
        song.tracks.some(track => detectVoicePartFromName(metaText(track, META.TRACK_NAME) || ''));
    if (!hasVoice) {
        throw new library.LibraryError(400, 'This doesn\'t look like a practice file made by MyChoralPart.');
    }
}

/**
 * Send a LibraryError as JSON, or pass anything else on
 */
function handleError(error, res, next) {
    if (error instanceof library.LibraryError) {
        return res.status(error.status).json({ error: error.message });
    }
    next(error);
}

/**
 * @param {Function} [resolveCatalogue] - Looks up a catalogue work or movement
 *     for a set item: (item) => tidied item, or null if it isn't in the catalogue
 */
function createLibraryRoutes(resolveCatalogue = null) {
    const router = express.Router();

    // List the pieces in this user's library (empty if they have none yet)
    router.get('/', async (req, res, next) => {
        try {
            const found = await currentLibrary(req, res);
            res.setHeader('Cache-Control', 'no-store');
            res.json({
                pieces: found ? await library.listPieces(found.id) : [],
                sets: found ? await library.listSets(found.id) : [],
                references: found ? await library.listReferences(found.id) : [],
                attested: found ? await library.hasAttested(found.id) : false,
                limit: library.LIMITS.PIECES_PER_LIBRARY
            });
        } catch (error) {
            handleError(error, res, next);
        }
    });

    // Save a piece: { title, composer, midi (base64) }. Creates the library
    // and its cookie on the first save.
    router.post('/pieces', async (req, res, next) => {
        try {
            const { title, composer, midi } = req.body || {};
            if (typeof midi !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(midi)) {
                throw new library.LibraryError(400, 'No MIDI file was received.');
            }
            const bytes = Buffer.from(midi, 'base64');
            if (bytes.length > library.LIMITS.MAX_PIECE_BYTES) {
                throw new library.LibraryError(413, 'This file is too large to save.');
            }
            await validatePracticeMidi(bytes);

            let key = readKey(req);
            let found = key ? await library.findLibrary(key) : null;
            if (!found) {
                key = library.newKey();
                found = await library.findLibrary(key, { create: true });
            }
            const piece = await library.addPiece(found.id, { title, composer, midi: bytes });
            setKeyCookie(req, res, key);
            res.status(201).json({ piece });
        } catch (error) {
            handleError(error, res, next);
        }
    });

    // The MIDI file of a piece in this user's library
    router.get('/pieces/:id/midi', async (req, res, next) => {
        try {
            const found = await currentLibrary(req, res);
            const result = found ? await library.readPiece(found.id, req.params.id) : null;
            if (!result) {
                return res.status(404).json({ error: 'This piece isn\'t in My uploaded files.' });
            }
            res.setHeader('Content-Type', 'audio/midi');
            res.setHeader('Cache-Control', 'private, no-store');
            res.send(result.midi);
        } catch (error) {
            handleError(error, res, next);
        }
    });

    // Rename: { title?, composer? }
    router.patch('/pieces/:id', async (req, res, next) => {
        try {
            const found = await currentLibrary(req, res);
            const { title, composer } = req.body || {};
            const piece = found ? await library.updatePiece(found.id, req.params.id, { title, composer }) : null;
            if (!piece) {
                return res.status(404).json({ error: 'This piece isn\'t in My uploaded files.' });
            }
            res.json({ piece });
        } catch (error) {
            handleError(error, res, next);
        }
    });

    router.delete('/pieces/:id', async (req, res, next) => {
        try {
            const found = await currentLibrary(req, res);
            const deleted = found ? await library.deletePiece(found.id, req.params.id) : false;
            if (!deleted) {
                return res.status(404).json({ error: 'This piece isn\'t in My uploaded files.' });
            }
            res.status(204).end();
        } catch (error) {
            handleError(error, res, next);
        }
    });

    // ----- Sharing -----

    // Run a handler with the user's library, or answer 404 if they have none
    const withLibrary = handler => async (req, res, next) => {
        try {
            const found = await currentLibrary(req, res);
            if (!found) {
                return res.status(404).json({ error: 'You haven\'t uploaded any files or made any sets yet.' });
            }
            await handler(found, req, res);
        } catch (error) {
            handleError(error, res, next);
        }
    };
    const notFound = (res, what = 'piece') => res.status(404).json({ error: `This ${what} isn't in your list.` });

    // The owner confirms they have the right to share (asked once, before the first share)
    router.post('/attest', withLibrary(async (found, req, res) => {
        if (!req.body || req.body.confirmed !== true) {
            throw new library.LibraryError(400, 'Please tick the box to confirm.');
        }
        await library.attest(found.id);
        res.json({ attested: true });
    }));

    router.post('/pieces/:id/share', withLibrary(async (found, req, res) => {
        const token = await library.sharePiece(found.id, req.params.id);
        return token ? res.json({ shareToken: token }) : notFound(res);
    }));

    router.delete('/pieces/:id/share', withLibrary(async (found, req, res) => {
        return (await library.unsharePiece(found.id, req.params.id)) ? res.status(204).end() : notFound(res);
    }));

    // ----- Sets -----

    router.post('/sets', withLibrary(async (found, req, res) => {
        const { title, items } = req.body || {};
        res.status(201).json({ set: await library.createSet(found.id, { title, items: items || [] }, resolveCatalogue) });
    }));

    router.patch('/sets/:id', withLibrary(async (found, req, res) => {
        const { title, items } = req.body || {};
        const set = await library.updateSet(found.id, req.params.id, { title, items }, resolveCatalogue);
        return set ? res.json({ set }) : notFound(res, 'set');
    }));

    router.delete('/sets/:id', withLibrary(async (found, req, res) => {
        return (await library.deleteSet(found.id, req.params.id)) ? res.status(204).end() : notFound(res, 'set');
    }));

    router.post('/sets/:id/share', withLibrary(async (found, req, res) => {
        const token = await library.shareSet(found.id, req.params.id);
        return token ? res.json({ shareToken: token }) : notFound(res, 'set');
    }));

    router.delete('/sets/:id/share', withLibrary(async (found, req, res) => {
        return (await library.unshareSet(found.id, req.params.id)) ? res.status(204).end() : notFound(res, 'set');
    }));

    // ----- Pieces and sets shared by others -----

    // Add a shared piece or set: { kind: 'piece'|'set', token }. Creates the
    // library (and its cookie) if this is the user's first.
    router.post('/references', async (req, res, next) => {
        try {
            const { kind, token } = req.body || {};
            if (kind !== 'piece' && kind !== 'set') {
                throw new library.LibraryError(400, 'Unknown kind of link.');
            }
            let key = readKey(req);
            let found = key ? await library.findLibrary(key) : null;
            if (!found) {
                key = library.newKey();
                found = await library.findLibrary(key, { create: true });
            }
            if (!(await library.addReference(found.id, kind, token))) {
                return res.status(404).json({ error: SHARED_GONE });
            }
            setKeyCookie(req, res, key);
            res.status(201).json({ added: true });
        } catch (error) {
            handleError(error, res, next);
        }
    });

    router.delete('/references/:kind/:token', withLibrary(async (found, req, res) => {
        return (await library.removeReference(found.id, req.params.kind, req.params.token))
            ? res.status(204).end()
            : res.status(404).json({ error: 'This isn\'t in your list.' });
    }));

    return router;
}

const SHARED_GONE = 'This shared link is no longer available. The person who shared it may have stopped sharing it or deleted it.';

/**
 * Public routes for opening shared links (/api/shared). Anyone with the
 * link can play the piece or set; nothing else of the owner's is visible.
 */
function createSharedRoutes() {
    const router = express.Router();

    // Whether the visitor owns this, or has already added it to their library
    async function visitorStatus(req, res, kind, token, ownerLibraryId) {
        const found = await currentLibrary(req, res);
        const isOwner = Boolean(found && found.id === ownerLibraryId);
        return {
            isOwner,
            inLibrary: isOwner || Boolean(found && await library.hasReference(found.id, kind, token))
        };
    }

    const sendMidi = (res, midi) => {
        res.setHeader('Content-Type', 'audio/midi');
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(midi);
    };
    const gone = res => res.status(404).json({ error: SHARED_GONE });

    router.use((req, res, next) => {
        res.setHeader('X-Robots-Tag', 'noindex');
        next();
    });

    router.get('/p/:token', async (req, res, next) => {
        try {
            const found = await library.findSharedPiece(req.params.token);
            if (!found) return gone(res);
            res.json({
                kind: 'piece',
                title: found.piece.title,
                composer: found.piece.composer,
                pieceId: found.piece.id,
                ...(await visitorStatus(req, res, 'piece', req.params.token, found.libraryId))
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/p/:token/midi', async (req, res, next) => {
        try {
            const midi = await library.readSharedPiece(req.params.token);
            return midi ? sendMidi(res, midi) : gone(res);
        } catch (error) {
            next(error);
        }
    });

    router.get('/s/:token', async (req, res, next) => {
        try {
            const found = await library.findSharedSet(req.params.token);
            if (!found) return gone(res);
            res.json({
                kind: 'set',
                title: found.set.title,
                items: found.set.items,
                ...(await visitorStatus(req, res, 'set', req.params.token, found.libraryId))
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/s/:token/pieces/:pieceId/midi', async (req, res, next) => {
        try {
            const midi = await library.readSharedSetPiece(req.params.token, req.params.pieceId);
            return midi ? sendMidi(res, midi) : gone(res);
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createLibraryRoutes, createSharedRoutes, COOKIE_NAME, readKey, SHARED_GONE };
