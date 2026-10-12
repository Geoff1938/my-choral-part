/**
 * Activity Logging Routes
 * Handles logging of user activity (downloads, rehearsal sessions)
 */

const express = require('express');
const router = express.Router();
const { logActivity } = require('../utils/database');

// Longest accepted deviceId, composer, work or movement
const MAX_FIELD_LENGTH = 200;

/**
 * Whether a value is a string no longer than MAX_FIELD_LENGTH
 * @param {*} value - Value to check
 * @returns {boolean}
 */
function isShortString(value) {
    return typeof value === 'string' && value.length <= MAX_FIELD_LENGTH;
}

/**
 * POST /api/activity/log
 * Log a user activity event
 *
 * Body: {
 *   deviceId: string,
 *   eventType: 'download' | 'rehearsal_start' | 'rehearsal_time' | 'rehearsal_heartbeat',
 *   composer: string (optional),
 *   work: string (optional),
 *   movement: string (optional),
 *   durationSeconds: number (required for rehearsal_time - seconds of playing time)
 * }
 *
 * rehearsal_heartbeat is the old 10-minute heartbeat, still accepted from
 * pages loaded before the rehearsal_time change.
 */
router.post('/log', async (req, res, next) => {
    try {
        const { deviceId, eventType, composer, work, movement, durationSeconds } = req.body;

        // Validate required fields
        if (!deviceId || !eventType) {
            return res.status(400).json({ error: 'Missing required fields: deviceId and eventType' });
        }

        // Text fields must be short strings (optional ones may be omitted or null)
        if (!isShortString(deviceId) ||
            ![composer, work, movement].every(value => value == null || isShortString(value))) {
            return res.status(400).json({ error: 'Invalid field value' });
        }

        // Validate event type
        const validEventTypes = ['download', 'rehearsal_start', 'rehearsal_time', 'rehearsal_heartbeat'];
        if (!validEventTypes.includes(eventType)) {
            return res.status(400).json({ error: 'Invalid eventType' });
        }

        // rehearsal_time must carry a sensible duration (at most one hour per report)
        let duration = null;
        if (eventType === 'rehearsal_time') {
            duration = Math.round(Number(durationSeconds));
            if (!Number.isFinite(duration) || duration < 1 || duration > 3600) {
                return res.status(400).json({ error: 'Invalid durationSeconds' });
            }
        }

        // Get client info (IP addresses are deliberately not stored - see the privacy notice)
        const userAgent = (req.headers['user-agent'] || 'Unknown').slice(0, 500);

        // Log the activity
        await logActivity(
            deviceId,
            eventType,
            composer || null,
            work || null,
            movement || null,
            userAgent,
            null,
            duration
        );

        res.json({ success: true });
    } catch (error) {
        console.error('[Activity] Error logging activity:', error.message);
        next(error);
    }
});

module.exports = router;
