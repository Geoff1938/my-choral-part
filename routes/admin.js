/**
 * Admin Routes
 * Protected dashboard for viewing activity logs and statistics
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const {
    getActivitySummary,
    getActivitiesForExport,
    getDateRanges
} = require('../utils/database');
const { getLastRebuildStatus, runIndexRebuild, isRebuildRunning } = require('../utils/scheduler');

/**
 * Format a value as a CSV field. Values starting with = + - @ (or a tab or
 * carriage return) get a leading apostrophe so a spreadsheet does not run
 * them as formulas - composer and work names come from the public
 * activity endpoint.
 * @param {*} value - Field value
 * @returns {string} CSV-safe field
 */
function csvField(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) {
        text = `'${text}`;
    }
    if (/[",\r\n]/.test(text)) {
        text = `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/**
 * GET /admin
 * Serve the admin dashboard HTML
 */
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

/**
 * GET /admin/api/summary
 * Get activity summary for all time periods
 */
router.get('/api/summary', async (req, res, next) => {
    try {
        const ranges = getDateRanges();

        const [last24Hours, weekToDate, monthToDate] = await Promise.all([
            getActivitySummary(ranges.last24Hours.start, ranges.last24Hours.end),
            getActivitySummary(ranges.weekToDate.start, ranges.weekToDate.end),
            getActivitySummary(ranges.monthToDate.start, ranges.monthToDate.end)
        ]);

        res.json({
            last24Hours,
            weekToDate,
            monthToDate,
            generatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Admin] Error getting summary:', error.message);
        next(error);
    }
});

/**
 * GET /admin/api/export
 * Export activities as a CSV file
 * Query params:
 *   start: ISO date string (required)
 *   end: ISO date string (required)
 */
router.get('/api/export', async (req, res, next) => {
    try {
        const { start, end } = req.query;

        if (!start || !end) {
            return res.status(400).json({ error: 'Missing start and/or end date parameters' });
        }

        const startDate = new Date(start);
        const endDate = new Date(end);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        const activities = await getActivitiesForExport(startDate, endDate);

        const rows = [
            ['Timestamp', 'Device ID', 'Event Type', 'Composer', 'Work', 'Movement', 'User Agent', 'Duration (s)']
        ];

        activities.forEach(activity => {
            rows.push([
                activity.timestamp,
                activity.deviceId,
                activity.eventType,
                activity.composer || '',
                activity.work || '',
                activity.movement || '',
                activity.userAgent || '',
                activity.durationSeconds ?? ''
            ]);
        });

        // The byte order mark makes Excel read the file as UTF-8
        const csv = '﻿' + rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';

        // Set headers for file download
        const filename = `activity-export-${startDate.toISOString().slice(0, 10)}-to-${endDate.toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('[Admin] Error exporting activities:', error.message);
        next(error);
    }
});

/**
 * GET /admin/api/index-status
 * Get the status of the last index rebuild
 */
router.get('/api/index-status', async (req, res, next) => {
    try {
        const status = await getLastRebuildStatus();
        res.json({
            lastRebuild: status,
            scheduledTime: '02:00 (Europe/London)'
        });
    } catch (error) {
        console.error('[Admin] Error getting index status:', error.message);
        next(error);
    }
});

/**
 * POST /admin/api/rebuild-index
 * Manually trigger an index rebuild
 */
router.post('/api/rebuild-index', async (req, res, next) => {
    try {
        console.log('[Admin] Manual index rebuild requested');

        if (isRebuildRunning()) {
            return res.status(409).json({ error: 'An index rebuild is already running' });
        }

        // Run rebuild in background and respond immediately
        res.json({
            message: 'Index rebuild started',
            startedAt: new Date().toISOString()
        });

        // Run the rebuild after responding
        runIndexRebuild().catch(err => {
            console.error('[Admin] Background rebuild failed:', err.message);
        });
    } catch (error) {
        console.error('[Admin] Error starting rebuild:', error.message);
        next(error);
    }
});

module.exports = router;
