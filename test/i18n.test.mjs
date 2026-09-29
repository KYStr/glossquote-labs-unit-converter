import assert from "node:assert/strict";
import { test } from "node:test";
import { convert } from "../public/js/core/convert.mjs";
import { formatNumber, parseNumber } from "../public/js/core/numbers.mjs";
import {
  DICTIONARIES,
  formatUnitLabel,
  getCategoryLabel,
  getErrorMessage,
  getLocalizedFormula,
  getMessages,
} from "../public/js/i18n.mjs";

const EXPECTED_CATEGORY_IDS = ["length", "area", "mass", "volume", "temperature"];
const EXPECTED_UNIT_IDS = [
  "mm", "cm", "m", "km", "in", "ft",
  "cm2", "m2", "km2", "ha",
  "mg", "g", "kg", "lb",
  "mL", "L", "m3",
  "C", "F", "K",
];
const EXPECTED_ERROR_CODES = [
  "INPUT_TOO_LONG",
  "INVALID_NUMBER",
  "INPUT_RANGE",
  "NEGATIVE_QUANTITY",
  "BELOW_ABSOLUTE_ZERO",
  "UNKNOWN_UNIT",
  "UNIT_MISMATCH",
  "RESULT_RANGE",
];

const EXPECTED_TRANSLATIONS = {
  "zh-Hant": {
    categories: {
      length: "長度", area: "面積", mass: "質量", volume: "容量", temperature: "溫度",
    },
    units: {
      mm: ["毫米", "mm"], cm: ["公分", "cm"], m: ["公尺", "m"], km: ["公里", "km"],
      in: ["英吋", "in"], ft: ["英呎", "ft"],
      cm2: ["平方公分", "cm²"], m2: ["平方公尺", "m²"], km2: ["平方公里", "km²"], ha: ["公頃", "ha"],
      mg: ["毫克", "mg"], g: ["公克", "g"], kg: ["公斤", "kg"], lb: ["常衡磅", "lb"],
      mL: ["毫升", "mL"], L: ["公升", "L"], m3: ["立方公尺", "m³"],
      C: ["攝氏", "°C"], F: ["華氏", "°F"], K: ["克耳文", "K"],
    },
    errors: {
      INPUT_TOO_LONG: "數值最多 64 個字元；請刪減後重試。",
      INVALID_NUMBER: "請輸入數字，例如 12.5；不接受逗號或運算式。",
      INPUT_RANGE: "數值超出支援範圍。請使用 0，或絕對值 1e-12 至 1e12 的數值。",
      NEGATIVE_QUANTITY: "此類單位請輸入 0 或正數。",
      BELOW_ABSOLUTE_ZERO: "溫度不可低於絕對零度。",
      UNKNOWN_UNIT: "請重新選擇類別與單位。",
      UNIT_MISMATCH: "請選擇同一類別中的來源與目標單位。",
      RESULT_RANGE: "結果超出目前支援範圍，請調整數值或單位。",
    },
    emptyPrompt: "輸入數值即可換算。",
    resultApproximately: "約等於",
  },
  en: {
    categories: {
      length: "Length", area: "Area", mass: "Mass", volume: "Volume", temperature: "Temperature",
    },
    units: {
      mm: ["millimetre", "mm"], cm: ["centimetre", "cm"], m: ["metre", "m"], km: ["kilometre", "km"],
      in: ["inch", "in"], ft: ["foot", "ft"],
      cm2: ["square centimetre", "cm²"], m2: ["square metre", "m²"], km2: ["square kilometre", "km²"], ha: ["hectare", "ha"],
      mg: ["milligram", "mg"], g: ["gram", "g"], kg: ["kilogram", "kg"], lb: ["avoirdupois pound", "lb"],
      mL: ["millilitre", "mL"], L: ["litre", "L"], m3: ["cubic metre", "m³"],
      C: ["Celsius", "°C"], F: ["Fahrenheit", "°F"], K: ["kelvin", "K"],
    },
    errors: {
      INPUT_TOO_LONG: "Input is limited to 64 characters. Shorten it and try again.",
      INVALID_NUMBER: "Enter a number such as 12.5. Commas and expressions are not supported.",
      INPUT_RANGE: "Input is outside the supported range. Enter 0 or a magnitude from 1e-12 to 1e12.",
      NEGATIVE_QUANTITY: "Enter 0 or a positive quantity for this unit category.",
      BELOW_ABSOLUTE_ZERO: "Temperature cannot be below absolute zero.",
      UNKNOWN_UNIT: "Choose a supported category and unit.",
      UNIT_MISMATCH: "Choose source and target units from the same category.",
      RESULT_RANGE: "The result is outside the supported range. Adjust the number or units.",
    },
    emptyPrompt: "Enter a value to convert.",
    resultApproximately: "is approximately",
  },
};

