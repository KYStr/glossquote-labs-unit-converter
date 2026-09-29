import { convert } from "./core/convert.mjs";
import { formatNumber, parseNumber } from "./core/numbers.mjs";
import { CATEGORIES, CATEGORIES_BY_ID, DEFAULT_UNIT_PAIRS, UNITS_BY_ID } from "./core/units.mjs";
import {
  formatUnitLabel,
  getCategoryLabel,
  getErrorMessage,
  getLocalizedFormula,
  getMessages,
} from "./i18n.mjs";

const language = document.documentElement.lang;
const messages = getMessages(language);

const form = document.querySelector("#converter-form");
const controls = document.querySelector("#converter-controls");
const categorySelect = document.querySelector("#category-select");
const numberInput = document.querySelector("#number-input");
const sourceSelect = document.querySelector("#source-unit");
const targetSelect = document.querySelector("#target-unit");
const swapButton = document.querySelector("#swap-units");
const clearButton = document.querySelector("#clear-input");
const resultOutput = document.querySelector("#conversion-result");
const precisionNote = document.querySelector("#precision-note");
const formulaText = document.querySelector("#formula-text");
const numberError = document.querySelector("#number-error");
const unitError = document.querySelector("#unit-error");
const statusMessage = document.querySelector("#conversion-status");
const unsupportedNote = document.querySelector("#unsupported-note");

let currentState = "unsupported";
let isActive = false;

function makeOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function fillCategoryOptions() {
  const options = document.createDocumentFragment();
  for (const category of CATEGORIES) {
    options.append(makeOption(category.id, getCategoryLabel(language, category.id)));
  }
  categorySelect.replaceChildren(options);
}

function fillUnitOptions(select, categoryId, selectedId) {
  const category = CATEGORIES_BY_ID[categoryId];
  const options = document.createDocumentFragment();
  if (category !== undefined) {
    for (const unit of category.units) {
      options.append(makeOption(unit.id, formatUnitLabel(language, unit.id)));
    }
  }
  select.replaceChildren(options);
  select.value = selectedId;
}

function resetUnitOptions() {
  const categoryId = categorySelect.value;
  const category = CATEGORIES_BY_ID[categoryId];
  if (category === undefined) {
    fillUnitOptions(sourceSelect, categoryId, "");
    fillUnitOptions(targetSelect, categoryId, "");
    return;
  }

  const defaults = DEFAULT_UNIT_PAIRS[categoryId];
  fillUnitOptions(sourceSelect, categoryId, defaults.from);
  fillUnitOptions(targetSelect, categoryId, defaults.to);
}

function clearErrors() {
  numberError.textContent = "";
  numberError.hidden = true;
  unitError.textContent = "";
  unitError.hidden = true;

  numberInput.setAttribute("aria-describedby", "number-help");
  numberInput.setAttribute("aria-invalid", "false");
  categorySelect.setAttribute("aria-describedby", "category-help");
  categorySelect.setAttribute("aria-invalid", "false");
  sourceSelect.setAttribute("aria-describedby", "source-help");
  sourceSelect.setAttribute("aria-invalid", "false");
  targetSelect.setAttribute("aria-describedby", "target-help");
  targetSelect.setAttribute("aria-invalid", "false");
}

function clearResult() {
  resultOutput.textContent = "—";
  precisionNote.hidden = true;
  formulaText.textContent = "";
  formulaText.hidden = true;
}

function setState(state, message, announceSameState = false) {
  const changed = state !== currentState;
  currentState = state;
  statusMessage.classList.toggle("visually-hidden", state !== "empty");
  if (changed || announceSameState) {
    statusMessage.textContent = message;
  }
}

function showNumberError(code) {
  const message = getErrorMessage(language, code);
  numberError.textContent = message;
  numberError.hidden = false;
  numberInput.setAttribute("aria-describedby", "number-help number-error");
  numberInput.setAttribute("aria-invalid", "true");
  return message;
}

