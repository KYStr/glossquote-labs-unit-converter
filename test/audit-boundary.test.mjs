import assert from "node:assert/strict";
import { test } from "node:test";
import { convert } from "../public/js/core/convert.mjs";
import { formatNumber } from "../public/js/core/numbers.mjs";

const MINIMUM_RESULT = 1e-18;
const MAXIMUM_RESULT = 1e18;

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

test("audit F-01 returns the exact 1e-18 result for four decimal conversions", () => {
  const cases = [
    { category: "length", from: "mm", to: "km" },
    { category: "area", from: "m2", to: "km2" },
    { category: "mass", from: "mg", to: "kg" },
    { category: "volume", from: "mL", to: "m3" },
  ];

  for (const { category, from, to } of cases) {
    const result = convert({ category, from, to, value: 1e-12 });
    assert.deepEqual(result, { ok: true, value: 1e-18 }, `${category} ${from} to ${to}`);
    assert.equal(formatNumber(result.value), "1e-18", `${category} ${from} to ${to}`);
  }
});

test("area conversions accept the exact lower result boundary and its inside neighbor", () => {
  const cases = [
    { from: "cm2", to: "km2", inputBoundary: 1e-8 },
    { from: "cm2", to: "ha", inputBoundary: 1e-10 },
  ];

  for (const { from, to, inputBoundary } of cases) {
    const convertArea = (value) => convert({ category: "area", from, to, value });
    assert.deepEqual(convertArea(adjacentFloat64(inputBoundary, -1)), {
      ok: false,
      code: "RESULT_RANGE",
    }, `${from} to ${to}, immediately below boundary`);
    assert.deepEqual(convertArea(inputBoundary), { ok: true, value: MINIMUM_RESULT }, `${from} to ${to}, boundary`);

    const immediatelyInside = convertArea(adjacentFloat64(inputBoundary, 1));
    assert.equal(immediatelyInside.ok, true, `${from} to ${to}, immediately inside`);
    assert.ok(immediatelyInside.value >= MINIMUM_RESULT, `${from} to ${to}, result remains in range`);
    assert.equal(formatNumber(immediatelyInside.value), "1e-18", `${from} to ${to}, rounded display`);
  }
});

test("area conversions accept the exact upper result boundary and its inside neighbor", () => {
  const cases = [
    { from: "km2", to: "cm2", inputBoundary: 1e8 },
    { from: "ha", to: "cm2", inputBoundary: 1e10 },
  ];

  for (const { from, to, inputBoundary } of cases) {
    const convertArea = (value) => convert({ category: "area", from, to, value });
    const immediatelyInside = convertArea(adjacentFloat64(inputBoundary, -1));
    assert.equal(immediatelyInside.ok, true, `${from} to ${to}, immediately inside`);
    assert.ok(immediatelyInside.value <= MAXIMUM_RESULT, `${from} to ${to}, result remains in range`);
    assert.equal(formatNumber(immediatelyInside.value), "1e+18", `${from} to ${to}, rounded display`);

    assert.deepEqual(convertArea(inputBoundary), { ok: true, value: MAXIMUM_RESULT }, `${from} to ${to}, boundary`);
    assert.deepEqual(convertArea(adjacentFloat64(inputBoundary, 1)), {
      ok: false,
      code: "RESULT_RANGE",
    }, `${from} to ${to}, immediately above boundary`);
  }
});

test("genuine result underflow and zero keep their documented outcomes", () => {
  assert.deepEqual(convert({ category: "area", from: "cm2", to: "km2", value: 1e-12 }), {
    ok: false,
    code: "RESULT_RANGE",
  });

  const zero = convert({ category: "area", from: "cm2", to: "km2", value: 0 });
  assert.deepEqual(zero, { ok: true, value: 0 });
  assert.equal(Object.is(zero.value, -0), false);
  assert.equal(formatNumber(zero.value), "0");
});

test("formatNumber remains strict just outside both output boundaries", () => {
  assert.equal(formatNumber(MINIMUM_RESULT), "1e-18");
  assert.equal(formatNumber(MAXIMUM_RESULT), "1e+18");

  for (const value of [
    adjacentFloat64(MINIMUM_RESULT, -1),
    adjacentFloat64(MAXIMUM_RESULT, 1),
  ]) {
    assert.throws(
      () => formatNumber(value),
      (error) => error instanceof RangeError && error.message === "Number is outside the display range.",
    );
  }
});
