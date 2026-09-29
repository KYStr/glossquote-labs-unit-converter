import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNumber, parseNumber } from "../public/js/core/numbers.mjs";

test("U11 accepts the documented ASCII decimal forms and reports empty input", () => {
  assert.deepEqual(parseNumber(" 1.25e2 "), { ok: true, value: 125 });
  assert.deepEqual(parseNumber("\t\n\r .5  "), { ok: true, value: 0.5 });
  assert.deepEqual(parseNumber("1."), { ok: true, value: 1 });
  assert.deepEqual(parseNumber(""), { ok: false, code: "EMPTY" });
  assert.deepEqual(parseNumber(" \t\n\r "), { ok: false, code: "EMPTY" });
});

test("U12 rejects partial parses and non-decimal spellings", () => {
  for (const raw of ["1,000", "0x10", "１２", "1+2", "NaN", "Infinity", "1e999"]) {
    assert.deepEqual(parseNumber(raw), { ok: false, code: "INVALID_NUMBER" }, raw);
  }
  for (const raw of ["1 2", "1\n2", "1\u00a0", "\u30001", "1\u2028"]) {
    assert.deepEqual(parseNumber(raw), { ok: false, code: "INVALID_NUMBER" }, raw);
  }
});

test("U13 enforces the raw UTF-16 length boundary before trimming", () => {
  assert.deepEqual(parseNumber(`${"0".repeat(63)}1`), { ok: true, value: 1 });
  assert.deepEqual(parseNumber(`${" ".repeat(63)}1`), { ok: true, value: 1 });
  assert.deepEqual(parseNumber("0".repeat(65)), { ok: false, code: "INPUT_TOO_LONG" });
  assert.deepEqual(parseNumber(`${"0".repeat(64)}1`), { ok: false, code: "INPUT_TOO_LONG" });
  assert.deepEqual(parseNumber(`${" ".repeat(64)}1`), { ok: false, code: "INPUT_TOO_LONG" });
  assert.deepEqual(parseNumber("😀".repeat(32)), { ok: false, code: "INVALID_NUMBER" });
  assert.deepEqual(parseNumber("😀".repeat(33)), { ok: false, code: "INPUT_TOO_LONG" });
});

test("parseNumber rejects non-string values with a fixed code", () => {
  for (const raw of [undefined, null, 1, true, false, {}, []]) {
    assert.deepEqual(parseNumber(raw), { ok: false, code: "INVALID_NUMBER" });
  }
});

test("parseNumber accepts exact input limits and zero literals", () => {
  for (const raw of ["1e-12", "-1e-12", "1e12", "-1e12"]) {
    const result = parseNumber(raw);
    assert.equal(result.ok, true, raw);
    assert.equal(result.value, Number(raw), raw);
  }
  assert.deepEqual(parseNumber("9.999e-13"), { ok: false, code: "INPUT_RANGE" });
  assert.deepEqual(parseNumber("1.000000000001e12"), { ok: false, code: "INPUT_RANGE" });
  assert.deepEqual(parseNumber("1e-13"), { ok: false, code: "INPUT_RANGE" });
  assert.deepEqual(parseNumber("1e13"), { ok: false, code: "INPUT_RANGE" });
  assert.deepEqual(parseNumber("1e-999"), { ok: false, code: "INPUT_RANGE" });
  assert.deepEqual(parseNumber("-1e-999"), { ok: false, code: "INPUT_RANGE" });
  assert.deepEqual(parseNumber("0e999"), { ok: true, value: 0 });
  assert.deepEqual(parseNumber("-0.000e-999"), { ok: true, value: -0 });
  assert.equal(Object.is(parseNumber("-0").value, -0), true);
});

test("formatNumber uses the fixed twelve-significant-digit display rules", () => {
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(-0), "0");
  assert.equal(formatNumber(0.3937007874015748), "0.393700787402");
  assert.equal(formatNumber(1e-7), "1e-7");
  assert.equal(formatNumber(1e-18), "1e-18");
  assert.equal(formatNumber(1e12), "1e+12");
  assert.equal(formatNumber(1e18), "1e+18");
  assert.equal(formatNumber(1000), "1000");
  assert.equal(formatNumber(1e-6), "0.000001");
  assert.equal(formatNumber(0.0000009999999), "9.999999e-7");
  assert.equal(formatNumber(999999999999.9), "1e+12");
});

test("formatNumber rejects values outside the accepted output range", () => {
  for (const value of ["1", null, true, NaN, Infinity, -Infinity, 1e-19, -1e-19, 1.00000000000001e18]) {
    assert.throws(
      () => formatNumber(value),
      (error) => error instanceof RangeError && error.message === "Number is outside the display range.",
    );
  }
});
