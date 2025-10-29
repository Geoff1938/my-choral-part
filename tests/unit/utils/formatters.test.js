// Example unit test - Time formatting utilities

/**
 * Format seconds as MM:SS
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0 || seconds === undefined) {
    return '0:00';
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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

// Export for use in main app (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatTime };
}