const EXPECTED_TEMPERATURE_FORMULAS = {
  "C:F": "Celsius (°C) → Fahrenheit (°F): x × 9 ÷ 5 + 32",
  "F:C": "Fahrenheit (°F) → Celsius (°C): (x − 32) × 5 ÷ 9",
  "C:K": "Celsius (°C) → kelvin (K): x + 273.15",
  "K:C": "kelvin (K) → Celsius (°C): x − 273.15",
  "F:K": "Fahrenheit (°F) → kelvin (K): (x + 459.67) × 5 ÷ 9",
  "K:F": "kelvin (K) → Fahrenheit (°F): x × 9 ÷ 5 − 459.67",
};

test("both local dictionaries cover the five categories, twenty units, and every fixed error", () => {
  for (const language of ["zh-Hant", "en"]) {
    const dictionary = getMessages(language);
    const expected = EXPECTED_TRANSLATIONS[language];
    assert.deepEqual(Object.keys(dictionary.categories), EXPECTED_CATEGORY_IDS);
    assert.deepEqual(Object.keys(dictionary.units), EXPECTED_UNIT_IDS);
    assert.deepEqual(Object.keys(dictionary.errors), EXPECTED_ERROR_CODES);
    assert.deepEqual(dictionary.categories, expected.categories);
    assert.deepEqual(dictionary.errors, expected.errors);
    assert.equal(dictionary.emptyPrompt, expected.emptyPrompt);
    assert.equal(dictionary.resultApproximately, expected.resultApproximately);

    for (const [unitId, [name, symbol]] of Object.entries(expected.units)) {
      assert.deepEqual(dictionary.units[unitId], { name, symbol });
      assert.equal(formatUnitLabel(language, unitId), `${name} (${symbol})`);
    }
    for (const errorCode of EXPECTED_ERROR_CODES) {
      assert.equal(getErrorMessage(language, errorCode), expected.errors[errorCode]);
    }
  }

  assert.equal(getCategoryLabel("en", "temperature"), "Temperature");
  assert.equal(getCategoryLabel("en", "custom"), null);
  assert.equal(formatUnitLabel("en", "custom"), null);
  assert.equal(getErrorMessage("en", "UNRECOGNIZED_CODE"), EXPECTED_TRANSLATIONS.en.errors.INVALID_NUMBER);
  for (const inheritedName of ["constructor", "__proto__", "toString"]) {
    assert.equal(getCategoryLabel("en", inheritedName), null);
    assert.equal(formatUnitLabel("en", inheritedName), null);
    assert.equal(getErrorMessage("en", inheritedName), EXPECTED_TRANSLATIONS.en.errors.INVALID_NUMBER);
  }

  let coercionCalls = 0;
  const nonStringId = {
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return "m";
    },
  };
  assert.equal(getCategoryLabel("en", nonStringId), null);
  assert.equal(formatUnitLabel("en", nonStringId), null);
  assert.equal(getErrorMessage("en", nonStringId), EXPECTED_TRANSLATIONS.en.errors.INVALID_NUMBER);
  assert.equal(getErrorMessage("en", Symbol("unknown")), EXPECTED_TRANSLATIONS.en.errors.INVALID_NUMBER);
  assert.equal(coercionCalls, 0);
});

