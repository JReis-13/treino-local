import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { socialDb } from "@/lib/social/db";
import { sanitizeDebugReport } from "@/lib/diagnostics-upload";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function reportCode(): string {
  return "TL-" + [...randomBytes(8)].map((byte) => alphabet[byte & 31]).join("");
}

export async function storeDiagnosticReport(userId: string, raw: unknown): Promise<string> {
  const report = sanitizeDebugReport(raw);
  const sql = socialDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = reportCode();
    try {
      await sql.begin(async (tx) => {
        await tx`delete from treino_support.diagnostic_reports where expires_at <= now()`;
        await tx`insert into treino_support.diagnostic_reports
          (id, report_code, user_id, debug_report_version, build_id, report, expires_at)
          values (${randomUUID()}, ${code}, ${userId}, 1, ${String((report.app as Record<string, unknown>).buildId ?? "") || null},
            ${tx.json(JSON.parse(JSON.stringify(report)))}, now() + interval '14 days')`;
        await tx`delete from treino_support.diagnostic_reports where user_id = ${userId}
          and id not in (select id from treino_support.diagnostic_reports where user_id = ${userId}
            order by created_at desc, id desc limit 20)`;
      });
      return code;
    } catch (cause) {
      if ((cause as { code?: string }).code !== "23505" || attempt === 2) throw cause;
    }
  }
  throw new Error("Could not allocate a diagnostic report code.");
}
