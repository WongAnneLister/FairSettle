import { describe, expect, it } from 'vitest';
import { parseDollars } from './currency';

describe('dollar input', () => {
  it('C1 accepts dollar amounts', () => {
    const rows: [string, number][] = [
      ['14.50', 1450],
      ['14.5', 1450],
      ['14', 1400],
      [' 0.99 ', 99],
      ['0', 0],
      ['0.00', 0],
      ['3.00', 300],
    ];
    for (const [text, cents] of rows) {
      expect(parseDollars(text)).toBe(cents);
    }
  });

  it('C2 refuses everything else', () => {
    for (const text of [
      '', '   ', '12.0012.00', '12.0014.50', '14.505', '14.', '.5', '-1',
      '1,000', '$14', '1e3', 'abc', '99999999999999999',
    ]) {
      expect(parseDollars(text)).toBeNull();
    }
  });
});