function showUnitError(code) {
  const category = CATEGORIES_BY_ID[categorySelect.value];
  let field = sourceSelect;
  let helpId = "source-help";

  if (category === undefined) {
    field = categorySelect;
    helpId = "category-help";
  } else {
    const source = UNITS_BY_ID[sourceSelect.value];
    const target = UNITS_BY_ID[targetSelect.value];
    if (source === undefined || source.categoryId !== category.id) {
      field = sourceSelect;
      helpId = "source-help";
    } else if (target === undefined || target.categoryId !== category.id) {
      field = targetSelect;
      helpId = "target-help";
    }
  }

  const message = getErrorMessage(language, code);
  unitError.textContent = message;
  unitError.hidden = false;
  field.setAttribute("aria-describedby", `${helpId} unit-error`);
  field.setAttribute("aria-invalid", "true");
  return message;
}

function render(announceSameState = false) {
  clearResult();
  clearErrors();

  const parsed = parseNumber(numberInput.value);
  if (!parsed.ok) {
    if (parsed.code === "EMPTY") {
      setState("empty", messages.emptyPrompt, announceSameState);
      return;
    }

    const message = showNumberError(parsed.code);
    setState("invalid", message, announceSameState);
    return;
  }

  const conversion = convert({
    category: categorySelect.value,
    from: sourceSelect.value,
    to: targetSelect.value,
    value: parsed.value,
  });
  if (!conversion.ok) {
    const message = conversion.code === "UNKNOWN_UNIT" || conversion.code === "UNIT_MISMATCH"
      ? showUnitError(conversion.code)
      : showNumberError(conversion.code);
    setState("invalid", message, announceSameState);
    return;
  }

  const source = UNITS_BY_ID[sourceSelect.value];
  const target = UNITS_BY_ID[targetSelect.value];
  const resultText = `${String(parsed.value)} ${source.symbol} ${messages.resultApproximately} ${formatNumber(conversion.value)} ${target.symbol}`;
  resultOutput.textContent = resultText;
  precisionNote.hidden = false;
  formulaText.textContent = getLocalizedFormula(language, sourceSelect.value, targetSelect.value);
  formulaText.hidden = false;
  setState("valid", resultText, announceSameState);
}

function handleInput() {
  render();
}

function handleFieldChange() {
  render(true);
}

function handleCategoryChange() {
  clearResult();
  clearErrors();
  numberInput.value = "";
  resetUnitOptions();
  render(true);
}

function handleSwap() {
  clearResult();
  clearErrors();
  const source = sourceSelect.value;
  sourceSelect.value = targetSelect.value;
  targetSelect.value = source;
  render(true);
}

function handleClear() {
  clearResult();
  clearErrors();
  numberInput.value = "";
  render(true);
  numberInput.focus();
}

function preventSubmission(event) {
  event.preventDefault();
}

function activate() {
  if (isActive) return;

  fillCategoryOptions();
  categorySelect.value = CATEGORIES[0].id;
  resetUnitOptions();
  numberInput.value = "";

  form.addEventListener("submit", preventSubmission);
  categorySelect.addEventListener("change", handleCategoryChange);
  numberInput.addEventListener("input", handleInput);
  numberInput.addEventListener("change", handleFieldChange);
  sourceSelect.addEventListener("change", handleFieldChange);
  targetSelect.addEventListener("change", handleFieldChange);
  swapButton.addEventListener("click", handleSwap);
  clearButton.addEventListener("click", handleClear);

  isActive = true;
  render(true);
  controls.disabled = false;
  unsupportedNote.hidden = true;
}

function deactivate() {
  if (!isActive) return;

  form.removeEventListener("submit", preventSubmission);
  categorySelect.removeEventListener("change", handleCategoryChange);
  numberInput.removeEventListener("input", handleInput);
  numberInput.removeEventListener("change", handleFieldChange);
  sourceSelect.removeEventListener("change", handleFieldChange);
  targetSelect.removeEventListener("change", handleFieldChange);
  swapButton.removeEventListener("click", handleSwap);
  clearButton.removeEventListener("click", handleClear);

  numberInput.value = "";
  categorySelect.value = CATEGORIES[0].id;
  resetUnitOptions();
  clearErrors();
  clearResult();
  statusMessage.textContent = "";
  statusMessage.classList.add("visually-hidden");
  currentState = "unsupported";
  controls.disabled = true;
  unsupportedNote.hidden = false;
  isActive = false;
}

window.addEventListener("pageshow", activate);
window.addEventListener("pagehide", deactivate);
activate();
