/**
 * Unit tests for StatusManager
 */

const { StatusManager } = require('../../../public/ui/StatusManager.js');

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

        // Success messages schedule an auto-hide timer
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
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

        test('auto-hides success messages after 3 seconds', () => {
            statusManager.show('Success!', 'success');

            expect(statusElement.classList.remove).not.toHaveBeenCalled();

            jest.advanceTimersByTime(3000);

            expect(statusElement.classList.remove).toHaveBeenCalledWith('show');
        });

        test('does not auto-hide info messages', () => {
            statusManager.show('Info message', 'info');

            jest.advanceTimersByTime(5000);

            expect(statusElement.classList.remove).not.toHaveBeenCalled();
        });

        test('does not auto-hide error messages', () => {
            statusManager.show('Error message', 'error');

            jest.advanceTimersByTime(5000);

            expect(statusElement.classList.remove).not.toHaveBeenCalled();
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

    describe('hide()', () => {
        test('removes the show class but keeps the message', () => {
            statusManager.show('Test message', 'error');
            statusManager.hide();

            expect(statusElement.classList.remove).toHaveBeenCalledWith('show');
            expect(statusElement.textContent).toBe('Test message');
        });

        test('handles null statusElement gracefully', () => {
            const nullManager = new StatusManager(null);

            expect(() => nullManager.hide()).not.toThrow();
        });
    });
});
