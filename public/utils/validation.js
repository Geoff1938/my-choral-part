/**
 * Input Validation Utilities
 * Functions for escaping and sanitizing untrusted strings for display
 */

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
