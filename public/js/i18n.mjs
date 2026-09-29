import { getFormula } from "./core/convert.mjs";
import { CATEGORIES_BY_ID, UNITS_BY_ID } from "./core/units.mjs";

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

const TEMPERATURE_FORMULAS = Object.freeze({
  "C:F": "x × 9 ÷ 5 + 32",
  "F:C": "(x − 32) × 5 ÷ 9",
  "C:K": "x + 273.15",
  "K:C": "x − 273.15",
  "F:K": "(x + 459.67) × 5 ÷ 9",
  "K:F": "x × 9 ÷ 5 − 459.67",
});

export const DICTIONARIES = deepFreeze({
  "zh-Hant": {
    categories: {
      length: "長度",
      area: "面積",
      mass: "質量",
      volume: "容量",
      temperature: "溫度",
    },
    units: {
      mm: { name: "毫米", symbol: "mm" },
      cm: { name: "公分", symbol: "cm" },
      m: { name: "公尺", symbol: "m" },
      km: { name: "公里", symbol: "km" },
      in: { name: "英吋", symbol: "in" },
      ft: { name: "英呎", symbol: "ft" },
      cm2: { name: "平方公分", symbol: "cm²" },
      m2: { name: "平方公尺", symbol: "m²" },
      km2: { name: "平方公里", symbol: "km²" },
      ha: { name: "公頃", symbol: "ha" },
      mg: { name: "毫克", symbol: "mg" },
      g: { name: "公克", symbol: "g" },
      kg: { name: "公斤", symbol: "kg" },
      lb: { name: "常衡磅", symbol: "lb" },
      mL: { name: "毫升", symbol: "mL" },
      L: { name: "公升", symbol: "L" },
      m3: { name: "立方公尺", symbol: "m³" },
      C: { name: "攝氏", symbol: "°C" },
      F: { name: "華氏", symbol: "°F" },
      K: { name: "克耳文", symbol: "K" },
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
    formula: {
      source: "來源值",
      baseUnit: "基準",
      target: "目標",
    },
  },
  en: {
    categories: {
      length: "Length",
      area: "Area",
      mass: "Mass",
      volume: "Volume",
      temperature: "Temperature",
    },
    units: {
      mm: { name: "millimetre", symbol: "mm" },
      cm: { name: "centimetre", symbol: "cm" },
      m: { name: "metre", symbol: "m" },
      km: { name: "kilometre", symbol: "km" },
      in: { name: "inch", symbol: "in" },
      ft: { name: "foot", symbol: "ft" },
      cm2: { name: "square centimetre", symbol: "cm²" },
      m2: { name: "square metre", symbol: "m²" },
      km2: { name: "square kilometre", symbol: "km²" },
      ha: { name: "hectare", symbol: "ha" },
      mg: { name: "milligram", symbol: "mg" },
      g: { name: "gram", symbol: "g" },
      kg: { name: "kilogram", symbol: "kg" },
      lb: { name: "avoirdupois pound", symbol: "lb" },
      mL: { name: "millilitre", symbol: "mL" },
      L: { name: "litre", symbol: "L" },
      m3: { name: "cubic metre", symbol: "m³" },
      C: { name: "Celsius", symbol: "°C" },
      F: { name: "Fahrenheit", symbol: "°F" },
      K: { name: "kelvin", symbol: "K" },
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
    formula: {
      source: "From",
      baseUnit: "Base unit",
      target: "To",
    },
  },
});

export function getMessages(language) {
  return language === "en" ? DICTIONARIES.en : DICTIONARIES["zh-Hant"];
}

export function getCategoryLabel(language, categoryId) {
  const messages = getMessages(language);
  if (typeof categoryId !== "string" || !Object.hasOwn(messages.categories, categoryId)) return null;
  return messages.categories[categoryId];
}

export function formatUnitLabel(language, unitId) {
  const messages = getMessages(language);
  if (typeof unitId !== "string" || !Object.hasOwn(messages.units, unitId)) return null;
  const unit = messages.units[unitId];
  if (!Object.hasOwn(UNITS_BY_ID, unitId)) return null;
  return `${unit.name} (${unit.symbol})`;
}

export function getErrorMessage(language, code) {
  const messages = getMessages(language);
  if (typeof code !== "string" || !Object.hasOwn(messages.errors, code)) {
    return messages.errors.INVALID_NUMBER;
  }
  return messages.errors[code];
}

export function getLocalizedFormula(language, from, to) {
  const coreFormula = getFormula(from, to);
  const messages = getMessages(language);
  if (language !== "en") return coreFormula;

  const source = UNITS_BY_ID[from];
  const target = UNITS_BY_ID[to];
  const sourceLabel = formatUnitLabel(language, from);
  const targetLabel = formatUnitLabel(language, to);
  if (source.id === target.id) {
    return `${messages.formula.source}: ${sourceLabel}`;
  }

  if (source.categoryId === "temperature") {
    const expression = TEMPERATURE_FORMULAS[`${source.id}:${target.id}`];
    if (expression === undefined) {
      throw new RangeError("Units are not a compatible pair.");
    }
    return `${sourceLabel} → ${targetLabel}: ${expression}`;
  }

  const category = CATEGORIES_BY_ID[source.categoryId];
  const base = UNITS_BY_ID[category.baseUnitId];
  const baseLabel = formatUnitLabel(language, base.id);
  return `${messages.formula.source}: ${sourceLabel} × (${source.factor} ÷ ${target.factor}); ${messages.formula.baseUnit}: ${baseLabel}; ${messages.formula.target}: ${targetLabel}`;
}
