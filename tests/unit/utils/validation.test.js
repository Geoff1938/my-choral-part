/**
 * Unit tests for public/utils/validation.js
 */

const {
  escapeHtml,
  escapeHtmlAttribute,
  sanitizeDisplayString
} = require('../../../public/utils/validation.js');

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

  describe('escapeHtmlAttribute()', () => {
    test('escapes JSON so it is safe inside a quoted attribute value', () => {
      const json = JSON.stringify({ composer: "O'Brien", work: '<Mass>' });
      expect(escapeHtmlAttribute(json)).toBe(
        '{&quot;composer&quot;:&quot;O&#39;Brien&quot;,&quot;work&quot;:&quot;&lt;Mass&gt;&quot;}'
      );
    });

    test('handles null and undefined', () => {
      expect(escapeHtmlAttribute(null)).toBe('');
      expect(escapeHtmlAttribute(undefined)).toBe('');
    });
  });
});

describe('Display Sanitization', () => {
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

    test('does not truncate strings at the limit', () => {
      const exact = 'a'.repeat(500);
      expect(sanitizeDisplayString(exact)).toBe(exact);
    });

    test('handles null and undefined', () => {
      expect(sanitizeDisplayString(null)).toBe('');
      expect(sanitizeDisplayString(undefined)).toBe('');
    });

    test('converts non-strings to strings', () => {
      expect(sanitizeDisplayString(42)).toBe('42');
    });
  });
});
