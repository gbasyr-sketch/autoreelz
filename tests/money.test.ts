import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RUBLES, rubles, sumRubles, multiplyRubles, discountRubles,
  compareRubles, formatRubles, parseRublesInput,
} from '../src/lib/money.ts';

test('ruble values preserve exact cents and use a canonical two-digit fraction', () => {
  assert.equal(rubles('0.01'), '0.01');
  assert.equal(rubles('7200.50'), '7200.50');
  assert.equal(rubles('7200.5'), '7200.50');
  assert.equal(rubles('7200'), '7200.00');
  assert.equal(rubles('0'), '0.00');
  assert.equal(JSON.parse(JSON.stringify({priceRubles: rubles('7200.50')})).priceRubles, '7200.50');
});

test('decimal addition and multiplication do not introduce binary floating-point errors', () => {
  assert.equal(sumRubles(['0.10', '0.20']), '0.30');
  assert.equal(sumRubles(['7200.50', '0.01', '123.45']), '7323.96');
  assert.equal(multiplyRubles('0.10', 3), '0.30');
  assert.equal(multiplyRubles('7200.50', 3), '21601.50');
  assert.equal(sumRubles([]), '0.00');
  assert.equal(multiplyRubles('7200.50', 0), '0.00');
});

test('bundle discounts round half a kopeck up once after summing the components', () => {
  assert.equal(discountRubles('0.01', 5000), '0.01');
  assert.equal(discountRubles('0.03', 5000), '0.02');
  assert.equal(discountRubles(sumRubles(['0.01', '0.01']), 5000), '0.01');
  assert.equal(discountRubles('400.02', 500), '380.02');
  assert.equal(discountRubles('7200.50', 0), '7200.50');
  assert.equal(discountRubles('7200.50', 10000), '0.00');
});

test('comparison and display retain exact ruble values including the upper boundary', () => {
  assert.equal(compareRubles('9.99', '10.00'), -1);
  assert.equal(compareRubles('7200.50', '7200.5'), 0);
  assert.equal(compareRubles('90071992547409.91', '90071992547409.90'), 1);
  assert.equal(formatRubles('7200.50').replace(/\u00a0|\u202f/g, ' '), '7 200,50 ₽');
  assert.equal(formatRubles('0.01'), '0,01 ₽');
  assert.equal(formatRubles('7200.00').replace(/\u00a0|\u202f/g, ' '), '7 200 ₽');
  assert.equal(formatRubles(MAX_RUBLES).replace(/\u00a0|\u202f/g, ' '), '90 071 992 547 409,91 ₽');
});

test('human input accepts rubles with a decimal comma and conventional grouping', () => {
  for (const value of ['7200.50', '7200,50', ' 7 200,50 ₽ ', '7\u00a0200,50', '7\u202f200.50']) {
    assert.equal(parseRublesInput(value), '7200.50', value);
  }
  assert.equal(parseRublesInput('0,01'), '0.01');
});

test('invalid amounts, excessive precision and unsafe ranges are rejected', () => {
  for (const value of ['', ' ', '-1', '-0.00', '+1', '1e3', '1.001', '1,00', 'NaN', 'Infinity', null, undefined, {}, [], NaN, Infinity, -1, 0.1 + 0.2]) {
    assert.throws(() => rubles(value), RangeError, String(value));
  }
  for (const value of ['', '7 20,50', '7 2000,50', '1,234.56', '1.234,56', '1.001', '-0,01', '1e3', '₽ 12']) {
    assert.throws(() => parseRublesInput(value), RangeError, value);
  }
  assert.equal(rubles(MAX_RUBLES), '90071992547409.91');
  assert.throws(() => rubles('90071992547409.92'), RangeError);
  assert.throws(() => sumRubles([MAX_RUBLES, '0.01']), RangeError);
  assert.throws(() => multiplyRubles(MAX_RUBLES, 2), RangeError);
  for (const quantity of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => multiplyRubles('1.00', quantity), RangeError);
  }
  for (const discount of [-1, 10001, 0.5, NaN, Infinity]) {
    assert.throws(() => discountRubles('1.00', discount), RangeError);
  }
});
