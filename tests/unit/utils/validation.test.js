// Example unit test - Input validation utilities

class ValidationError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ValidationError';
    this.cause = cause;
  }
}

/**
 * Validate MIDI URL
 * @param {string} url
 * @throws {ValidationError}
 */
function validateMIDIUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new ValidationError('URL must be a non-empty string');
  }

  try {
    const parsed = new URL(url);

    // Check protocol
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError('URL must use HTTP or HTTPS protocol');
    }

    // Reject HTML files first (before checking for MIDI)
    if (url.endsWith('.html') || url.endsWith('.htm')) {
      throw new ValidationError('Copyright-protected work (HTML file)');
    }

    // Check if it looks like a MIDI file or is from the expected domain
    const isMidiFile = /\.(mid|midi)$/i.test(url);
    const isChoralMusicSite = url.includes('learnchoralmusic.co.uk');

    if (!isMidiFile && !isChoralMusicSite) {
      throw new ValidationError('URL must be a MIDI file (.mid or .midi)');
    }

    return true;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Invalid URL format', error);
  }
}

/**
 * Validate voice part
 * @param {string} part
 * @throws {ValidationError}
 */
function validateVoicePart(part) {
  const validParts = ['soprano', 'alto', 'tenor', 'bass'];

  if (!part || typeof part !== 'string') {
    throw new ValidationError('Voice part must be a non-empty string');
  }

  const normalizedPart = part.toLowerCase();

  if (!validParts.includes(normalizedPart)) {
    throw new ValidationError(
      `Voice part must be one of: ${validParts.join(', ')}`
    );
  }

  return normalizedPart;
}

// Tests
describe('URL Validation', () => {
  describe('validateMIDIUrl()', () => {
    test('accepts valid MIDI URLs with .mid extension', () => {
      const validUrls = [
        'https://example.com/file.mid',
        'http://example.com/file.mid',
        'https://www.learnchoralmusic.co.uk/Bach/Mass.mid'
      ];

      validUrls.forEach(url => {
        expect(() => validateMIDIUrl(url)).not.toThrow();
      });
    });

    test('accepts valid MIDI URLs with .midi extension', () => {
      const validUrls = [
        'https://example.com/file.midi',
        'http://example.com/file.MIDI'
      ];

      validUrls.forEach(url => {
        expect(() => validateMIDIUrl(url)).not.toThrow();
      });
    });

    test('accepts learnchoralmusic.co.uk URLs without explicit extension', () => {
      expect(() =>
        validateMIDIUrl('https://www.learnchoralmusic.co.uk/Handel/Messiah/01')
      ).not.toThrow();
    });

    test('rejects non-URL strings', () => {
      expect(() => validateMIDIUrl('not-a-url')).toThrow(ValidationError);
      expect(() => validateMIDIUrl('just-a-file.mid')).toThrow(ValidationError);
    });

    test('rejects invalid protocols', () => {
      expect(() => validateMIDIUrl('ftp://example.com/file.mid')).toThrow(ValidationError);
      expect(() => validateMIDIUrl('javascript:alert(1)')).toThrow(ValidationError);
      expect(() => validateMIDIUrl('file:///local/file.mid')).toThrow(ValidationError);
    });

    test('rejects HTML files (copyright protection)', () => {
      expect(() =>
        validateMIDIUrl('https://example.com/file.html')
      ).toThrow(/copyright/i);

      expect(() =>
        validateMIDIUrl('https://example.com/file.htm')
      ).toThrow(/copyright/i);
    });

    test('rejects non-MIDI files', () => {
      expect(() => validateMIDIUrl('https://example.com/file.mp3')).toThrow(ValidationError);
      expect(() => validateMIDIUrl('https://example.com/file.pdf')).toThrow(ValidationError);
    });

    test('rejects empty strings', () => {
      expect(() => validateMIDIUrl('')).toThrow(ValidationError);
    });

    test('rejects null and undefined', () => {
      expect(() => validateMIDIUrl(null)).toThrow(ValidationError);
      expect(() => validateMIDIUrl(undefined)).toThrow(ValidationError);
    });

    test('rejects non-string types', () => {
      expect(() => validateMIDIUrl(123)).toThrow(ValidationError);
      expect(() => validateMIDIUrl({})).toThrow(ValidationError);
      expect(() => validateMIDIUrl([])).toThrow(ValidationError);
    });
  });
});

describe('Voice Part Validation', () => {
  describe('validateVoicePart()', () => {
    test('accepts valid voice parts', () => {
      const validParts = ['soprano', 'alto', 'tenor', 'bass'];

      validParts.forEach(part => {
        expect(() => validateVoicePart(part)).not.toThrow();
        expect(validateVoicePart(part)).toBe(part);
      });
    });

    test('normalizes to lowercase', () => {
      expect(validateVoicePart('SOPRANO')).toBe('soprano');
      expect(validateVoicePart('Alto')).toBe('alto');
      expect(validateVoicePart('TenOR')).toBe('tenor');
    });

    test('rejects invalid voice parts', () => {
      expect(() => validateVoicePart('baritone')).toThrow(ValidationError);
      expect(() => validateVoicePart('mezzo-soprano')).toThrow(ValidationError);
      expect(() => validateVoicePart('countertenor')).toThrow(ValidationError);
    });

    test('rejects empty strings', () => {
      expect(() => validateVoicePart('')).toThrow(ValidationError);
    });

    test('rejects null and undefined', () => {
      expect(() => validateVoicePart(null)).toThrow(ValidationError);
      expect(() => validateVoicePart(undefined)).toThrow(ValidationError);
    });

    test('rejects non-string types', () => {
      expect(() => validateVoicePart(123)).toThrow(ValidationError);
      expect(() => validateVoicePart({})).toThrow(ValidationError);
    });
  });
});

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateMIDIUrl, validateVoicePart, ValidationError };
}
