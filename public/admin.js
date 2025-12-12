/**
 * Admin Dashboard JavaScript
 * Handles fetching and displaying activity data
 */

// Initialize dashboard on load
document.addEventListener('DOMContentLoaded', () => {
    initializeDatePickers();
    refreshData();
    setupExportForm();
});

/**
 * Initialize date pickers with sensible defaults
 */
function initializeDatePickers() {
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    document.getElementById('start-date').value = formatDateForInput(lastMonth);
    document.getElementById('end-date').value = formatDateForInput(today);
}

/**
 * Format date for input[type=date]
 */
function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
}

/**
 * Refresh dashboard data
 */
async function refreshData() {
    const loading = document.getElementById('loading');
    const content = document.getElementById('content');
    const errorContainer = document.getElementById('error-container');

    loading.style.display = 'block';
    content.style.display = 'none';
    errorContainer.innerHTML = '';

    try {
        const response = await fetch('/admin/api/summary');

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();
        displaySummary(data);

        loading.style.display = 'none';
        content.style.display = 'block';
    } catch (error) {
        loading.style.display = 'none';
        errorContainer.innerHTML = `<div class="error">Error loading data: ${error.message}</div>`;
        content.style.display = 'block';
    }
}

/**
 * Display summary data in the dashboard
 */
function displaySummary(data) {
    // Last 24 Hours
    displayPeriodData('24h', data.last24Hours);

    // Week to Date
    displayPeriodData('week', data.weekToDate);

    // Month to Date
    displayPeriodData('month', data.monthToDate);

    // Update generated timestamp
    document.getElementById('generated-at').textContent = new Date(data.generatedAt).toLocaleString();
}

/**
 * Display data for a specific time period
 */
function displayPeriodData(suffix, periodData) {
    // Count downloads and rehearsals
    let downloads = 0;
    let rehearsals = 0;

    periodData.eventCounts.forEach(ec => {
        if (ec.eventType === 'download') {
            downloads = ec.count;
        } else if (ec.eventType === 'rehearsal_start') {
            rehearsals = ec.count;
        }
    });

    document.getElementById(`downloads-${suffix}`).textContent = downloads;
    document.getElementById(`rehearsals-${suffix}`).textContent = rehearsals;
    document.getElementById(`devices-${suffix}`).textContent = periodData.uniqueDevices;

    // Top works
    const topWorksList = document.getElementById(`top-works-${suffix}`);
    if (periodData.topWorks.length === 0) {
        topWorksList.innerHTML = '<li>No data</li>';
    } else {
        topWorksList.innerHTML = periodData.topWorks.map(work => `
            <li>
                <span class="work-name" title="${escapeHtml(work.composer)} - ${escapeHtml(work.work)}">
                    ${escapeHtml(work.composer)} - ${escapeHtml(work.work)}
                </span>
                <span class="work-count">${work.count}</span>
            </li>
        `).join('');
    }
}

/**
 * Setup export form handler
 */
function setupExportForm() {
    const form = document.getElementById('export-form');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;

        if (!startDate || !endDate) {
            alert('Please select both start and end dates');
            return;
        }

        // Create start of day and end of day timestamps
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Trigger download
        const url = `/admin/api/export?start=${start.toISOString()}&end=${end.toISOString()}`;
        console.log('[Admin] Downloading export from:', url);
        window.location.href = url;
    });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
