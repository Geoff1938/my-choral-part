/**
 * StatusManager
 * Handles displaying status messages to the user
 */

export class StatusManager {
    /**
     * @param {HTMLElement} statusElement - DOM element for status messages
     */
    constructor(statusElement) {
        this.statusElement = statusElement;
    }

    /**
     * Show a status message
     * @param {string} message - Message to display
     * @param {string} type - Message type: 'info', 'error', 'success', 'warning'
     */
    show(message, type = 'info') {
        if (!this.statusElement) return;

        this.statusElement.textContent = message;
        this.statusElement.className = `status ${type}`;

        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => this.clear(), 5000);
        }
    }

    /**
     * Show an info message
     * @param {string} message - Message to display
     */
    info(message) {
        this.show(message, 'info');
    }

    /**
     * Show an error message
     * @param {string} message - Message to display
     */
    error(message) {
        this.show(message, 'error');
    }

    /**
     * Show a success message
     * @param {string} message - Message to display
     */
    success(message) {
        this.show(message, 'success');
    }

    /**
     * Show a warning message
     * @param {string} message - Message to display
     */
    warning(message) {
        this.show(message, 'warning');
    }

    /**
     * Clear the status message
     */
    clear() {
        if (!this.statusElement) return;
        this.statusElement.textContent = '';
        this.statusElement.className = 'status';
    }
}
