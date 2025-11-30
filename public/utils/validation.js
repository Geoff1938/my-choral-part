/**
 * Input Validation Utilities
 * Functions for validating URLs, voice parts, and other user inputs
 */

import { VOICE_PARTS } from '../constants.js';
import { ValidationError, CopyrightError } from '../errors.js';

/**
 * Validate a MIDI URL
 * @param {string} url - The URL to validate
 * @returns {boolean} True if valid
 * @throws {ValidationError} If URL is invalid
 * @throws {CopyrightError} If URL points to copyright-protected content
 */
export function validateMIDIUrl(url) {
    if (!url || typeof url !== 'string') {
        throw new ValidationError('URL must be a non-empty string', 'url');
    }

    try {
        const parsed = new URL(url);

        // Check protocol
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new ValidationError('URL must use HTTP or HTTPS protocol', 'url');
        }

        // Reject HTML files first (copyright protection)
        if (url.endsWith('.html') || url.endsWith('.htm')) {
            throw new CopyrightError();
        }

        // Check if it looks like a MIDI file or is from the expected domain
        const isMidiFile = /\.(mid|midi)$/i.test(url);
        const isChoralMusicSite = url.includes('learnchoralmusic.co.uk');

        if (!isMidiFile && !isChoralMusicSite) {
            throw new ValidationError('URL must be a MIDI file (.mid or .midi)', 'url');
        }

        return true;
    } catch (error) {
        if (error instanceof ValidationError || error instanceof CopyrightError) {
            throw error;
        }
        throw new ValidationError('Invalid URL format', 'url', error);
    }
}

/**
 * Validate and normalize a voice part
 * @param {string} part - The voice part to validate
 * @returns {string} Normalized voice part (lowercase)
 * @throws {ValidationError} If voice part is invalid
 */
export function validateVoicePart(part) {
    if (!part || typeof part !== 'string') {
        throw new ValidationError('Voice part must be a non-empty string', 'voicePart');
    }

    const normalizedPart = part.toLowerCase();
    const validParts = Object.values(VOICE_PARTS);

    if (!validParts.includes(normalizedPart)) {
        throw new ValidationError(
            `Voice part must be one of: ${validParts.join(', ')}`,
            'voicePart'
        );
    }

    return normalizedPart;
}

/**
 * Validate tempo multiplier
 * @param {number} tempo - Tempo multiplier
 * @returns {number} Validated tempo
 * @throws {ValidationError} If tempo is invalid
 */
export function validateTempo(tempo) {
    if (typeof tempo !== 'number' || isNaN(tempo)) {
        throw new ValidationError('Tempo must be a number', 'tempo');
    }

    // Import from constants
    const MIN_TEMPO = 0.25;
    const MAX_TEMPO = 2.0;

    if (tempo < MIN_TEMPO || tempo > MAX_TEMPO) {
        throw new ValidationError(
            `Tempo must be between ${MIN_TEMPO} and ${MAX_TEMPO}`,
            'tempo'
        );
    }

    return tempo;
}

/**
 * Validate volume percentage
 * @param {number} volume - Volume percentage (0-200)
 * @returns {number} Validated volume
 * @throws {ValidationError} If volume is invalid
 */
export function validateVolume(volume) {
    if (typeof volume !== 'number' || isNaN(volume)) {
        throw new ValidationError('Volume must be a number', 'volume');
    }

    const MIN = 0;
    const MAX = 200;

    if (volume < MIN || volume > MAX) {
        throw new ValidationError(
            `Volume must be between ${MIN} and ${MAX}`,
            'volume'
        );
    }

    return volume;
}

/**
 * Sanitize localStorage value
 * @param {string} value - Value to sanitize
 * @param {number} maxLength - Maximum length
 * @returns {string} Sanitized value
 */
export function sanitizeStorageValue(value, maxLength = 1000) {
    if (typeof value !== 'string') {
        return '';
    }

    // Remove any potential XSS attempts
    let sanitized = value
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');

    // Limit length
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
}

/**
 * Escape HTML special characters to prevent XSS
 * Use this when inserting untrusted content into HTML
 * @param {string} str - String to escape
 * @returns {string} HTML-escaped string
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) {
        return '';
    }
    if (typeof str !== 'string') {
        str = String(str);
    }
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape a string for safe use in HTML attributes
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for HTML attributes
 */
export function escapeHtmlAttribute(str) {
    return escapeHtml(str);
}

/**
 * Validate and sanitize a string for display
 * @param {string} str - String to validate
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
export function sanitizeDisplayString(str, maxLength = 500) {
    if (str === null || str === undefined) {
        return '';
    }
    if (typeof str !== 'string') {
        str = String(str);
    }
    // Truncate if too long
    if (str.length > maxLength) {
        str = str.substring(0, maxLength) + '...';
    }
    return escapeHtml(str);
}
