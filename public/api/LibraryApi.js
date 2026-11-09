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
    }
};
