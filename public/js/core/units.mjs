function freezeUnits(units) {
  return Object.freeze(units.map((unit) => Object.freeze(unit)));
}

function makeCategory(id, name, baseUnitId, units) {
  return Object.freeze({ id, name, baseUnitId, units: freezeUnits(units) });
}

export const CATEGORIES = Object.freeze([
  makeCategory("length", "長度", "m", [
    { id: "mm", name: "毫米", symbol: "mm", factor: 0.001 },
    { id: "cm", name: "公分", symbol: "cm", factor: 0.01 },
    { id: "m", name: "公尺", symbol: "m", factor: 1 },
    { id: "km", name: "公里", symbol: "km", factor: 1000 },
    { id: "in", name: "英吋", symbol: "in", factor: 0.0254 },
    { id: "ft", name: "英呎", symbol: "ft", factor: 0.3048 },
  ]),
  makeCategory("area", "面積", "m2", [
    { id: "cm2", name: "平方公分", symbol: "cm²", factor: 0.0001 },
    { id: "m2", name: "平方公尺", symbol: "m²", factor: 1 },
    { id: "km2", name: "平方公里", symbol: "km²", factor: 1000000 },
    { id: "ha", name: "公頃", symbol: "ha", factor: 10000 },
  ]),
  makeCategory("mass", "質量", "kg", [
    { id: "mg", name: "毫克", symbol: "mg", factor: 0.000001 },
    { id: "g", name: "公克", symbol: "g", factor: 0.001 },
    { id: "kg", name: "公斤", symbol: "kg", factor: 1 },
    { id: "lb", name: "常衡磅", symbol: "lb", factor: 0.45359237 },
  ]),
  makeCategory("volume", "容量", "L", [
    { id: "mL", name: "毫升", symbol: "mL", factor: 0.001 },
    { id: "L", name: "公升", symbol: "L", factor: 1 },
    { id: "m3", name: "立方公尺", symbol: "m³", factor: 1000 },
  ]),
  makeCategory("temperature", "溫度", "C", [
    { id: "C", name: "攝氏", symbol: "°C" },
    { id: "F", name: "華氏", symbol: "°F" },
    { id: "K", name: "克耳文", symbol: "K" },
  ]),
]);

function makeLookup(entries) {
  const lookup = Object.create(null);
  for (const [key, value] of entries) {
    Object.defineProperty(lookup, key, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(lookup);
}

export const CATEGORIES_BY_ID = makeLookup(
  CATEGORIES.map((category) => [category.id, category]),
);

export const UNITS_BY_ID = makeLookup(
  CATEGORIES.flatMap((category) => category.units.map((unit) => [unit.id, Object.freeze({ ...unit, categoryId: category.id })])),
);

export const DEFAULT_UNIT_PAIRS = makeLookup([
  ["length", Object.freeze({ from: "m", to: "cm" })],
  ["area", Object.freeze({ from: "m2", to: "cm2" })],
  ["mass", Object.freeze({ from: "kg", to: "g" })],
  ["volume", Object.freeze({ from: "L", to: "mL" })],
  ["temperature", Object.freeze({ from: "C", to: "F" })],
]);
