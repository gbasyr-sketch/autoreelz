import Decimal from 'decimal.js';

// All values and arithmetic are in rubles, never binary floating point.
const Money = Decimal.clone({precision: 40, rounding: Decimal.ROUND_HALF_UP});
export type Rubles = string;
export const MAX_RUBLES = '90071992547409.91';

function checked(value: Decimal): Rubles {
  if (!value.isFinite() || value.isNegative() || value.gt(MAX_RUBLES)) throw new RangeError('Сумма вне допустимого диапазона');
  return value.toFixed(2);
}

export function rubles(value: unknown): Rubles {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new RangeError('Укажите сумму в рублях, не более двух знаков после запятой');
  }
  return checked(new Money(value));
}
export function sumRubles(values: Iterable<Rubles>): Rubles {
  let sum = new Money(0);
  for (const value of values) sum = sum.plus(rubles(value));
  return checked(sum);
}
export function multiplyRubles(value: Rubles, quantity: number): Rubles {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError('Некорректное количество');
  return checked(new Money(rubles(value)).times(quantity));
}
export function discountRubles(value: Rubles, basisPoints: number): Rubles {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) throw new RangeError('Некорректная скидка');
  return checked(new Money(rubles(value)).times(new Money(10000).minus(basisPoints)).div(10000).toDecimalPlaces(2));
}
export function compareRubles(a: Rubles, b: Rubles): number {
  return new Money(rubles(a)).cmp(rubles(b));
}
export function parseRublesInput(value: string): Rubles {
  const input = value.trim().replace(/\s*₽$/, '').trim();
  if (!/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d{1,2})?$/.test(input)) throw new RangeError('Укажите сумму в рублях, не более двух знаков после запятой');
  return rubles(input.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
}
export function formatRubles(value: Rubles): string {
  const [whole, fraction] = rubles(value).split('.');
  return new Intl.NumberFormat('ru-RU').format(BigInt(whole!)) + (fraction === '00' ? '' : ',' + fraction) + ' ₽';
}
