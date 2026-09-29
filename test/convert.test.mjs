import assert from "node:assert/strict";
import { test } from "node:test";
import { convert, getFormula } from "../public/js/core/convert.mjs";
import { formatNumber } from "../public/js/core/numbers.mjs";
import { CATEGORIES, CATEGORIES_BY_ID, DEFAULT_UNIT_PAIRS, UNITS_BY_ID } from "../public/js/core/units.mjs";

const EXPECTED_CATEGORIES = [
  {
    id: "length",
    name: "長度",
    baseUnitId: "m",
    units: [
      ["mm", "毫米", "mm", 0.001], ["cm", "公分", "cm", 0.01],
      ["m", "公尺", "m", 1], ["km", "公里", "km", 1000],
      ["in", "英吋", "in", 0.0254], ["ft", "英呎", "ft", 0.3048],
    ],
  },
  {
    id: "area",
    name: "面積",
    baseUnitId: "m2",
    units: [
      ["cm2", "平方公分", "cm²", 0.0001], ["m2", "平方公尺", "m²", 1],
      ["km2", "平方公里", "km²", 1000000], ["ha", "公頃", "ha", 10000],
    ],
  },
  {
    id: "mass",
    name: "質量",
    baseUnitId: "kg",
    units: [
      ["mg", "毫克", "mg", 0.000001], ["g", "公克", "g", 0.001],
      ["kg", "公斤", "kg", 1], ["lb", "常衡磅", "lb", 0.45359237],
    ],
  },
  {
    id: "volume",
    name: "容量",
    baseUnitId: "L",
    units: [
      ["mL", "毫升", "mL", 0.001], ["L", "公升", "L", 1],
      ["m3", "立方公尺", "m³", 1000],
    ],
  },
  {
    id: "temperature",
    name: "溫度",
    baseUnitId: "C",
    units: [
      ["C", "攝氏", "°C", null], ["F", "華氏", "°F", null],
      ["K", "克耳文", "K", null],
    ],
  },
];

const REFERENCE = [
  { category: "length", units: [
    { id: "mm", factor: 0.001 }, { id: "cm", factor: 0.01 }, { id: "m", factor: 1 },
    { id: "km", factor: 1000 }, { id: "in", factor: 0.0254 }, { id: "ft", factor: 0.3048 },
  ] },
  { category: "area", units: [
    { id: "cm2", factor: 0.0001 }, { id: "m2", factor: 1 },
    { id: "km2", factor: 1000000 }, { id: "ha", factor: 10000 },
  ] },
  { category: "mass", units: [
    { id: "mg", factor: 0.000001 }, { id: "g", factor: 0.001 },
    { id: "kg", factor: 1 }, { id: "lb", factor: 0.45359237 },
  ] },
  { category: "volume", units: [
    { id: "mL", factor: 0.001 }, { id: "L", factor: 1 }, { id: "m3", factor: 1000 },
  ] },
  { category: "temperature", units: [
    { id: "C", minimum: -273.15 }, { id: "F", minimum: -459.67 }, { id: "K", minimum: 0 },
  ] },
];

const REFERENCE_BY_CATEGORY = new Map(REFERENCE.map((entry) => [entry.category, entry]));
const ABSOLUTE_ZERO = Object.freeze({ C: -273.15, F: -459.67, K: 0 });
const INPUT_MINIMUM = 1e-12;
const INPUT_MAXIMUM = 1e12;
const RESULT_MINIMUM = 1e-18;
const RESULT_MAXIMUM = 1e18;

