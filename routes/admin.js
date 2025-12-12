/**
 * Admin Routes
 * Protected dashboard for viewing activity logs and statistics
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const XLSX = require('xlsx');
const {
    getActivitySummary,
    getActivitiesForExport,
    getDateRanges
} = require('../utils/database');
const { getLastRebuildStatus, runIndexRebuild } = require('../utils/scheduler');

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
 * Export activities as XLSX file
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

        // Create workbook
        const wb = XLSX.utils.book_new();

        // Convert activities to worksheet
        const wsData = [
            ['Timestamp', 'Device ID', 'Event Type', 'Composer', 'Work', 'Movement', 'IP Address', 'User Agent']
        ];

        activities.forEach(activity => {
            wsData.push([
                activity.timestamp,
                activity.deviceId,
                activity.eventType,
                activity.composer || '',
                activity.work || '',
                activity.movement || '',
                activity.ipAddress || '',
                activity.userAgent || ''
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Auto-size columns
        const colWidths = [
            { wch: 20 }, // Timestamp
            { wch: 40 }, // Device ID
            { wch: 18 }, // Event Type
            { wch: 25 }, // Composer
            { wch: 35 }, // Work
            { wch: 30 }, // Movement
            { wch: 15 }, // IP Address
            { wch: 50 }  // User Agent
        ];
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Activities');

        // Generate buffer
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Set headers for file download
        const filename = `activity-export-${start.slice(0, 10)}-to-${end.slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
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
