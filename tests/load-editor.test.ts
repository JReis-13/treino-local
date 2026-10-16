import assert from "node:assert/strict";
import test from "node:test";
import { confirmedLoad, loadEditorModel } from "../lib/training/load-editor";

test("simple numeric loads separate units, preserve unit spelling and accept both decimal separators", () => {
  assert.deepEqual(loadEditorModel("12kg"), { mode: "number", text: "12", unit: "kg" });
  assert.deepEqual(loadEditorModel("12,5 kg"), { mode: "number", text: "12,5", unit: " kg" });
  assert.equal(confirmedLoad("13,5", "12kg", "number"), "13.5kg");
  assert.equal(confirmedLoad("13.5", "12,5 KG", "number"), "13.5 KG");
  assert.equal(confirmedLoad("12,", "12kg", "number"), undefined);
  assert.equal(confirmedLoad("12kg", "12kg", "number"), "12kg");
  assert.equal(confirmedLoad("", "12kg", "number"), "");
});
test("composite expressions, embedded notes and unknown units are never reduced to a guessed number", () => {
  for (const value of ["2x8kg", "20kg (17,5 no final)", "12 plates", "bodyweight + 5kg"])
    assert.deepEqual(loadEditorModel(value), { mode: "text", text: value, unit: "" });
  assert.equal(confirmedLoad("20kg (17,5 no final)", "", "text"), "20kg (17,5 no final)");
  assert.equal(loadEditorModel("").mode, "number");
  assert.equal(confirmedLoad("16,5", "16", "number"), "16.5");
});

test("new fields accept supported units directly while composite input requires explicit text mode", () => {
  assert.equal(confirmedLoad("12kg", "", "number"), "12kg");
  assert.equal(confirmedLoad("12,5 kg", "", "number"), "12.5 kg");
  assert.equal(confirmedLoad("14lb", "12kg", "number"), "14lb");
  assert.equal(confirmedLoad("2x8kg", "", "number"), undefined);
  assert.equal(confirmedLoad("20kg (17,5 no final)", "", "text"), "20kg (17,5 no final)");
});