function approximately(actual, expected) {
  const tolerance = Math.max(1e-12, Math.abs(expected) * 1e-12);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is outside tolerance of ${expected}`);
}

function convertExpected(category, from, to, value) {
  if (category === "temperature") {
    if (from === to) return value;
    switch (`${from}:${to}`) {
      case "C:F": return value * 9 / 5 + 32;
      case "F:C": return (value - 32) * 5 / 9;
      case "C:K": return value + 273.15;
      case "K:C": return value - 273.15;
      case "F:K": return (value + 459.67) * 5 / 9;
      case "K:F": return value * 9 / 5 - 459.67;
      default: throw new Error("Unexpected reference temperature pair.");
    }
  }

  const units = REFERENCE_BY_CATEGORY.get(category).units;
  const source = units.find((unit) => unit.id === from);
  const target = units.find((unit) => unit.id === to);
  return value * (source.factor / target.factor);
}

function referenceUnit(category, id) {
  return REFERENCE_BY_CATEGORY.get(category).units.find((unit) => unit.id === id);
}

function resultFailureFor(expected) {
  if (
    !Number.isFinite(expected) ||
    (expected !== 0 && (Math.abs(expected) < RESULT_MINIMUM || Math.abs(expected) > RESULT_MAXIMUM))
  ) {
    return "RESULT_RANGE";
  }
  return null;
}

function reverseFailureFor(category, sourceUnit, value) {
  if (value !== 0 && (Math.abs(value) < INPUT_MINIMUM || Math.abs(value) > INPUT_MAXIMUM)) {
    return "INPUT_RANGE";
  }
  if (category === "temperature" && value < ABSOLUTE_ZERO[sourceUnit]) {
    return "BELOW_ABSOLUTE_ZERO";
  }
  if (category !== "temperature" && value < 0) {
    return "NEGATIVE_QUANTITY";
  }
  return null;
}

function assertConverted(category, from, to, value, expected) {
  const result = convert({ category, from, to, value });
  assert.deepEqual(result, { ok: true, value: result.value });
  approximately(result.value, expected);
  return result.value;
}

test("unit exports preserve the closed categories, labels, factors, and order", () => {
  const projection = CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    baseUnitId: category.baseUnitId,
    units: category.units.map((unit) => [unit.id, unit.name, unit.symbol, unit.factor ?? null]),
  }));
  assert.deepEqual(projection, EXPECTED_CATEGORIES);
  assert.equal(CATEGORIES.flatMap((category) => category.units).length, 20);
  assert.deepEqual(Object.keys(CATEGORIES_BY_ID), ["length", "area", "mass", "volume", "temperature"]);
  assert.deepEqual(Object.keys(DEFAULT_UNIT_PAIRS), ["length", "area", "mass", "volume", "temperature"]);
});

test("exported unit data is deeply frozen and cannot change conversion behavior", () => {
  assert.equal(Object.isFrozen(CATEGORIES), true);
  assert.equal(Object.isFrozen(CATEGORIES_BY_ID), true);
  assert.equal(Object.isFrozen(UNITS_BY_ID), true);
  assert.equal(Object.isFrozen(DEFAULT_UNIT_PAIRS), true);
  for (const category of CATEGORIES) {
    assert.equal(Object.isFrozen(category), true);
    assert.equal(Object.isFrozen(category.units), true);
    for (const unit of category.units) assert.equal(Object.isFrozen(unit), true);
  }
  for (const pair of Object.values(DEFAULT_UNIT_PAIRS)) assert.equal(Object.isFrozen(pair), true);

  assert.throws(() => { CATEGORIES[0].units[0].factor = 99; }, TypeError);
  assert.throws(() => { CATEGORIES[0].units.push({ id: "extra" }); }, TypeError);
  assert.throws(() => { UNITS_BY_ID.m.factor = 99; }, TypeError);
  assert.throws(() => { DEFAULT_UNIT_PAIRS.length.to = "mm"; }, TypeError);
  assert.deepEqual(convert({ category: "length", from: "m", to: "cm", value: 1 }), { ok: true, value: 100 });
});

test("U01 converts one metre to one hundred centimetres", () => {
  const value = assertConverted("length", "m", "cm", 1, 100);
  assert.equal(formatNumber(value), "100");
});

test("U02 converts one international inch to 2.54 centimetres", () => {
  const value = assertConverted("length", "in", "cm", 1, 2.54);
  assert.equal(formatNumber(value), "2.54");
});

test("U03 converts one international foot to 0.3048 metres", () => {
  assertConverted("length", "ft", "m", 1, 0.3048);
});

test("U04 converts hectares and square metres with area factors", () => {
  assertConverted("area", "ha", "m2", 1, 10000);
  assertConverted("area", "m2", "cm2", 1, 10000);
});

test("U05 converts one avoirdupois pound with the exact selected factor", () => {
  assertConverted("mass", "lb", "kg", 1, 0.45359237);
});

test("U06 converts cubic metres and millilitres to litres", () => {
  assertConverted("volume", "m3", "L", 1, 1000);
  assertConverted("volume", "mL", "L", 2500, 2.5);
});

test("U07 checks standard temperature conversions", () => {
  assertConverted("temperature", "C", "F", 0, 32);
  assertConverted("temperature", "F", "C", 212, 100);
  assertConverted("temperature", "C", "F", -40, -40);
  assertConverted("temperature", "C", "K", 100, 373.15);
  assertConverted("temperature", "K", "C", 233.15, -40);
  assertConverted("temperature", "F", "K", 32, 273.15);
  assertConverted("temperature", "K", "F", 273.15, 32);
});

test("U08 maps each selected absolute-zero temperature to positive zero kelvin", () => {
  const fromCelsius = convert({ category: "temperature", from: "C", to: "K", value: -273.15 });
  const fromFahrenheit = convert({ category: "temperature", from: "F", to: "K", value: -459.67 });
  assert.deepEqual(fromCelsius, { ok: true, value: 0 });
  assert.deepEqual(fromFahrenheit, { ok: true, value: 0 });
  assert.equal(Object.is(fromCelsius.value, -0), false);
  assert.equal(Object.is(fromFahrenheit.value, -0), false);
  assert.equal(formatNumber(fromCelsius.value), "0");
  assert.equal(formatNumber(fromFahrenheit.value), "0");
});

test("U09 rejects values below absolute zero without a tolerance allowance", () => {
  assert.deepEqual(convert({ category: "temperature", from: "C", to: "K", value: -273.1501 }), {
    ok: false,
    code: "BELOW_ABSOLUTE_ZERO",
  });
  assert.deepEqual(convert({ category: "temperature", from: "K", to: "C", value: -0.01 }), {
    ok: false,
    code: "BELOW_ABSOLUTE_ZERO",
  });
  assert.deepEqual(convert({ category: "temperature", from: "F", to: "K", value: -459.6701 }), {
    ok: false,
    code: "BELOW_ABSOLUTE_ZERO",
  });
  assert.deepEqual(convert({ category: "temperature", from: "C", to: "C", value: -273.15000000000003 }), {
    ok: false,
    code: "BELOW_ABSOLUTE_ZERO",
  });
});

test("U10 rejects negative quantities and normalizes negative zero", () => {
  assert.deepEqual(convert({ category: "length", from: "m", to: "cm", value: -1 }), {
    ok: false,
    code: "NEGATIVE_QUANTITY",
  });
  const negativeZero = convert({ category: "length", from: "m", to: "cm", value: -0 });
  assert.deepEqual(negativeZero, { ok: true, value: 0 });
  assert.equal(Object.is(negativeZero.value, -0), false);
  assert.equal(formatNumber(negativeZero.value), "0");
});

test("U14 validates input and output bounds with the required operation order", () => {
  assertConverted("length", "km", "m", 1e12, 1e15);
  assertConverted("length", "km", "m", 1e-12, 1e-9);
  assertConverted("length", "mm", "m", 1e-12, 1e-15);
  assert.deepEqual(convert({ category: "area", from: "km2", to: "cm2", value: 1e12 }), {
    ok: false,
    code: "RESULT_RANGE",
  });
  assert.deepEqual(convert({ category: "length", from: "mm", to: "km", value: 1e-12 }), {
    ok: false,
    code: "RESULT_RANGE",
  });
  assertConverted("area", "km2", "cm2", 1e8, 1e18);
  assert.deepEqual(convert({ category: "area", from: "km2", to: "cm2", value: 100000001 }), {
    ok: false,
    code: "RESULT_RANGE",
  });
  assert.deepEqual(convert({ category: "length", from: "m", to: "m", value: 1e-13 }), {
    ok: false,
    code: "INPUT_RANGE",
  });
  assert.deepEqual(convert({ category: "length", from: "m", to: "m", value: 1e12 + 1 }), {
    ok: false,
    code: "INPUT_RANGE",
  });
});

test("U15 rejects unknown, mismatched, and non-exact requests", () => {
  assert.deepEqual(convert({ category: "length", from: "m", to: "kg", value: 1 }), {
    ok: false,
    code: "UNIT_MISMATCH",
  });
  assert.deepEqual(convert({ category: "length", from: "m", to: "script", value: 1 }), {
    ok: false,
    code: "UNKNOWN_UNIT",
  });
  assert.deepEqual(convert({ category: "script", from: "m", to: "cm", value: 1 }), {
    ok: false,
    code: "UNKNOWN_UNIT",
  });
  assert.deepEqual(convert({ category: 1, from: "m", to: "cm", value: 1 }), {
    ok: false,
    code: "UNKNOWN_UNIT",
  });
  assert.deepEqual(convert({ category: "length", from: 1, to: "cm", value: 1 }), {
    ok: false,
    code: "UNKNOWN_UNIT",
  });
  assert.deepEqual(convert({ category: "length", from: "m", to: "cm", value: "1" }), {
    ok: false,
    code: "INVALID_NUMBER",
  });
  assert.deepEqual(convert({ category: "length", from: "script", to: "script", value: "1" }), {
    ok: false,
    code: "INVALID_NUMBER",
  });

  const valid = { category: "length", from: "m", to: "cm", value: 1 };
  assert.deepEqual(convert(null), { ok: false, code: "INVALID_NUMBER" });
  assert.deepEqual(convert(undefined), { ok: false, code: "INVALID_NUMBER" });
  assert.deepEqual(convert([]), { ok: false, code: "INVALID_NUMBER" });
  assert.deepEqual(convert({ category: "length", from: "m", to: "cm" }), { ok: false, code: "INVALID_NUMBER" });
  assert.deepEqual(convert({ ...valid, extra: 0 }), { ok: false, code: "INVALID_NUMBER" });

  const symbolExtra = { ...valid };
  Object.defineProperty(symbolExtra, Symbol("extra"), { value: 0 });
  assert.deepEqual(convert(symbolExtra), { ok: false, code: "INVALID_NUMBER" });
  const hiddenExtra = { ...valid };
  Object.defineProperty(hiddenExtra, "hidden", { value: 0, enumerable: false });
  assert.deepEqual(convert(hiddenExtra), { ok: false, code: "INVALID_NUMBER" });

  let getterCalls = 0;
  const accessor = { category: "length", to: "cm", value: 1 };
  Object.defineProperty(accessor, "from", {
    get() { getterCalls += 1; return "m"; },
    enumerable: true,
  });
  assert.deepEqual(convert(accessor), { ok: false, code: "INVALID_NUMBER" });
  assert.equal(getterCalls, 0);

  const hiddenData = Object.create(null);
  for (const [key, value] of Object.entries(valid)) {
    Object.defineProperty(hiddenData, key, { value, enumerable: false });
  }
  assert.deepEqual(convert(hiddenData), { ok: true, value: 100 });
});

test("U16 formats a converted value and the scientific notation thresholds", () => {
  const inches = assertConverted("length", "cm", "in", 1, 0.3937007874015748);
  assert.equal(formatNumber(inches), "0.393700787402");
  assert.equal(formatNumber(1e-7), "1e-7");
  assert.equal(formatNumber(1e12), "1e+12");
  assert.equal(formatNumber(1000), "1000");
});

test("U17 rejects non-number and non-finite direct values", () => {
  for (const value of [NaN, Infinity, -Infinity, null, true, "1"]) {
    assert.deepEqual(convert({ category: "length", from: "m", to: "cm", value }), {
      ok: false,
      code: "INVALID_NUMBER",
    });
  }
});

test("temperature minima and corresponding -40, 0, and 100 scale cases are exact", () => {
  const minimumCases = [
    ["C", "C", -273.15, -273.15], ["C", "F", -273.15, -459.66999999999996], ["C", "K", -273.15, 0],
    ["F", "C", -459.67, -273.15], ["F", "F", -459.67, -459.67], ["F", "K", -459.67, 0],
    ["K", "C", 0, -273.15], ["K", "F", 0, -459.66999999999996], ["K", "K", 0, 0],
  ];
  for (const [from, to, value, expected] of minimumCases) {
    assertConverted("temperature", from, to, value, expected);
  }

  const scaleCases = [
    ["C", "F", -40, -40], ["C", "F", 0, 32], ["C", "F", 100, 212],
    ["C", "K", -40, 233.15], ["C", "K", 0, 273.15], ["C", "K", 100, 373.15],
    ["F", "C", -40, -40], ["F", "C", 32, 0], ["F", "C", 212, 100],
    ["F", "K", -40, 233.15], ["F", "K", 32, 273.15], ["F", "K", 212, 373.15],
    ["K", "C", 233.15, -40], ["K", "C", 273.15, 0], ["K", "C", 373.15, 100],
    ["K", "F", 233.15, -40], ["K", "F", 273.15, 32], ["K", "F", 373.15, 212],
  ];
  for (const [from, to, value, expected] of scaleCases) {
    assertConverted("temperature", from, to, value, expected);
  }
});

test("getFormula uses only fixed same-category names, bases, and formulas", () => {
  assert.equal(
    getFormula("m", "cm"),
    "來源值 公尺 (m) × (1 ÷ 0.01)；基準：公尺 (m)；目標：公分 (cm)",
  );
  assert.equal(getFormula("m", "m"), "來源值 公尺 (m)");
  assert.equal(getFormula("C", "F"), "攝氏 (°C) → 華氏 (°F)：x × 9 ÷ 5 + 32");
  assert.equal(getFormula("F", "C"), "華氏 (°F) → 攝氏 (°C)：(x − 32) × 5 ÷ 9");
  assert.equal(getFormula("C", "K"), "攝氏 (°C) → 克耳文 (K)：x + 273.15");
  assert.equal(getFormula("K", "C"), "克耳文 (K) → 攝氏 (°C)：x − 273.15");
  assert.equal(getFormula("F", "K"), "華氏 (°F) → 克耳文 (K)：(x + 459.67) × 5 ÷ 9");
  assert.equal(getFormula("K", "F"), "克耳文 (K) → 華氏 (°F)：x × 9 ÷ 5 − 459.67");
  for (const [from, to] of [["unknown", "m"], ["m", "kg"], [1, "m"], ["m", null]]) {
    assert.throws(
      () => getFormula(from, to),
      (error) => error instanceof RangeError && error.message === "Units are not a compatible pair.",
    );
  }
});

test("all unit pairs match an independent reference and round trip only when reverse input is valid", () => {
  let roundTrips = 0;
  let validForwardResults = 0;
  const baseValues = [0, 1, 123.456, 1e-12, 1e12];

  for (const { category, units } of REFERENCE) {
    for (const source of units) {
      const sourceValues = category === "temperature"
        ? [...baseValues, source.minimum]
        : baseValues;
      for (const target of units) {
        for (const value of sourceValues) {
          const expected = convertExpected(category, source.id, target.id, value);
          const forward = convert({ category, from: source.id, to: target.id, value });
          const forwardFailure = resultFailureFor(expected);
          if (forwardFailure !== null) {
            assert.deepEqual(forward, { ok: false, code: forwardFailure }, `${category} ${source.id} to ${target.id} at ${value}`);
            continue;
          }

          assert.equal(forward.ok, true, `${category} ${source.id} to ${target.id} at ${value}`);
          approximately(forward.value, expected);
          validForwardResults += 1;

          const reverseFailure = reverseFailureFor(category, target.id, forward.value);
          const reverse = convert({ category, from: target.id, to: source.id, value: forward.value });
          if (reverseFailure !== null) {
            assert.deepEqual(reverse, { ok: false, code: reverseFailure }, `reverse ${category} ${target.id} to ${source.id} at ${value}`);
            continue;
          }

          assert.equal(reverse.ok, true, `reverse ${category} ${target.id} to ${source.id} at ${value}`);
          approximately(reverse.value, value);
          roundTrips += 1;
        }
      }
    }
  }

  assert.ok(validForwardResults > 0);
  assert.ok(roundTrips > 0);
  assert.deepEqual(convert({ category: "length", from: "km", to: "m", value: 1e12 }), { ok: true, value: 1e15 });
  assert.deepEqual(convert({ category: "length", from: "m", to: "km", value: 1e15 }), { ok: false, code: "INPUT_RANGE" });
  assert.deepEqual(convert({ category: "length", from: "mm", to: "m", value: 1e-12 }), { ok: true, value: 1e-15 });
  assert.deepEqual(convert({ category: "length", from: "m", to: "mm", value: 1e-15 }), { ok: false, code: "INPUT_RANGE" });
});
