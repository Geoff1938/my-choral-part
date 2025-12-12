/**
 * Activity Logging Routes
 * Handles logging of user activity (downloads, rehearsal sessions)
 */

const express = require('express');
const router = express.Router();
const { logActivity } = require('../utils/database');

/**
 * POST /api/activity/log
 * Log a user activity event
 *
 * Body: {
 *   deviceId: string,
 *   eventType: 'download' | 'rehearsal_start' | 'rehearsal_heartbeat',
 *   composer: string (optional),
 *   work: string (optional),
 *   movement: string (optional)
 * }
 */
router.post('/log', async (req, res, next) => {
    try {
        const { deviceId, eventType, composer, work, movement } = req.body;

        // Validate required fields
        if (!deviceId || !eventType) {
            return res.status(400).json({ error: 'Missing required fields: deviceId and eventType' });
        }

        // Validate event type
        const validEventTypes = ['download', 'rehearsal_start', 'rehearsal_heartbeat'];
        if (!validEventTypes.includes(eventType)) {
            return res.status(400).json({ error: 'Invalid eventType' });
        }

        // Get client info
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const ipAddress = req.ip || req.connection.remoteAddress || 'Unknown';

        // Log the activity
        await logActivity(
            deviceId,
            eventType,
            composer || null,
            work || null,
            movement || null,
            userAgent,
            ipAddress
        );

        res.json({ success: true });
    } catch (error) {
        console.error('[Activity] Error logging activity:', error.message);
        next(error);
    }
});

module.exports = router;
