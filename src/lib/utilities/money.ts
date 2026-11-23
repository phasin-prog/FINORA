import Decimal from 'decimal.js';

// Configure high-precision decimal arithmetic (matches PostgreSQL NUMERIC(19,4))
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
});

export type MoneyInput = string | number | Decimal;

export function toDecimal(value: MoneyInput): Decimal {
  if (value instanceof Decimal) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid monetary number: ${value}`);
    }
    return new Decimal(value.toString());
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Monetary value cannot be empty');
  }
  return new Decimal(trimmed);
}

export function toNumericString(value: MoneyInput, scale = 4): string {
  return toDecimal(value).toFixed(scale);
}

export function assertPositiveAmount(value: MoneyInput): Decimal {
  const dec = toDecimal(value);
  if (!dec.isFinite() || dec.lte(0)) {
    throw new Error(`Amount must be greater than zero (received ${dec.toString()})`);
  }
  return dec;
}

export function sumDecimals(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, val) => acc.plus(toDecimal(val)), new Decimal(0));
}

export function formatTHB(
  value: MoneyInput,
  options?: { showSign?: boolean; minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  const dec = toDecimal(value);
  const minFrac = options?.minimumFractionDigits ?? 2;
  const maxFrac = options?.maximumFractionDigits ?? 2;
  const absFormatted = new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  }).format(dec.abs().toNumber());

  if (dec.isNegative()) {
    return `-฿${absFormatted}`;
  }
  if (options?.showSign && dec.gt(0)) {
    return `+฿${absFormatted}`;
  }
  return `฿${absFormatted}`;
}

/**
 * Sanitizes user input in monetary fields so only digits and a single decimal
 * point (up to 4 decimal places) are accepted at keystroke time.
 */
export function sanitizeMoneyInput(raw: string, allowNegative = false): string {
  const isNeg = allowNegative && raw.trimStart().startsWith('-');
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const dotIdx = cleaned.indexOf('.');
  let normalized = cleaned;
  if (dotIdx !== -1) {
    const intPart = cleaned.slice(0, dotIdx);
    const fracPart = cleaned.slice(dotIdx + 1).replace(/\./g, '').slice(0, 4);
    normalized = `${intPart}.${fracPart}`;
  }
  return isNeg ? `-${normalized}` : normalized;
}

export function formatFriendlyError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as { issues?: Array<{ message?: string }> }).issues;
    if (Array.isArray(issues) && issues[0]?.message) {
      return issues[0].message;
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}
