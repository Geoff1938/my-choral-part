/**
 * URL Utilities
 * Functions for parsing, building, and manipulating URLs
 */

import { BASE_URL } from '../constants.js';

/**
 * Convert relative URL to absolute URL
 * @param {string} relativeUrl - Relative URL (e.g., '/Handel/Messiah/01.mid')
 * @param {string} baseUrl - Base URL (default: learnchoralmusic.co.uk)
 * @returns {string} Absolute URL
 */
export function toAbsoluteUrl(relativeUrl, baseUrl = BASE_URL) {
    if (!relativeUrl) {
        return '';
    }

    // Already absolute
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
        return relativeUrl;
    }

    // Ensure base URL doesn't end with slash and relative URL starts with slash
    const cleanBase = baseUrl.replace(/\/$/, '');
    const cleanRelative = relativeUrl.startsWith('/') ? relativeUrl : '/' + relativeUrl;

    return cleanBase + cleanRelative;
}

/**
 * Build shareable URL for current work
 * @param {string} composer - Composer name
 * @param {string} work - Work name
 * @returns {string} Shareable URL
 */
export function buildShareableUrl(composer, work) {
    const baseUrl = window.location.origin + window.location.pathname;
    const cleanComposer = encodeURIComponent(composer.toLowerCase().replace(/\s+/g, '-'));
    const cleanWork = encodeURIComponent(work.toLowerCase().replace(/\s+/g, '-'));

    // Remove trailing slash from baseUrl
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    return `${cleanBaseUrl}/${cleanComposer}/${cleanWork}`;
}

/**
 * Parse route from URL pathname
 * @param {string} pathname - URL pathname (e.g., '/bach/mass-in-b-minor')
 * @returns {Object|null} Parsed route {composer, work} or null
 */
export function parseRoute(pathname) {
    if (!pathname || pathname === '/') {
        return null;
    }

    // Remove leading/trailing slashes and split
    const parts = pathname.replace(/^\/|\/$/g, '').split('/');

    if (parts.length >= 2) {
        return {
            composer: decodeURIComponent(parts[0].replace(/-/g, ' ')),
            work: decodeURIComponent(parts[1].replace(/-/g, ' '))
        };
    }

    return null;
}

/**
 * Build MIDI proxy URL
 * @param {string} midiUrl - Original MIDI URL
 * @returns {string} Proxy URL
 */
export function buildProxyUrl(midiUrl) {
    return `/proxy?url=${encodeURIComponent(midiUrl)}`;
}

/**
 * Extract filename from URL
 * @param {string} url - Full URL
 * @returns {string} Filename
 */
export function getFilenameFromUrl(url) {
    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/');
        return parts[parts.length - 1] || '';
    } catch (error) {
        return '';
    }
}

/**
 * Check if URL is from the choral music website
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export function isChoralMusicUrl(url) {
    return url && url.includes('learnchoralmusic.co.uk');
}
