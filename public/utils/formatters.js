/**
 * Formatting Utilities
 * Functions for formatting time, numbers, and other display values
 */

/**
 * Format seconds as MM:SS
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string (e.g., "2:05")
 */
export function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0 || seconds === undefined || seconds === null) {
        return '0:00';
    }

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format volume percentage as decibels
 * @param {number} volumePercent - Volume as percentage (0-200)
 * @returns {number} Volume in decibels
 */
export function volumePercentToDb(volumePercent) {
    if (volumePercent === 0) {
        return -Infinity;
    }

    // 100% = -10dB (default)
    // 0% = -Infinity (silent)
    // 200% = +10dB (amplified)
    const MIN_DB = -60;
    const DEFAULT_DB = -10;
    const MAX_DB = 10;

    if (volumePercent <= 100) {
        // 0-100%: map to MIN_DB to DEFAULT_DB
        return MIN_DB + (volumePercent / 100) * (DEFAULT_DB - MIN_DB);
    } else {
        // 100-200%: map to DEFAULT_DB to MAX_DB
        return DEFAULT_DB + ((volumePercent - 100) / 100) * (MAX_DB - DEFAULT_DB);
    }
}

/**
 * Format composer and work name for display
 * @param {string} composer - Composer name
 * @param {string} work - Work name
 * @param {string} movement - Optional movement name
 * @returns {string} Formatted string
 */
export function formatWorkTitle(composer, work, movement = null) {
    let title = `${composer}, ${work}`;
    if (movement) {
        title += ` - ${movement}`;
    }
    return title;
}

/**
 * Format file size in bytes to human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "2.5 MB")
 */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format tempo multiplier as percentage
 * @param {number} multiplier - Tempo multiplier (0.25 to 2.0)
 * @returns {string} Formatted percentage (e.g., "75%")
 */
export function formatTempo(multiplier) {
    return `${Math.round(multiplier * 100)}%`;
}

/**
 * Truncate text to maximum length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add (default: '...')
 * @returns {string} Truncated text
 */
export function truncate(text, maxLength, suffix = '...') {
    if (!text || text.length <= maxLength) {
        return text;
    }

    return text.substring(0, maxLength - suffix.length) + suffix;
}
