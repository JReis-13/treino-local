import { shareDate, shareMetrics, type WorkoutShareSummary } from "@/lib/training/share-summary";
import { canvasBlob, decodeShareImage } from "@/lib/training/share-photo";

export const SHARE_CARD_SIZE = 1080;

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function nameLines(name: string, limit = 21, maxLines = 3): string[] {
  const words = name.trim().replace(/\s+/g, " ").split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const chunks = Array.from(word).reduce<string[]>((parts, character) => {
      if (!parts.length || Array.from(parts[parts.length - 1]).length >= limit) parts.push(character);
      else parts[parts.length - 1] += character;
      return parts;
    }, []);
    for (const chunk of chunks) {
      if (line && Array.from(`${line} ${chunk}`).length > limit) { lines.push(line); line = ""; }
      line = line ? `${line} ${chunk}` : chunk;
    }
  }
  if (line) lines.push(line);
  if (!lines.length) lines.push("Workout");
  if (lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    clipped[maxLines - 1] = `${Array.from(clipped[maxLines - 1]).slice(0, limit - 1).join("")}…`;
    return clipped;
  }
  return lines;
}

export function createShareCardSvg(summary: WorkoutShareSummary): string {
  const lines = nameLines(summary.workoutName);
  const title = lines.map((line, index) => `<tspan x="96" dy="${index ? 82 : 0}">${escapeXml(line)}</tspan>`).join("");
  const metrics: string[] = [];
  if (summary.durationMinutes !== undefined) metrics.push(`<text x="100" y="${lines.length > 2 ? 725 : 648}" font-size="104" font-weight="800" fill="#17312b">${summary.durationMinutes === 0 ? "&lt;1" : summary.durationMinutes}<tspan font-size="34" dx="13">MIN</tspan></text>`);
  if (summary.completedExercises !== undefined && summary.totalExercises !== undefined) metrics.push(`<text x="100" y="${lines.length > 2 ? 806 : 750}" font-size="42" font-weight="700" fill="#245a4c">${summary.completedExercises} / ${summary.totalExercises} exercises</text>`);
  const date = escapeXml(shareDate(summary.localDate).toUpperCase());
  const dateText = metrics.length ? `<text x="100" y="921" font-family="Arial, sans-serif" font-size="32" font-weight="700" letter-spacing="3" fill="#59736a">${date}</text>`
    : `<text x="100" y="752" font-family="Arial, sans-serif" font-size="58" font-weight="700" letter-spacing="2" fill="#245a4c">${date}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-label="Workout sharing card"><rect width="1080" height="1080" fill="#f5f7f2"/><rect x="40" y="40" width="1000" height="1000" rx="56" fill="#fff" stroke="#dce9e0" stroke-width="3"/><rect x="40" y="40" width="1000" height="22" rx="11" fill="#168658"/><text x="100" y="145" font-family="Arial, sans-serif" font-size="31" font-weight="800" letter-spacing="6" fill="#176b51">TREINO LOCAL</text><circle cx="145" cy="291" r="49" fill="#d9f0e4"/><path d="M121 290l16 16 32-35" fill="none" stroke="#168658" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><text x="100" y="421" font-family="Arial, sans-serif" font-size="68" font-weight="800" fill="#17312b">${title}</text><g font-family="Arial, sans-serif">${metrics.join("")}</g><line x1="100" y1="852" x2="980" y2="852" stroke="#dce9e0" stroke-width="3"/>${dateText}<text x="100" y="980" font-family="Arial, sans-serif" font-size="27" fill="#59736a">Workout complete</text></svg>`;
}

function photoTitleLines(context: CanvasRenderingContext2D, name: string): string[] {
  const characters = Array.from(name.trim().replace(/\s+/g, " ") || "Workout");
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < characters.length; index++) {
    const next = current + characters[index];
    if (context.measureText(next).width <= 845) { current = next; continue; }
    if (lines.length === 1) {
      while (context.measureText(`${current}…`).width > 845) current = Array.from(current).slice(0, -1).join("");
      return [lines[0], `${current.trimEnd()}…`];
    }
    lines.push(current.trimEnd() || characters[index]);
    current = current ? characters[index] : "";
  }
  if (current) lines.push(current.trimEnd());
  return lines.slice(0, 2);
}

async function createPhotoCardFile(summary: WorkoutShareSummary, photo: Blob): Promise<File> {
  const decoded = await decodeShareImage(photo);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SHARE_CARD_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image export is unavailable on this device.");
    context.fillStyle = "#f5f7f2";
    context.fillRect(0, 0, SHARE_CARD_SIZE, SHARE_CARD_SIZE);
    context.fillStyle = "#fff";
    context.beginPath();
    context.roundRect(40, 40, 1000, 1000, 56);
    context.fill();
    context.save();
    context.beginPath();
    context.roundRect(40, 40, 1000, 1000, 56);
    context.clip();
    const width = 1000; const height = 550;
    const sourceRatio = Math.max(width / decoded.width, height / decoded.height);
    const cropWidth = width / sourceRatio;
    const cropHeight = height / sourceRatio;
    context.drawImage(decoded.source, (decoded.width - cropWidth) / 2, (decoded.height - cropHeight) / 2,
      cropWidth, cropHeight, 40, 40, width, height);
    context.restore();
    context.fillStyle = "#d9f0e4";
    context.beginPath(); context.arc(113, 675, 32, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#168658"; context.lineWidth = 9; context.lineCap = "round"; context.lineJoin = "round";
    context.beginPath(); context.moveTo(98, 674); context.lineTo(109, 685); context.lineTo(130, 663); context.stroke();
    context.fillStyle = "#17312b";
    context.font = "800 64px Arial, sans-serif";
    const lines = photoTitleLines(context, summary.workoutName);
    lines.forEach((line, index) => context.fillText(line, 165, 697 + index * 70));
    context.fillStyle = "#245a4c";
    context.font = "700 40px Arial, sans-serif";
    const metrics = shareMetrics(summary);
    if (metrics) context.fillText(metrics, 90, lines.length > 1 ? 838 : 795, 900);
    context.fillStyle = "#59736a";
    context.font = "700 32px Arial, sans-serif";
    context.fillText(shareDate(summary.localDate).toUpperCase(), 90, metrics ? 906 : 838);
    context.strokeStyle = "#dce9e0"; context.lineWidth = 3;
    context.beginPath(); context.moveTo(90, 934); context.lineTo(990, 934); context.stroke();
    context.fillStyle = "#176b51";
    context.font = "800 29px Arial, sans-serif";
    context.fillText("TREINO LOCAL", 90, 991);
    const blob = await canvasBlob(canvas, "image/png");
    return new File([blob], "treino-local-workout.png", { type: "image/png" });
  } finally {
    decoded.close();
  }
}

export async function createShareCardFile(summary: WorkoutShareSummary, photo?: Blob): Promise<File> {
  if (photo) return createPhotoCardFile(summary, photo);
  const svg = createShareCardSvg(summary);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SHARE_CARD_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image export is unavailable on this device.");
    context.drawImage(image, 0, 0, SHARE_CARD_SIZE, SHARE_CARD_SIZE);
    const blob = await canvasBlob(canvas, "image/png");
    return new File([blob], "treino-local-workout.png", { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
