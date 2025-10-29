/**
 * Custom Error Classes
 * Specific error types for better error handling and user feedback
 */

/**
 * Base application error
 */
export class AppError extends Error {
    constructor(message, cause = null) {
        super(message);
        this.name = this.constructor.name;
        this.cause = cause;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * MIDI file loading errors
 */
export class MIDILoadError extends AppError {
    constructor(message, url = null, cause = null) {
        super(message, cause);
        this.url = url;
    }
}

/**
 * Instrument loading errors
 */
export class InstrumentLoadError extends AppError {
    constructor(instrumentName, cause = null) {
        super(`Failed to load instrument: ${instrumentName}`, cause);
        this.instrumentName = instrumentName;
    }
}

/**
 * Memory/resource errors
 */
export class MemoryError extends AppError {
    constructor(message = 'Insufficient memory', cause = null) {
        super(message, cause);
    }

    static isMemoryError(error) {
        if (error instanceof MemoryError) return true;

        const message = error.message?.toLowerCase() || '';
        const name = error.name?.toLowerCase() || '';

        return (
            name === 'quotaexceedederror' ||
            name === 'rangeerror' ||
            message.includes('memory') ||
            message.includes('allocation') ||
            message.includes('quota')
        );
    }
}

/**
 * Validation errors
 */
export class ValidationError extends AppError {
    constructor(message, field = null, cause = null) {
        super(message, cause);
        this.field = field;
    }
}

/**
 * Network/fetch errors
 */
export class NetworkError extends AppError {
    constructor(message, url = null, statusCode = null, cause = null) {
        super(message, cause);
        this.url = url;
        this.statusCode = statusCode;
    }
}

/**
 * Copyright-protected work error
 */
export class CopyrightError extends AppError {
    constructor(message = 'This work is not publicly available for copyright reasons') {
        super(message);
    }
}

/**
 * Timeout errors
 */
export class TimeoutError extends AppError {
    constructor(message = 'Request timed out', operation = null, cause = null) {
        super(message, cause);
        this.operation = operation;
    }
}

/**
 * Audio playback errors
 */
export class PlaybackError extends AppError {
    constructor(message, cause = null) {
        super(message, cause);
    }
}
