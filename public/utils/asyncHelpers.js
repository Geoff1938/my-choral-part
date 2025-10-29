/**
 * Async Helper Utilities
 * Functions for handling async operations (retry, timeout, delay)
 */

import { TIMEOUTS, NETWORK } from '../constants.js';
import { TimeoutError, NetworkError } from '../errors.js';

/**
 * Add timeout to a promise
 * @param {Promise} promise - Promise to add timeout to
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operation - Operation name for error message
 * @returns {Promise} Promise with timeout
 * @throws {TimeoutError} If operation times out
 */
export function withTimeout(promise, timeoutMs, operation = 'Operation') {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(
                () => reject(new TimeoutError(`${operation} timed out after ${timeoutMs}ms`, operation)),
                timeoutMs
            )
        )
    ]);
}

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries
 * @param {number} options.delayMs - Base delay between retries
 * @param {Array<number>} options.retryStatusCodes - HTTP status codes to retry
 * @returns {Promise} Result of successful attempt
 * @throws {Error} If all retries fail
 */
export async function withRetry(fn, options = {}) {
    const {
        maxRetries = NETWORK.MAX_RETRIES,
        delayMs = TIMEOUTS.RETRY_DELAY_BASE,
        retryStatusCodes = NETWORK.RETRY_STATUS_CODES
    } = options;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isLastAttempt = attempt === maxRetries - 1;

            // Don't retry on last attempt
            if (isLastAttempt) {
                throw error;
            }

            // Check if we should retry this error
            const shouldRetry =
                error instanceof NetworkError &&
                retryStatusCodes.includes(error.statusCode);

            if (!shouldRetry) {
                throw error;
            }

            // Exponential backoff
            const waitTime = delayMs * Math.pow(2, attempt);
            await delay(waitTime);
        }
    }
}

/**
 * Delay execution
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} Promise that resolves after delay
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout and retry
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>} Fetch response
 * @throws {TimeoutError|NetworkError} If fetch fails
 */
export async function fetchWithTimeoutAndRetry(url, options = {}, timeoutMs = TIMEOUTS.MIDI_FETCH) {
    return withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Throw on HTTP errors with retry-able status codes
            if (!response.ok && NETWORK.RETRY_STATUS_CODES.includes(response.status)) {
                throw new NetworkError(
                    `HTTP ${response.status}: ${response.statusText}`,
                    url,
                    response.status
                );
            }

            return response;
        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new TimeoutError(`Request to ${url} timed out`, 'fetch', error);
            }

            throw error;
        }
    });
}

/**
 * Run async functions sequentially with delay between each
 * @param {Array<Function>} fns - Array of async functions
 * @param {number} delayMs - Delay between functions
 * @returns {Promise<Array>} Array of results
 */
export async function runSequentially(fns, delayMs = 0) {
    const results = [];

    for (let i = 0; i < fns.length; i++) {
        results.push(await fns[i]());

        // Delay before next (except after last)
        if (i < fns.length - 1 && delayMs > 0) {
            await delay(delayMs);
        }
    }

    return results;
}

/**
 * Debounce function calls
 * @param {Function} fn - Function to debounce
 * @param {number} delayMs - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, delayMs) {
    let timeoutId;

    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delayMs);
    };
}

/**
 * Throttle function calls
 * @param {Function} fn - Function to throttle
 * @param {number} delayMs - Minimum delay between calls
 * @returns {Function} Throttled function
 */
export function throttle(fn, delayMs) {
    let lastCall = 0;

    return function(...args) {
        const now = Date.now();

        if (now - lastCall >= delayMs) {
            lastCall = now;
            return fn.apply(this, args);
        }
    };
}
