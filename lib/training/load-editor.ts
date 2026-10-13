export function loadEditorModel(value = "") {
  const match = /^\s*([+-]?\d+(?:[.,]\d+)?)(\s*(?:kg|lbs?|g))?\s*$/i.exec(value);
  return match ? { mode: "number" as const, text: match[1], unit: match[2] ?? "" } :
    value.trim() ? { mode: "text" as const, text: value, unit: "" } : { mode: "number" as const, text: "", unit: "" };
}

export function confirmedLoad(text: string, base: string, mode: "number" | "text"): string | undefined {
  if (mode === "text") return text.trim();
  if (!text.trim()) return "";
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(text.trim())) return undefined;
  return text.trim().replace(",", ".") + loadEditorModel(base).unit;
}
