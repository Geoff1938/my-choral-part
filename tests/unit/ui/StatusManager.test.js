/**
 * Unit tests for StatusManager
 */

// Copy of StatusManager class for testing
class StatusManager {
    constructor(statusElement) {
        this.statusElement = statusElement;
    }

    show(message, type = 'info') {
        if (!this.statusElement) return;

        this.statusElement.textContent = message;
        this.statusElement.className = `status-message show ${type}`;

        if (type === 'success') {
            setTimeout(() => {
                this.statusElement.classList.remove('show');
            }, 3000);
        }
    }

    info(message) {
        this.show(message, 'info');
    }

    error(message) {
        this.show(message, 'error');
    }

    success(message) {
        this.show(message, 'success');
    }

    warning(message) {
        this.show(message, 'warning');
    }

    clear() {
        if (!this.statusElement) return;
        this.statusElement.textContent = '';
        this.statusElement.className = 'status';
    }
}

describe('StatusManager', () => {
    let statusElement;
    let statusManager;

    beforeEach(() => {
        // Create a mock DOM element
        statusElement = {
            textContent: '',
            className: '',
            classList: {
                remove: jest.fn()
            }
        };
        statusManager = new StatusManager(statusElement);
    });

    describe('constructor', () => {
        test('initializes with status element', () => {
            expect(statusManager.statusElement).toBe(statusElement);
        });
    });

    describe('show()', () => {
        test('displays info message', () => {
            statusManager.show('Test message', 'info');

            expect(statusElement.textContent).toBe('Test message');
            expect(statusElement.className).toBe('status-message show info');
        });

        test('displays error message', () => {
            statusManager.show('Error occurred', 'error');

            expect(statusElement.textContent).toBe('Error occurred');
            expect(statusElement.className).toBe('status-message show error');
        });

        test('displays success message', () => {
            statusManager.show('Success!', 'success');

            expect(statusElement.textContent).toBe('Success!');
            expect(statusElement.className).toBe('status-message show success');
        });

        test('displays warning message', () => {
            statusManager.show('Warning!', 'warning');

            expect(statusElement.textContent).toBe('Warning!');
            expect(statusElement.className).toBe('status-message show warning');
        });

        test('defaults to info type when no type specified', () => {
            statusManager.show('Default message');

            expect(statusElement.className).toBe('status-message show info');
        });

        test('auto-hides success messages after 3 seconds', (done) => {
            jest.useFakeTimers();

            statusManager.show('Success!', 'success');

            expect(statusElement.classList.remove).not.toHaveBeenCalled();

            jest.advanceTimersByTime(3000);

            expect(statusElement.classList.remove).toHaveBeenCalledWith('show');

            jest.useRealTimers();
            done();
        });

        test('does not auto-hide info messages', (done) => {
            jest.useFakeTimers();

            statusManager.show('Info message', 'info');

            jest.advanceTimersByTime(5000);

            expect(statusElement.classList.remove).not.toHaveBeenCalled();

            jest.useRealTimers();
            done();
        });

        test('does not auto-hide error messages', (done) => {
            jest.useFakeTimers();

            statusManager.show('Error message', 'error');

            jest.advanceTimersByTime(5000);

            expect(statusElement.classList.remove).not.toHaveBeenCalled();

            jest.useRealTimers();
            done();
        });

        test('handles null statusElement gracefully', () => {
            const nullManager = new StatusManager(null);

            expect(() => nullManager.show('Test')).not.toThrow();
        });

        test('handles undefined statusElement gracefully', () => {
            const undefinedManager = new StatusManager(undefined);

            expect(() => undefinedManager.show('Test')).not.toThrow();
        });
    });

    describe('info()', () => {
        test('displays info message using convenience method', () => {
            statusManager.info('Info message');

            expect(statusElement.textContent).toBe('Info message');
            expect(statusElement.className).toBe('status-message show info');
        });
    });

    describe('error()', () => {
        test('displays error message using convenience method', () => {
            statusManager.error('Error message');

            expect(statusElement.textContent).toBe('Error message');
            expect(statusElement.className).toBe('status-message show error');
        });
    });

    describe('success()', () => {
        test('displays success message using convenience method', () => {
            statusManager.success('Success message');

            expect(statusElement.textContent).toBe('Success message');
            expect(statusElement.className).toBe('status-message show success');
        });
    });

    describe('warning()', () => {
        test('displays warning message using convenience method', () => {
            statusManager.warning('Warning message');

            expect(statusElement.textContent).toBe('Warning message');
            expect(statusElement.className).toBe('status-message show warning');
        });
    });

    describe('clear()', () => {
        test('clears status message text', () => {
            statusManager.show('Test message');
            statusManager.clear();

            expect(statusElement.textContent).toBe('');
        });

        test('resets className to default', () => {
            statusManager.show('Test message', 'error');
            statusManager.clear();

            expect(statusElement.className).toBe('status');
        });

        test('handles null statusElement gracefully', () => {
            const nullManager = new StatusManager(null);

            expect(() => nullManager.clear()).not.toThrow();
        });
    });
});
