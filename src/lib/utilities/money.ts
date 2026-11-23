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
