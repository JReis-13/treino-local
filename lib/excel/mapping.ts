import type { WorkoutId } from "@/types/workout";

export const DATE_SLOTS = Array.from({ length: 12 }, (_, index) => `E${index + 5}`);

export const EXCEL_MAPPING: Record<WorkoutId, {
  sheet: string;
  counterCell: string;
  counterFormula: string;
}> = {
  A: { sheet: "TREINO A", counterCell: "I11", counterFormula: "COUNT('TREINO A'!E5:E16)" },
  B: { sheet: "TREINO B", counterCell: "I12", counterFormula: "COUNT('TREINO B'!E5:E16)" },
};

export const SOURCE_WORKBOOK_SHA256 = "B3B8CCF292F13AA8DF5646F9838FAE70DFA4677CB6DB80ED833C5B787D31748F";
