import assert from "node:assert/strict";
import { test } from "node:test";
import { convert } from "../public/js/core/convert.mjs";
import { parseNumber } from "../public/js/core/numbers.mjs";

const VALID_NUMBER_STEMS = ["0", "1", "-2.5", ".75", "6e3", "+4E-2"];
const INVALID_FRAGMENTS = ["x", ",", "_", "\u00a0", "１２", "．", "%", "<img>"];
const INCOMPLETE_SUFFIXES = ["e", "E+", "e-", "e++", "e--", "++", "--"];
const MIN_INPUT_MAGNITUDE = 1e-12;
const MAX_INPUT_MAGNITUDE = 1e12;
const ABSOLUTE_ZERO = Object.freeze({ C: -273.15, F: -459.67, K: 0 });

function adjacentFloat64(value, direction) {
  assert.ok(direction === -1 || direction === 1);
  if (value === 0) {
    return direction < 0 ? -Number.MIN_VALUE : Number.MIN_VALUE;
  }

  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const moveBitsUp = (value > 0) === (direction > 0);
  view.setBigUint64(0, moveBitsUp ? bits + 1n : bits - 1n, false);
  return view.getFloat64(0, false);
}

function generatedMalformedStrings() {
  const malformed = new Set();
  for (const stem of VALID_NUMBER_STEMS) {
    for (const fragment of INVALID_FRAGMENTS) {
      const middle = Math.floor(stem.length / 2);
      malformed.add(`${fragment}${stem}`);
      malformed.add(`${stem}${fragment}`);
      malformed.add(`${stem.slice(0, middle)}${fragment}${stem.slice(middle)}`);
    }
    for (const suffix of INCOMPLETE_SUFFIXES) {
      malformed.add(`${stem}${suffix}`);
    }
  }
  return malformed;
}

test("bounded deterministic malformed strings return only a fixed error code", () => {
  const malformed = generatedMalformedStrings();
  assert.ok(malformed.size >= 150 && malformed.size <= 200);

  for (const raw of malformed) {
    const result = parseNumber(raw);
    assert.deepEqual(result, { ok: false, code: "INVALID_NUMBER" });
    assert.equal(JSON.stringify(result).includes(raw), false);
  }
});

test("non-number inputs are rejected without coercion or echoing their contents", () => {
  let coercionCalls = 0;
  const coercionGuard = Object.defineProperties({}, {
    valueOf: {
      get() {
        coercionCalls += 1;
        return () => 1;
      },
    },
    toString: {
      get() {
        coercionCalls += 1;
        return () => "1";
      },
    },
    [Symbol.toPrimitive]: {
      value() {
        coercionCalls += 1;
        return 1;
      },
    },
  });
  const proxyValue = new Proxy({}, {
    get() {
      coercionCalls += 1;
      throw new Error("A rejected value must not be inspected.");
    },
  });
  const rejectedValues = [
    undefined,
    null,
    false,
    true,
    "SENTINEL_INPUT_MUST_NOT_BE_RETURNED",
    1n,
    Symbol("SENTINEL_INPUT"),
    Object(1),
    Object("1"),
    [],
    {},
    Object.create(null),
    coercionGuard,
    proxyValue,
  ];
  const request = { category: "length", from: "m", to: "cm" };

  for (const value of rejectedValues) {
    assert.deepEqual(parseNumber(value), { ok: false, code: "INVALID_NUMBER" });
    const result = convert({ ...request, value });
    assert.deepEqual(result, { ok: false, code: "INVALID_NUMBER" });
    assert.equal(JSON.stringify(result).includes("SENTINEL_INPUT"), false);
  }
  assert.equal(coercionCalls, 0);
});

test("mixed astral text is counted by UTF-16 code units at the raw input limit", () => {
  const exactly64CodeUnits = `${"0".repeat(60)}😀00`;
  const over64CodeUnits = `${exactly64CodeUnits}0`;
  assert.equal(exactly64CodeUnits.length, 64);
  assert.equal(over64CodeUnits.length, 65);
  assert.deepEqual(parseNumber(exactly64CodeUnits), { ok: false, code: "INVALID_NUMBER" });
  assert.deepEqual(parseNumber(over64CodeUnits), { ok: false, code: "INPUT_TOO_LONG" });
});

test("decimal input limits hold for neighboring numbers", () => {
  const justBelowMinimum = adjacentFloat64(MIN_INPUT_MAGNITUDE, -1);
  const justAboveMinimum = adjacentFloat64(MIN_INPUT_MAGNITUDE, 1);
  const justBelowMaximum = adjacentFloat64(MAX_INPUT_MAGNITUDE, -1);
  const justAboveMaximum = adjacentFloat64(MAX_INPUT_MAGNITUDE, 1);
  const accepted = [
    MIN_INPUT_MAGNITUDE,
    justAboveMinimum,
    -MIN_INPUT_MAGNITUDE,
    -justAboveMinimum,
    justBelowMaximum,
    -justBelowMaximum,
  ];
  const rejected = [justBelowMinimum, -justBelowMinimum, justAboveMaximum, -justAboveMaximum];

  for (const value of accepted) {
    const raw = String(value);
    assert.equal(Number(raw), value);
    assert.deepEqual(parseNumber(raw), { ok: true, value });
  }
  for (const value of rejected) {
    const raw = String(value);
    assert.equal(Number(raw), value);
    assert.deepEqual(parseNumber(raw), { ok: false, code: "INPUT_RANGE" });
  }
});

test("temperature lower limits reject the adjacent lower float without tolerance", () => {
  for (const unit of ["C", "F", "K"]) {
    const minimum = ABSOLUTE_ZERO[unit];
    const atMinimum = convert({ category: "temperature", from: unit, to: unit, value: minimum });
    assert.deepEqual(atMinimum, { ok: true, value: minimum });

    const belowMinimum = adjacentFloat64(minimum, -1);
    const expectedBelowCode = unit === "K" ? "INPUT_RANGE" : "BELOW_ABSOLUTE_ZERO";
    assert.deepEqual(convert({
      category: "temperature",
      from: unit,
      to: unit,
      value: belowMinimum,
    }), { ok: false, code: expectedBelowCode });

    const aboveMinimum = adjacentFloat64(minimum, 1);
    if (unit === "K") {
      assert.deepEqual(convert({
        category: "temperature",
        from: unit,
        to: unit,
        value: aboveMinimum,
      }), { ok: false, code: "INPUT_RANGE" });
    } else {
      assert.deepEqual(convert({
        category: "temperature",
        from: unit,
        to: unit,
        value: aboveMinimum,
      }), { ok: true, value: aboveMinimum });
    }
  }

  assert.deepEqual(convert({ category: "temperature", from: "K", to: "K", value: -1e-12 }), {
    ok: false,
    code: "BELOW_ABSOLUTE_ZERO",
  });
});

test("result gates remain strict immediately around their magnitude limits", () => {
  const nextAboveInputMinimum = adjacentFloat64(MIN_INPUT_MAGNITUDE, 1);
  const justInsideResultMinimum = convert({
    category: "length",
    from: "mm",
    to: "km",
    value: nextAboveInputMinimum,
  });
  assert.equal(justInsideResultMinimum.ok, true);
  assert.ok(justInsideResultMinimum.value >= 1e-18);

  const nextAboveOutputMaximum = adjacentFloat64(1e8, 1);
  assert.deepEqual(convert({
    category: "area",
    from: "km2",
    to: "cm2",
    value: nextAboveOutputMaximum,
  }), { ok: false, code: "RESULT_RANGE" });
});
