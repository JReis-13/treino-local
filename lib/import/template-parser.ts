import { isLocalDate } from "@/lib/dates";
import { cell, display, serialToDate, type SourceCell, type SourceSheet, type SourceSnapshot } from "@/lib/import/snapshot";
import type { CompletionMapping, ImportedTraining, ImportWarning, InstructionBlock, TrainingSource, TrainingWorkout } from "@/types/training";

const lines = (value: string): string[] => value.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean);
const simple = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();
const warn = (warnings: ImportWarning[], code: string, message: string, location: string, severity: ImportWarning["severity"] = "warning") =>
  warnings.push({ code, message, location, severity });

type TemplateVariant = "jonatha-v1" | "milena-v1";

function variantFor(sheet: SourceSheet): TemplateVariant {
  const equipmentI = simple(display(sheet, "I25")).includes("equipamento");
  const equipmentJ = simple(display(sheet, "J25")).includes("equipamento");
  if (equipmentI && !equipmentJ && /v[ií]deo/.test(simple(display(sheet, "J25")))) return "jonatha-v1";
  if (equipmentJ && /v[ií]deo/.test(simple(display(sheet, "K25")))) return "milena-v1";
  throw new Error(`${sheet.name}: equipment/video headers do not match a supported workbook layout.`);
}

function sourceDate(value: SourceCell | undefined): string | undefined {
  if (!value?.raw) return undefined;
  if (value.rawType === "n" || value.rawType === "") {
    const serial = Number(value.raw);
    if (!Number.isInteger(serial) || serial < 1) throw new Error(`Invalid completion date at ${value.ref}.`);
    return serialToDate(serial);
  }
  if (isLocalDate(value.raw)) return value.raw;
  throw new Error(`Completion date at ${value.ref} is not a valid date.`);
}

function completionGrid(sheet: SourceSheet, workoutId: string, warnings: ImportWarning[]) {
  const slots: string[] = [];
  const ordinals: string[] = [];
  const history: ImportedTraining["legacyCompletions"] = [];
  const rir: number[] = [];
  try {
    for (let row = 5; row <= 16; row++) {
      const ordinal = display(sheet, `D${row}`);
      if (!ordinal.startsWith(String(row - 4))) throw new Error(`completion ordinal D${row} changed`);
      const slot = `E${row}`;
      const dateCell = cell(sheet, slot);
      if (!dateCell || !/d/i.test(dateCell.numberFormat ?? "")) throw new Error(`date slot ${slot} is not identifiable`);
      slots.push(slot); ordinals.push(`D${row}`);
      const date = sourceDate(dateCell);
      if (date) {
        const calories = display(sheet, `F${row}`).trim();
        history.push({ id: `${workoutId}:${slot}:${date}`, workoutId, date, sourceSlot: slot, calories: calories || undefined });
      }
      const rirCell = display(sheet, `G${row}`).trim();
      if (rirCell && Number.isFinite(Number(rirCell))) rir.push(Number(rirCell));
    }
  } catch (error) {
    warn(warnings, "completion-grid", `Workout is usable locally, but source completion slots are uncertain: ${error instanceof Error ? error.message : "invalid grid"}.`, sheet.name, "syncBlocker");
    return { mapping: undefined, history: [] as typeof history, rir };
  }
  if (rir.length && rir.length !== 12) warn(warnings, "partial-rir", "RIR progression is incomplete; it is shown only as source context.", sheet.name, "info");
  return { mapping: { sheetName: sheet.name, sheetId: sheet.sheetId, slots, ordinalCells: ordinals } satisfies CompletionMapping, history, rir };
}

