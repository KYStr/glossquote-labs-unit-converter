const MAX_RAW_LENGTH = 64;
const MIN_INPUT_MAGNITUDE = 1e-12;
const MAX_INPUT_MAGNITUDE = 1e12;
const MIN_RESULT_MAGNITUDE = 1e-18;
const MAX_RESULT_MAGNITUDE = 1e18;
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function failure(code) {
  return { ok: false, code };
}

export function parseNumber(raw) {
  if (typeof raw !== "string") {
    return failure("INVALID_NUMBER");
  }
  if (raw.length > MAX_RAW_LENGTH) {
    return failure("INPUT_TOO_LONG");
  }

  const text = raw.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
  if (text === "") {
    return failure("EMPTY");
  }

  const match = NUMBER_PATTERN.exec(text);
  if (match === null || match[0] !== text) {
    return failure("INVALID_NUMBER");
  }

  const value = Number(text);
  if (!Number.isFinite(value)) {
    return failure("INVALID_NUMBER");
  }

  if (value === 0) {
    const exponentIndex = text.search(/[eE]/);
    const mantissa = exponentIndex === -1 ? text : text.slice(0, exponentIndex);
    if (/[1-9]/.test(mantissa)) {
      return failure("INPUT_RANGE");
    }
    return { ok: true, value };
  }

  const magnitude = Math.abs(value);
  if (magnitude < MIN_INPUT_MAGNITUDE || magnitude > MAX_INPUT_MAGNITUDE) {
    return failure("INPUT_RANGE");
  }

  return { ok: true, value };
}

export function formatNumber(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (value !== 0 && (
      Math.abs(value) < MIN_RESULT_MAGNITUDE ||
      Math.abs(value) > MAX_RESULT_MAGNITUDE
    ))
  ) {
    throw new RangeError("Number is outside the display range.");
  }
  if (value === 0) {
    return "0";
  }

  const rounded = Number(value.toPrecision(12));
  const magnitude = Math.abs(rounded);
  if (magnitude >= 1e12 || magnitude < 1e-6) {
    const [rawMantissa, rawExponent] = rounded.toExponential(11).split("e");
    const mantissa = rawMantissa.replace(/0+$/, "").replace(/\.$/, "");
    const exponent = Number(rawExponent);
    const exponentSign = exponent >= 0 ? "+" : "-";
    return `${mantissa}e${exponentSign}${Math.abs(exponent)}`;
  }

  const decimalPlaces = Math.max(0, 11 - Math.floor(Math.log10(magnitude)));
  const fixed = rounded.toFixed(decimalPlaces);
  if (!fixed.includes(".")) {
    return fixed;
  }
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}
