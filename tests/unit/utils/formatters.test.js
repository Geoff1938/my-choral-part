/**
 * Unit tests for public/utils/formatters.js
 */

const {
  formatTime,
  volumePercentToDb,
  formatWorkTitle,
  formatFileSize,
  formatTempo,
  truncate
} = require('../../../public/utils/formatters.js');

describe('Time Formatting', () => {
  describe('formatTime()', () => {
    test('formats zero seconds', () => {
      expect(formatTime(0)).toBe('0:00');
    });

    test('formats seconds less than a minute', () => {
      expect(formatTime(30)).toBe('0:30');
      expect(formatTime(59)).toBe('0:59');
    });

    test('formats exactly one minute', () => {
      expect(formatTime(60)).toBe('1:00');
    });

    test('formats minutes and seconds', () => {
      expect(formatTime(65)).toBe('1:05');
      expect(formatTime(125)).toBe('2:05');
      expect(formatTime(3661)).toBe('61:01');
    });

    test('pads single-digit seconds with zero', () => {
      expect(formatTime(61)).toBe('1:01');
      expect(formatTime(605)).toBe('10:05');
    });

    test('truncates fractional seconds', () => {
      expect(formatTime(65.9)).toBe('1:05');
    });

    test('handles negative times', () => {
      expect(formatTime(-5)).toBe('0:00');
      expect(formatTime(-100)).toBe('0:00');
    });

    test('handles NaN', () => {
      expect(formatTime(NaN)).toBe('0:00');
    });

    test('handles undefined', () => {
      expect(formatTime(undefined)).toBe('0:00');
    });

    test('handles null', () => {
      expect(formatTime(null)).toBe('0:00');
    });

    test('handles very large times', () => {
      expect(formatTime(3600)).toBe('60:00'); // 1 hour
      expect(formatTime(7200)).toBe('120:00'); // 2 hours
    });
  });
});

describe('Volume Conversion', () => {
  describe('volumePercentToDb()', () => {
    test('0% is silent', () => {
      expect(volumePercentToDb(0)).toBe(-Infinity);
    });

    test('100% is the -10 dB default', () => {
      expect(volumePercentToDb(100)).toBe(-10);
    });

    test('200% is +10 dB', () => {
      expect(volumePercentToDb(200)).toBe(10);
    });

    test('maps 0-100% linearly between -60 dB and -10 dB', () => {
      expect(volumePercentToDb(50)).toBe(-35);
      expect(volumePercentToDb(10)).toBe(-55);
    });

    test('maps 100-200% linearly between -10 dB and +10 dB', () => {
      expect(volumePercentToDb(150)).toBe(0);
    });
  });
});

describe('Display Formatting', () => {
  describe('formatWorkTitle()', () => {
    test('joins composer and work', () => {
      expect(formatWorkTitle('Bach', 'Mass in B Minor')).toBe('Bach, Mass in B Minor');
    });

    test('appends movement when given', () => {
      expect(formatWorkTitle('Handel', 'Messiah', 'Hallelujah')).toBe('Handel, Messiah - Hallelujah');
    });
  });

  describe('formatFileSize()', () => {
    test('formats zero bytes', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
    });

    test('formats bytes, KB and MB', () => {
      expect(formatFileSize(500)).toBe('500 Bytes');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });
  });

  describe('formatTempo()', () => {
    test('formats multiplier as a rounded percentage', () => {
      expect(formatTempo(1)).toBe('100%');
      expect(formatTempo(0.75)).toBe('75%');
      expect(formatTempo(0.333)).toBe('33%');
    });
  });

  describe('truncate()', () => {
    test('returns short text unchanged', () => {
      expect(truncate('Gloria', 10)).toBe('Gloria');
    });

    test('truncates long text including the suffix in the length', () => {
      expect(truncate('Magnificat in D', 10)).toBe('Magnifi...');
    });

    test('supports a custom suffix', () => {
      expect(truncate('Magnificat in D', 10, '~')).toBe('Magnifica~');
    });

    test('returns falsy input unchanged', () => {
      expect(truncate('', 5)).toBe('');
      expect(truncate(null, 5)).toBeNull();
    });
  });
});
