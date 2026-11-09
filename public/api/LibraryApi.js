/**
 * LibraryApi
 * Calls the server's /api/library endpoints for the user's saved pieces.
 * The library is identified by an HttpOnly cookie the server sets on the
 * first save, so nothing about it is stored by this code.
 */

/**
 * Error from the library API, with the server's message for the user
 */
export class LibraryApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

/**
 * Encode bytes as base64 (in chunks, so large files don't overflow the call stack)
 * @param {Uint8Array} bytes - Data
 * @returns {string} Base64 text
 */
export function toBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

async function call(url, options = {}) {
    let response;
    try {
        response = await fetch(url, { credentials: 'same-origin', ...options });
    } catch (error) {
        throw new LibraryApiError('Couldn\'t reach the server. Check your connection and try again.', 0);
    }
    if (!response.ok) {
        let message = 'Something went wrong. Please try again.';
        try {
            const body = await response.json();
            if (body && body.error) message = body.error;
        } catch (error) {
            // Not JSON - keep the general message
        }
        throw new LibraryApiError(message, response.status);
    }
    return response;
}

function jsonRequest(method, body) {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

export const LibraryApi = {
    /**
     * The user's saved pieces
     * @returns {Promise<{pieces: Array<Object>, limit: number}>}
     */
    async list() {
        return (await call('/api/library')).json();
    },

    /**
     * Save a practice MIDI
     * @param {{title: string, composer?: string, midi: Uint8Array}} piece
     * @returns {Promise<Object>} The saved piece
     */
    async save({ title, composer, midi }) {
        const response = await call('/api/library/pieces',
            jsonRequest('POST', { title, composer: composer || '', midi: toBase64(midi) }));
        return (await response.json()).piece;
    },

    /**
     * A saved piece's MIDI file
     * @param {string} id - Piece
     * @returns {Promise<Uint8Array>}
     */
    async fetchMidi(id) {
        const response = await call(`/api/library/pieces/${encodeURIComponent(id)}/midi`);
        return new Uint8Array(await response.arrayBuffer());
    },

    /**
     * Change a piece's title and composer
     * @param {string} id - Piece
     * @param {{title: string, composer: string}} changes
     * @returns {Promise<Object>} The updated piece
     */
    async rename(id, changes) {
        const response = await call(`/api/library/pieces/${encodeURIComponent(id)}`, jsonRequest('PATCH', changes));
        return (await response.json()).piece;
    },

    /**
     * Delete a piece
     * @param {string} id - Piece
     */
    async remove(id) {
        await call(`/api/library/pieces/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    // ----- Sharing -----

    /** Confirm the user has the right to share (asked once, before the first share) */
    async attest() {
        await call('/api/library/attest', jsonRequest('POST', { confirmed: true }));
    },

    /**
     * Share a piece or set
     * @param {'piece'|'set'} kind
     * @param {string} id
     * @returns {Promise<string>} Share code
     */
    async share(kind, id) {
        const path = kind === 'set' ? 'sets' : 'pieces';
        const response = await call(`/api/library/${path}/${encodeURIComponent(id)}/share`, { method: 'POST' });
        return (await response.json()).shareToken;
    },

    /**
     * Stop sharing a piece or set (its link stops working)
     * @param {'piece'|'set'} kind
     * @param {string} id
     */
    async unshare(kind, id) {
        const path = kind === 'set' ? 'sets' : 'pieces';
        await call(`/api/library/${path}/${encodeURIComponent(id)}/share`, { method: 'DELETE' });
    },

    // ----- Sets -----

    /**
     * @param {{title: string, pieceIds: string[]}} set
     * @returns {Promise<Object>} The new set
     */
    async createSet(set) {
        return (await (await call('/api/library/sets', jsonRequest('POST', set))).json()).set;
    },

    /**
     * @param {string} id - Set
     * @param {{title?: string, pieceIds?: string[]}} changes
     * @returns {Promise<Object>} The updated set
     */
    async updateSet(id, changes) {
        return (await (await call(`/api/library/sets/${encodeURIComponent(id)}`, jsonRequest('PATCH', changes))).json()).set;
    },

    /** @param {string} id - Set (its pieces stay in the library) */
    async deleteSet(id) {
        await call(`/api/library/sets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    // ----- Pieces and sets shared by others -----

    /**
     * Add a shared piece or set to the user's library
     * @param {'piece'|'set'} kind
     * @param {string} token - Share code
     */
    async addReference(kind, token) {
        await call('/api/library/references', jsonRequest('POST', { kind, token }));
    },

    /** Remove a shared piece or set from the user's library */
    async removeReference(kind, token) {
        await call(`/api/library/references/${encodeURIComponent(kind)}/${encodeURIComponent(token)}`, { method: 'DELETE' });
    }
};

/**
 * Opening shared links (/p/... and /s/...)
 */
export const SharedApi = {
    /**
     * What a share code points to
     * @param {'piece'|'set'} kind
     * @param {string} token - Share code
     * @returns {Promise<Object>} { kind, title, composer | pieces, isOwner, inLibrary }
     */
    async info(kind, token) {
        return (await call(`/api/shared/${kind === 'set' ? 's' : 'p'}/${encodeURIComponent(token)}`)).json();
    },

    /** @returns {Promise<Uint8Array>} A shared piece's MIDI */
    async pieceMidi(token) {
        const response = await call(`/api/shared/p/${encodeURIComponent(token)}/midi`);
        return new Uint8Array(await response.arrayBuffer());
    },

    /** @returns {Promise<Uint8Array>} The MIDI of one piece in a shared set */
    async setPieceMidi(token, pieceId) {
        const response = await call(`/api/shared/s/${encodeURIComponent(token)}/pieces/${encodeURIComponent(pieceId)}/midi`);
        return new Uint8Array(await response.arrayBuffer());
    }
};

/**
 * Full link for a share code
 * @param {'piece'|'set'} kind
 * @param {string} token - Share code
 * @param {string} [origin] - Site address (defaults to this page's)
 * @returns {string} URL
 */
export function shareUrl(kind, token, origin = window.location.origin) {
    return `${origin}/${kind === 'set' ? 's' : 'p'}/${token}`;
}
