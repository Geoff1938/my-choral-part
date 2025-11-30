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

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} HTML-escaped string
 */
function escapeHtml(str) {
  if (str === null || str === undefined) {
    return '';
  }
  if (typeof str !== 'string') {
    str = String(str);
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize localStorage value
 * @param {string} value - Value to sanitize
 * @param {number} maxLength - Maximum length
 * @returns {string} Sanitized value
 */
function sanitizeStorageValue(value, maxLength = 1000) {
  if (typeof value !== 'string') {
    return '';
  }

  // Remove any potential XSS attempts
  let sanitized = value
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitize display string
 * @param {string} str - String to sanitize
 * @param {number} maxLength - Maximum length
 * @returns {string} Sanitized string
 */
function sanitizeDisplayString(str, maxLength = 500) {
  if (str === null || str === undefined) {
    return '';
  }
  if (typeof str !== 'string') {
    str = String(str);
  }
  // Truncate if too long
  if (str.length > maxLength) {
    str = str.substring(0, maxLength) + '...';
  }
  return escapeHtml(str);
}

describe('HTML Escaping', () => {
  describe('escapeHtml()', () => {
    test('escapes HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    test('escapes ampersands', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    test('escapes quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
      expect(escapeHtml("it's fine")).toBe('it&#39;s fine');
    });

    test('escapes angle brackets', () => {
      expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    test('handles null and undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    test('converts non-strings to strings', () => {
      expect(escapeHtml(123)).toBe('123');
      expect(escapeHtml(true)).toBe('true');
    });

    test('handles empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });

    test('preserves normal text', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
      expect(escapeHtml('Johann Sebastian Bach')).toBe('Johann Sebastian Bach');
    });

    test('handles multiple special characters', () => {
      expect(escapeHtml('<a href="test" onclick=\'alert(1)\'>')).toBe(
        '&lt;a href=&quot;test&quot; onclick=&#39;alert(1)&#39;&gt;'
      );
    });

    test('prevents XSS attack vectors', () => {
      const attacks = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '<svg onload=alert(1)>',
        'javascript:alert(1)',
        '<a href="javascript:alert(1)">click</a>'
      ];

      attacks.forEach(attack => {
        const escaped = escapeHtml(attack);
        expect(escaped).not.toContain('<script');
        expect(escaped).not.toContain('<img');
        expect(escaped).not.toContain('<svg');
        expect(escaped).not.toContain('<a href=');
      });
    });
  });
});

describe('Storage Sanitization', () => {
  describe('sanitizeStorageValue()', () => {
    test('removes script tags', () => {
      expect(sanitizeStorageValue('hello<script>alert(1)</script>world')).toBe(
        'helloworld'
      );
    });

    test('removes javascript: protocol', () => {
      expect(sanitizeStorageValue('javascript:alert(1)')).toBe('alert(1)');
    });

    test('removes event handlers', () => {
      expect(sanitizeStorageValue('onclick=alert(1)')).toBe('alert(1)');
      expect(sanitizeStorageValue('onerror=alert(1)')).toBe('alert(1)');
    });

    test('truncates long strings', () => {
      const longString = 'a'.repeat(2000);
      expect(sanitizeStorageValue(longString, 1000).length).toBe(1000);
    });

    test('returns empty string for non-strings', () => {
      expect(sanitizeStorageValue(null)).toBe('');
      expect(sanitizeStorageValue(undefined)).toBe('');
      expect(sanitizeStorageValue(123)).toBe('');
      expect(sanitizeStorageValue({})).toBe('');
    });

    test('preserves normal text', () => {
      expect(sanitizeStorageValue('Hello World')).toBe('Hello World');
    });
  });

  describe('sanitizeDisplayString()', () => {
    test('escapes HTML and truncates', () => {
      const result = sanitizeDisplayString('<script>alert(1)</script>');
      expect(result).not.toContain('<script');
      expect(result).toContain('&lt;');
    });

    test('adds ellipsis for long strings', () => {
      const longString = 'a'.repeat(600);
      const result = sanitizeDisplayString(longString, 500);
      expect(result).toContain('...');
      expect(result.length).toBe(503); // 500 + '...'
    });

    test('handles null and undefined', () => {
      expect(sanitizeDisplayString(null)).toBe('');
      expect(sanitizeDisplayString(undefined)).toBe('');
    });
  });
});

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateMIDIUrl,
    validateVoicePart,
    ValidationError,
    escapeHtml,
    sanitizeStorageValue,
    sanitizeDisplayString
  };
}