test("dictionaries are deeply frozen and English copy contains no CJK text", () => {
  assert.equal(Object.isFrozen(DICTIONARIES), true);
  for (const dictionary of Object.values(DICTIONARIES)) {
    assert.equal(Object.isFrozen(dictionary), true);
    assert.equal(Object.isFrozen(dictionary.categories), true);
    assert.equal(Object.isFrozen(dictionary.units), true);
    assert.equal(Object.isFrozen(dictionary.errors), true);
    assert.equal(Object.isFrozen(dictionary.formula), true);
    for (const unit of Object.values(dictionary.units)) assert.equal(Object.isFrozen(unit), true);
  }
  assert.doesNotMatch(JSON.stringify(DICTIONARIES.en), /[\u3400-\u9fff]/u);
  assert.throws(() => { DICTIONARIES.en.units.m.name = "changed"; }, TypeError);
  assert.equal(getMessages("unknown-language"), DICTIONARIES["zh-Hant"]);
});

test("English temperature display formulas match every fixed conversion pair and identity", () => {
  for (const [pair, expected] of Object.entries(EXPECTED_TEMPERATURE_FORMULAS)) {
    const [from, to] = pair.split(":");
    assert.equal(getLocalizedFormula("en", from, to), expected);
  }
  assert.equal(getLocalizedFormula("en", "C", "C"), "From: Celsius (°C)");
  assert.equal(getLocalizedFormula("en", "F", "F"), "From: Fahrenheit (°F)");
  assert.equal(getLocalizedFormula("en", "K", "K"), "From: kelvin (K)");
  assert.equal(getLocalizedFormula("zh-Hant", "C", "F"), "攝氏 (°C) → 華氏 (°F)：x × 9 ÷ 5 + 32");
  assert.equal(getLocalizedFormula("zh-Hant", "m", "m"), "來源值 公尺 (m)");
});

test("localized proportion formula names fixed units, factors, and the base unit", () => {
  assert.equal(
    getLocalizedFormula("en", "m", "cm"),
    "From: metre (m) × (1 ÷ 0.01); Base unit: metre (m); To: centimetre (cm)",
  );
  assert.equal(
    getLocalizedFormula("en", "lb", "kg"),
    "From: avoirdupois pound (lb) × (0.45359237 ÷ 1); Base unit: kilogram (kg); To: kilogram (kg)",
  );
  assert.equal(
    getLocalizedFormula("zh-Hant", "m", "cm"),
    "來源值 公尺 (m) × (1 ÷ 0.01)；基準：公尺 (m)；目標：公分 (cm)",
  );
});

test("formula display rejects unknown and cross-category unit pairs", () => {
  for (const [from, to] of [["not-a-unit", "m"], ["m", "kg"], ["C", "L"]]) {
    assert.throws(
      () => getLocalizedFormula("en", from, to),
      (error) => error instanceof RangeError && error.message === "Units are not a compatible pair.",
    );
  }
});

test("language text does not change core numeric results or ASCII formatting", () => {
  for (const language of ["zh-Hant", "en"]) {
    const messages = getMessages(language);
    assert.deepEqual(parseNumber(" 1.25e2 "), { ok: true, value: 125 });
    const conversion = convert({ category: "length", from: "m", to: "cm", value: 1 });
    assert.deepEqual(conversion, { ok: true, value: 100 });
    assert.equal(formatNumber(conversion.value), "100");
    const precise = convert({ category: "length", from: "cm", to: "in", value: 1 });
    assert.deepEqual(precise, { ok: true, value: 0.3937007874015748 });
    assert.equal(formatNumber(precise.value), "0.393700787402");
    assert.equal(messages.resultApproximately, EXPECTED_TRANSLATIONS[language].resultApproximately);
  }
});