function loadValues(sheet: SourceSheet, row: number, count: number, warnings: ImportWarning[], variant: TemplateVariant): Array<string | undefined> {
  const values = (variant === "jonatha-v1" ? ["H"] : ["G", "H", "I"]).map((col) => cell(sheet, `${col}${row}`));
  const used = values.map((value) => value?.displayed.trim() || undefined);
  for (const value of values) {
    if (value?.raw && value.raw !== value.displayed && /[dm]/i.test(value.numberFormat ?? "")) {
      warn(warnings, "formatted-load", `Load is stored as a date-like number but displays as “${value.displayed}”; the displayed load was kept.`, `${sheet.name}!${value.ref}`);
    }
  }
  if (count === 1) return [used.find(Boolean)];
  const joined = used.find((value) => value?.includes("/"));
  if (count === 2 && joined && used.filter(Boolean).length === 1) {
    return joined.split("/").map((value) => value.trim() === "?" ? undefined : value.trim());
  }
  if (used.filter(Boolean).length === 1 && count > 1) {
    warn(warnings, "uncertain-load", "One load is shown for a multi-exercise group; its assignment needs review.", `${sheet.name}!G${row}:I${row}`);
  }
  return Array.from({ length: count }, (_, index) => used[index]);
}

function structuredWorkout(sheet: SourceSheet, id: string, warnings: ImportWarning[], rir: number[], variant: TemplateVariant): TrainingWorkout {
  if (!simple(display(sheet, "E18")).includes("aquecimento") || !simple(display(sheet, "E24")).includes("força")) {
    throw new Error(`${sheet.name}: supported warm-up/strength markers were not found.`);
  }
  const blocks: TrainingWorkout["blocks"] = [];
  for (let row = 20; row <= 22; row++) {
    const name = display(sheet, `E${row}`).trim();
    if (!name) throw new Error(`${sheet.name}: missing warm-up exercise at E${row}.`);
    blocks.push({ kind: "exercise", id: `${id}-warmup-${row}`, section: "Warm-up", name,
      prescription: display(sheet, `F${row}`).trim(), videoUrl: cell(sheet, `G${row}`)?.hyperlink, sourceCell: `E${row}` });
  }
  for (const row of variant === "jonatha-v1" ? [26, 28, 30, 32] : [26, 28, 30, 32, 33]) {
    const raw = lines(display(sheet, `E${row}`));
    if (raw.length === 0) continue;
    const challenge = variant === "milena-v1" && row === 33 && /desafio/i.test(raw[0]);
    if (row === 33 && !challenge) {
      warn(warnings, "unclassified-row", "A row after the strength groups was retained as a note rather than guessed as an exercise.", `${sheet.name}!E33`, "info");
      blocks.push({ kind: "instruction", id: `${id}-note-33`, section: "Notes", heading: "Training note", text: display(sheet, "E33"), sourceCell: "E33" });
      continue;
    }
    const names = challenge ? raw.slice(1) : raw;
    if (!names.length || names.length > 3) throw new Error(`${sheet.name}!E${row}: unsupported exercise group.`);
    const prescriptions = lines(display(sheet, `F${row}`));
    const equipmentCol = variant === "jonatha-v1" ? "I" : "J";
    const equipment = lines(display(sheet, `${equipmentCol}${row}`));
    const links = (variant === "jonatha-v1" ? ["J", "K"] : ["K", "L", "M"]).map((col) => cell(sheet, `${col}${row}`)?.hyperlink).filter((value): value is string => Boolean(value));
    const loads = loadValues(sheet, row, names.length, warnings, variant);
    if (prescriptions.length === 1 && names.length > 1) warn(warnings, "shared-prescription", "One prescription appears to apply to multiple exercises.", `${sheet.name}!F${row}`);
    if (prescriptions.length !== 1 && prescriptions.length !== names.length) warn(warnings, "prescription-count", "Prescription lines do not match exercise names; review the displayed workout before use.", `${sheet.name}!F${row}`, "warning");
    if (equipment.length === 1 && names.length > 1) warn(warnings, "shared-equipment", "One equipment entry may apply to the whole group.", `${sheet.name}!${equipmentCol}${row}`, "info");
    if (equipment.length > 1 && equipment.length !== names.length) warn(warnings, "equipment-count", "Equipment lines do not match exercise names.", `${sheet.name}!${row}`);
    if (links.length < names.length) warn(warnings, "missing-video", "Fewer video links than exercises; verify this group.", `${sheet.name}!${row}`, "warning");
    if (links.length > names.length) warn(warnings, "extra-video", "More video links than exercises; additional reference links were not assigned.", `${sheet.name}!${row}`);
    names.forEach((name, index) => blocks.push({ kind: "exercise", id: `${id}-${challenge ? "challenge" : "strength"}-${row}-${index + 1}`,
      section: challenge ? "Challenge" : "Strength", name, prescription: prescriptions[index] ?? prescriptions[0] ?? "",
      equipment: equipment[index] ?? (equipment.length === 1 && (variant !== "jonatha-v1" || equipment[0] === "Polia") ? equipment[0] : undefined), defaultLoad: loads[index],
      videoUrl: links[index], groupId: names.length > 1 ? `${id}-group-${row}` : undefined, sourceCell: `E${row}` }));
  }
  for (let row = 34; row <= (variant === "milena-v1" ? 45 : 33); row++) {
    const note = display(sheet, `E${row}`).trim();
    if (note) blocks.push({ kind: "instruction", id: `${id}-note-${row}`, section: "Notes", heading: "Training note", text: note, sourceCell: `E${row}` });
  }
  return { id, title: id === "Cardio" ? "Workout Cardio" : `Workout ${id}`, description: display(sheet, "B5").trim(),
    duration: display(sheet, "B7").trim(), restNote: display(sheet, "B9").trim(), rirByOccurrence: rir, blocks };
}

