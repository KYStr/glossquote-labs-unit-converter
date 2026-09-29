import { CATEGORIES_BY_ID, UNITS_BY_ID } from "./units.mjs";

const REQUEST_FIELDS = Object.freeze(["category", "from", "to", "value"]);
const REQUEST_FIELD_SET = new Set(REQUEST_FIELDS);
const MIN_INPUT_MAGNITUDE = 1e-12;
const MAX_INPUT_MAGNITUDE = 1e12;
const MIN_RESULT_MAGNITUDE = 1e-18;
const MAX_RESULT_MAGNITUDE = 1e18;
const ABSOLUTE_ZERO = Object.freeze({ C: -273.15, F: -459.67, K: 0 });
const TEMPERATURE_EXPRESSIONS = Object.freeze({
  "C:F": "x × 9 ÷ 5 + 32",
  "F:C": "(x − 32) × 5 ÷ 9",
  "C:K": "x + 273.15",
  "K:C": "x − 273.15",
  "F:K": "(x + 459.67) × 5 ÷ 9",
  "K:F": "x × 9 ÷ 5 − 459.67",
});

function failure(code) {
  return { ok: false, code };
}

function readExactRequest(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    return null;
  }

  const keys = Reflect.ownKeys(request);
  if (keys.length !== REQUEST_FIELDS.length || keys.some((key) => !REQUEST_FIELD_SET.has(key))) {
    return null;
  }

  const values = Object.create(null);
  for (const field of REQUEST_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(request, field);
    if (descriptor === undefined || !("value" in descriptor)) {
      return null;
    }
    values[field] = descriptor.value;
  }
  return values;
}

function isInputRange(value) {
  return value !== 0 && (
    Math.abs(value) < MIN_INPUT_MAGNITUDE ||
    Math.abs(value) > MAX_INPUT_MAGNITUDE
  );
}

function calculateTemperature(value, from, to) {
  if (from.id === to.id) return value;

  switch (`${from.id}:${to.id}`) {
    case "C:F": return value * 9 / 5 + 32;
    case "F:C": return (value - 32) * 5 / 9;
    case "C:K": return value + 273.15;
    case "K:C": return value - 273.15;
    case "F:K": return (value + 459.67) * 5 / 9;
    case "K:F": return value * 9 / 5 - 459.67;
    default: return value;
  }
}

export function convert(request) {
  const input = readExactRequest(request);
  if (input === null) {
    return failure("INVALID_NUMBER");
  }
  if (typeof input.value !== "number") {
    return failure("INVALID_NUMBER");
  }

  const category = typeof input.category === "string"
    ? CATEGORIES_BY_ID[input.category]
    : undefined;
  const source = typeof input.from === "string" ? UNITS_BY_ID[input.from] : undefined;
  const target = typeof input.to === "string" ? UNITS_BY_ID[input.to] : undefined;
  if (category === undefined || source === undefined || target === undefined) {
    return failure("UNKNOWN_UNIT");
  }
  if (source.categoryId !== category.id || target.categoryId !== category.id) {
    return failure("UNIT_MISMATCH");
  }

  const value = input.value;
  if (!Number.isFinite(value)) {
    return failure("INVALID_NUMBER");
  }
  if (isInputRange(value)) {
    return failure("INPUT_RANGE");
  }

  if (category.id === "temperature") {
    if (value < ABSOLUTE_ZERO[source.id]) {
      return failure("BELOW_ABSOLUTE_ZERO");
    }
  } else if (value < 0) {
    return failure("NEGATIVE_QUANTITY");
  }

  const result = category.id === "temperature"
    ? calculateTemperature(value, source, target)
    : value * (source.factor / target.factor);
  if (!Number.isFinite(result)) {
    return failure("RESULT_RANGE");
  }

  const magnitude = Math.abs(result);
  if (result !== 0 && (magnitude < MIN_RESULT_MAGNITUDE || magnitude > MAX_RESULT_MAGNITUDE)) {
    return failure("RESULT_RANGE");
  }

  return { ok: true, value: Object.is(result, -0) ? 0 : result };
}

function formulaUnit(id) {
  if (typeof id !== "string") return undefined;
  return UNITS_BY_ID[id];
}

function incompatibleFormula() {
  throw new RangeError("Units are not a compatible pair.");
}

export function getFormula(from, to) {
  const source = formulaUnit(from);
  const target = formulaUnit(to);
  if (source === undefined || target === undefined || source.categoryId !== target.categoryId) {
    return incompatibleFormula();
  }

  const sourceLabel = `${source.name} (${source.symbol})`;
  const targetLabel = `${target.name} (${target.symbol})`;
  if (source.id === target.id) {
    return `來源值 ${sourceLabel}`;
  }

  if (source.categoryId === "temperature") {
    const expression = TEMPERATURE_EXPRESSIONS[`${source.id}:${target.id}`];
    return `${sourceLabel} → ${targetLabel}：${expression}`;
  }

  const base = CATEGORIES_BY_ID[source.categoryId];
  const baseUnit = UNITS_BY_ID[base.baseUnitId];
  return `來源值 ${sourceLabel} × (${source.factor} ÷ ${target.factor})；基準：${baseUnit.name} (${baseUnit.symbol})；目標：${targetLabel}`;
}
