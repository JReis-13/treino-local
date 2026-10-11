const KEY = "treino-local:diagnostic-receipts:v1";
const CODE = /^TL-[A-HJ-NP-Z2-9]{8}$/;
export type DiagnosticReceipt = { code: string; sentAt: string; result: "sent"; buildId: string };

function valid(value: unknown): value is DiagnosticReceipt {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.code === "string" && CODE.test(row.code) &&
    typeof row.sentAt === "string" && Number.isFinite(Date.parse(row.sentAt)) &&
    row.result === "sent" && typeof row.buildId === "string" && row.buildId.length <= 64;
}

export function readDiagnosticReceipts(storage: Pick<Storage, "getItem"> = localStorage): DiagnosticReceipt[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(valid).slice(0, 8) : [];
  } catch { return []; }
}

export function rememberDiagnosticReceipt(receipt: DiagnosticReceipt,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage): DiagnosticReceipt[] {
  if (!valid(receipt)) throw new Error("Invalid diagnostic receipt.");
  const recent = [receipt, ...readDiagnosticReceipts(storage).filter((item) => item.code !== receipt.code)].slice(0, 8);
  storage.setItem(KEY, JSON.stringify(recent));
  return recent;
}