function instructionWorkout(sheet: SourceSheet, id: string): TrainingWorkout {
  const blocks: InstructionBlock[] = [];
  for (const row of [18, 20, 22]) {
    const raw = display(sheet, `E${row}`).trim();
    if (!raw) continue;
    const [heading, ...rest] = raw.split(/\r?\n/);
    blocks.push({ kind: "instruction", id: `${id}-instruction-${row}`, section: "Cardio plan", heading: heading.trim(),
      text: rest.join("\n").trim(), sourceCell: `E${row}` });
  }
  if (blocks.length === 0) throw new Error(`${sheet.name}: no supported instruction blocks were found.`);
  return { id, title: "Workout Cardio", description: display(sheet, "B5").trim(), duration: display(sheet, "B7").trim(),
    restNote: display(sheet, "B9").trim(), blocks };
}

function fingerprint(input: unknown): string {
  const text = JSON.stringify(input); let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseTrainingSnapshot(snapshot: SourceSnapshot, source: TrainingSource, name: string): ImportedTraining {
  const sheets = snapshot.sheets.filter((sheet) => /^TREINO\s/i.test(sheet.name));
  if (!sheets.length || sheets.length > 8) throw new Error("This spreadsheet format is not a supported workout template.");
  const warnings: ImportWarning[] = [];
  const workouts: TrainingWorkout[] = [];
  const legacyCompletions: ImportedTraining["legacyCompletions"] = [];
  const mappings: Record<string, CompletionMapping> = {};
  let template: TemplateVariant | undefined;
  for (const sheet of sheets) {
    if (!simple(display(sheet, "C1")).includes("plano de treino") || !simple(display(sheet, "E4")).includes("dias de treino")) {
      throw new Error(`${sheet.name}: workbook markers do not match the supported template family.`);
    }
    const id = sheet.name.replace(/^TREINO\s+/i, "").trim();
    if (!id || workouts.some((workout) => workout.id === id)) throw new Error(`Duplicate or missing workout name: ${sheet.name}.`);
    const isInstruction = !simple(display(sheet, "E18")).includes("aquecimento") && /semana/i.test(display(sheet, "E18"));
    const variant = isInstruction ? template ?? "milena-v1" : variantFor(sheet);
    if (template && template !== variant && !isInstruction) throw new Error("Workout sheets use incompatible known layouts.");
    if (!template) template = variant;
    const grid = completionGrid(sheet, id, warnings);
    if (grid.mapping) mappings[id] = grid.mapping;
    legacyCompletions.push(...grid.history);
    try {
      workouts.push(isInstruction ? instructionWorkout(sheet, id) : structuredWorkout(sheet, id, warnings, grid.rir, variant));
    } catch (error) {
      warn(warnings, "workout-content", error instanceof Error ? error.message : "Workout content could not be identified.", sheet.name, "activationBlocker");
    }
  }
  const nextSource = source.kind === "builtin" ? source : { ...source, template: template ?? "unknown", mappings };
  return { name, source: nextSource, sourceFingerprint: fingerprint({ workouts, mappings }), workouts, warnings, legacyCompletions };
}
