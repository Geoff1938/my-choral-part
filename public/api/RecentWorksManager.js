/**
 * RecentWorksManager
 * Handles localStorage operations for recent works
 */

import { RECENT_WORKS } from '../constants.js';

export class RecentWorksManager {
    constructor() {
        this.storageKey = 'recentWorks';
        this.maxCount = RECENT_WORKS.MAX_COUNT;
    }

    /**
     * Load recent works from localStorage
     * @returns {Promise<Array>} Array of recent works
     */
    async load() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) {
                return [];
            }

            const works = JSON.parse(stored);
            return Array.isArray(works) ? works : [];
        } catch (error) {
            console.error('Error loading recent works from localStorage:', error);
            return [];
        }
    }

    /**
     * Save a recent work
     * @param {string} composer - Composer name
     * @param {string} work - Work name
     * @param {string} movement - Movement name (optional)
     * @returns {Promise<Array>} Updated array of recent works
     */
    async save(composer, work, movement = null) {
        try {
            let recent = await this.load();

            // Remove any existing entry for this work (dedup)
            recent = recent.filter(item =>
                !(item.composer === composer && item.work === work)
            );

            // Add to the beginning
            const entry = { composer, work };
            if (movement) {
                entry.movement = movement;
            }
            recent.unshift(entry);

            // Limit to max count
            if (recent.length > this.maxCount) {
                recent = recent.slice(0, this.maxCount);
            }

            // Save to localStorage
            localStorage.setItem(this.storageKey, JSON.stringify(recent));

            return recent;
        } catch (error) {
            console.error('Error saving recent work to localStorage:', error);
            return [];
        }
    }

    /**
     * Clear all recent works
     * @returns {Promise<void>}
     */
    async clear() {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (error) {
            console.error('Error clearing recent works:', error);
        }
    }
}
