import { describe, expect, test } from 'bun:test';
import { fmt, fmtMoney, fmtMult, fmtTime } from './format';

describe('format', () => {
  test('scores group thousands and abbreviate huge values', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(999.6)).toBe('1,000');
    expect(fmt(123_456)).toBe('123,456');
    expect(fmt(2_500_000)).toBe('2.50M');
    expect(fmt(3_210_000_000)).toBe('3.21B');
  });

  test('mult shows fewer decimals as it grows', () => {
    expect(fmtMult(1)).toBe('1.00');
    expect(fmtMult(12.34)).toBe('12.3');
    expect(fmtMult(250.4)).toBe('250');
  });

  test('timer shows tenths only in the last 10 seconds', () => {
    expect(fmtTime(37.2)).toBe('38');
    expect(fmtTime(9.46)).toBe('9.5');
    expect(fmtTime(-1)).toBe('0.0');
  });

  test('money', () => {
    expect(fmtMoney(7)).toBe('$7');
  });
});
