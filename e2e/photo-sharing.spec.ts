import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { transform } from "esbuild";
import { fixturePath } from "../tests/fixture-path";

async function importPlan(page: Page) {
  await page.goto("/plans/?source=excel");
  await expect(page.getByRole("heading", { name: "Add training." })).toBeVisible();
  const direct = await page.evaluate(() => window.isSecureContext && "showOpenFilePicker" in window);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: direct ? "Import as safe copy" : "Choose workbook" }).tap();
  await (await chooser).setFiles(fixturePath("TREINO 1 JONATHA.xlsx"));
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await page.locator(".review-card").getByRole("button", { name: /Use this training/ }).tap();
}

async function completeWorkout(page: Page) {
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  await page.getByRole("checkbox", { name: /Complete Agachamento goblet/ }).tap();
  await page.getByRole("link", { name: /Finish workout/ }).tap();
  await page.getByRole("button", { name: /Save workout/ }).tap();
  await expect(page.getByRole("heading", { name: /Workout completed/ })).toBeVisible();
}

async function raster(page: Page, width: number, height: number, color: string, mimeType = "image/png"): Promise<Buffer> {
  const base64 = await page.evaluate(({ width, height, color, mimeType }) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = color; context.fillRect(0, 0, width, height);
    return canvas.toDataURL(mimeType, 0.9).split(",")[1];
  }, { width, height, color, mimeType });
  return Buffer.from(base64, "base64");
}

async function choosePhoto(page: Page, buffer: Buffer, name: string, mimeType = "image/png") {
  await page.getByLabel("Choose workout photo").setInputFiles({ name, mimeType, buffer });
  await expect(page.getByText("Photo selected for this share only.")).toBeVisible();
  await expect(page.locator(".share-card-preview img")).toHaveAttribute("src", /^blob:/);
}

test("portrait, landscape, and square photos stay transient and share as a local PNG", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const state = window as unknown as { photoShares: Array<{ text: string; type?: string; width?: number; height?: number; center?: number[] }> };
    state.photoShares = [];
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (data: ShareData) => Boolean(data.files?.length) });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => {
      const file = data.files?.[0];
      const bitmap = file ? await createImageBitmap(file) : undefined;
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1080;
      const context = canvas.getContext("2d")!;
      if (bitmap) context.drawImage(bitmap, 0, 0);
      state.photoShares.push({ text: data.text ?? "", type: file?.type, width: bitmap?.width, height: bitmap?.height,
        center: bitmap ? Array.from(context.getImageData(540, 300, 1, 1).data) : undefined });
      bitmap?.close();
    } });
  });
  await importPlan(page);
  await completeWorkout(page);
  const storedBefore = await page.evaluate(() => localStorage.getItem("treino-local:v2"));
  const requests: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") requests.push(request.url()); });
  const message = page.getByRole("textbox", { name: /MESSAGE/ });
  await message.fill("Edited once, kept through photo changes 💪");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole("button", { name: /Download card|Save image/i })).toHaveCount(0);
  await expect(page.getByLabel("Choose workout photo")).toHaveAttribute("accept", "image/*");
  const photos = [
    { name: "portrait.png", width: 700, height: 1100, color: "#dc2828", expected: [220, 40, 40] },
    { name: "landscape.png", width: 1100, height: 700, color: "#2828dc", expected: [40, 40, 220] },
    { name: "square.png", width: 900, height: 900, color: "#28b428", expected: [40, 180, 40] },
  ];
  let previousPreviewUrl: string | undefined;
  for (const [index, photo] of photos.entries()) {
    await choosePhoto(page, await raster(page, photo.width, photo.height, photo.color), photo.name);
    const previewUrl = await page.locator(".share-card-preview img").getAttribute("src");
    if (previousPreviewUrl) await expect.poll(() => page.evaluate(async (url) => {
      try { await fetch(url); return true; } catch { return false; }
    }, previousPreviewUrl!)).toBe(false);
    previousPreviewUrl = previewUrl!;
    await expect(message).toHaveValue("Edited once, kept through photo changes 💪");
    if (index === 0 && testInfo.project.name === "Narrow phone Chrome") await page.screenshot({ path: testInfo.outputPath("photo-share-320.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Share workout" }).tap();
    await expect.poll(() => page.evaluate(() => (window as unknown as { photoShares: unknown[] }).photoShares.length)).toBe(index + 1);
    const shared = await page.evaluate((position) => (window as unknown as { photoShares: Array<{ text: string; type: string; width: number; height: number; center: number[] }> }).photoShares[position], index);
    expect(shared.text).toBe("Edited once, kept through photo changes 💪");
    expect([shared.type, shared.width, shared.height]).toEqual(["image/png", 1080, 1080]);
    shared.center!.slice(0, 3).forEach((channel, position) => expect(Math.abs(channel - photo.expected[position])).toBeLessThanOrEqual(8));
  }
  await page.getByRole("button", { name: "Remove photo" }).tap();
  await expect(page.getByText("Add photo")).toBeVisible();
  await expect(page.locator(".share-card-preview img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await expect.poll(() => page.evaluate(async (url) => {
    try { await fetch(url); return true; } catch { return false; }
  }, previousPreviewUrl!)).toBe(false);
  await expect(message).toHaveValue("Edited once, kept through photo changes 💪");
  expect(await page.evaluate(() => localStorage.getItem("treino-local:v2"))).toBe(storedBefore);
  expect(requests).toEqual([]);
  await page.getByRole("link", { name: "Not now" }).tap();
  await page.locator(".history-list a.history-card").first().tap();
  await page.getByRole("link", { name: "Share workout" }).tap();
  await expect(page.getByText("Add photo")).toBeVisible();
  await choosePhoto(page, await raster(page, 800, 800, "#28b428"), "history.png");
  await page.getByRole("link", { name: "Cancel" }).tap();
  await page.getByRole("link", { name: "Share workout" }).tap();
  await expect(page.getByText("Add photo")).toBeVisible();
  await page.getByRole("link", { name: "Cancel" }).tap();
  await page.getByRole("link", { name: "Settings", exact: true }).tap();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).tap();
  const backup = JSON.parse(await readFile(await (await download).path(), "utf8"));
  expect(JSON.stringify(backup)).not.toContain("data:image/");
  expect(backup.data.sessions[0]).not.toHaveProperty("photo");
});

test("invalid, unreadable, and oversized selections return to the normal card", async ({ page }, testInfo) => {
  await importPlan(page);
  await completeWorkout(page);
  const input = page.getByLabel("Choose workout photo");
  await input.setInputFiles([]);
  await expect(page.getByText("Add photo")).toBeVisible();
  await input.setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.getByText(/Choose a JPEG/)).toBeVisible();
  await expect(page.locator(".share-card-preview img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await input.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not a PNG") });
  await expect(page.getByText(/could not be read/)).toBeVisible();
  if (testInfo.project.name === "Pixel 7 Chrome") {
    await input.setInputFiles({ name: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(30 * 1024 * 1024 + 1) });
    await expect(page.getByText(/under 30 MB/)).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Share workout" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Download card|Save image/i })).toHaveCount(0);
});

test("one tap makes one activation-safe image share attempt and a fresh tap retries as text", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { shareAttempts: Array<{ active: boolean; text: string; fileType?: string; fileSize?: number; signature?: number[] }>; capabilityChecks: Array<{ files: boolean; text: string }>; shareMode: "reject" | "fileOnly" };
    state.shareAttempts = []; state.capabilityChecks = []; state.shareMode = "reject";
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (data: ShareData) => {
      state.capabilityChecks.push({ files: Boolean(data.files?.length), text: data.text ?? "" });
      return Boolean(data.files?.length && (state.shareMode === "fileOnly" ? !data.text : data.text));
    } });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => {
      const file = data.files?.[0];
      const active = navigator.userActivation.isActive;
      const signature = file ? Array.from(new Uint8Array(await file.slice(0, 8).arrayBuffer())) : undefined;
      state.shareAttempts.push({ active, text: data.text ?? "", fileType: file?.type, fileSize: file?.size, signature });
      if (file && state.shareMode === "reject") throw new DOMException("Image target rejected", "NotAllowedError");
    } });
  });
  await importPlan(page);
  await completeWorkout(page);
  await choosePhoto(page, await raster(page, 700, 900, "#2859bb"), "activation.png");
  await page.getByRole("textbox", { name: /MESSAGE/ }).fill("Edited workout text 💪");
  await page.getByRole("button", { name: "Share workout" }).tap();
  await expect(page.getByRole("button", { name: "Share text instead" })).toBeVisible();
  let state = await page.evaluate(() => ({ attempts: (window as unknown as { shareAttempts: unknown[] }).shareAttempts,
    checks: (window as unknown as { capabilityChecks: unknown[] }).capabilityChecks }));
  expect(state.attempts).toHaveLength(1);
  expect(state.attempts[0]).toMatchObject({ active: true, text: "Edited workout text 💪", fileType: "image/png", signature: [137, 80, 78, 71, 13, 10, 26, 10] });
  expect((state.attempts[0] as { fileSize: number }).fileSize).toBeGreaterThan(1000);
  expect(state.checks[0]).toEqual({ files: true, text: "Edited workout text 💪" });
  await page.getByRole("button", { name: "Share text instead" }).tap();
  state = await page.evaluate(() => ({ attempts: (window as unknown as { shareAttempts: unknown[] }).shareAttempts,
    checks: (window as unknown as { capabilityChecks: unknown[] }).capabilityChecks }));
  expect(state.attempts).toHaveLength(2);
  expect(state.attempts[1]).toMatchObject({ active: true, text: "Edited workout text 💪" });
  expect((state.attempts[1] as { fileType?: string }).fileType).toBeUndefined();
  await expect(page.getByText("Share sheet closed. Your workout remains saved.")).toBeVisible();
  await page.evaluate(() => { (window as unknown as { shareMode: string }).shareMode = "fileOnly"; });
  await choosePhoto(page, await raster(page, 800, 700, "#238e62"), "file-only.png");
  await page.getByRole("button", { name: "Share workout" }).tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shareAttempts: unknown[] }).shareAttempts.length)).toBe(3);
  state = await page.evaluate(() => ({ attempts: (window as unknown as { shareAttempts: unknown[] }).shareAttempts,
    checks: (window as unknown as { capabilityChecks: unknown[] }).capabilityChecks }));
  expect(state.attempts).toHaveLength(3);
  expect(state.attempts[2]).toMatchObject({ active: true, text: "", fileType: "image/png" });
  expect(state.checks.slice(-2)).toEqual([{ files: true, text: "Edited workout text 💪" }, { files: true, text: "" }]);
  await expect(page.getByText("Image sharing opened. This device could not include the workout text.")).toBeVisible();
});

test("photo processing bounds large dimensions and honors browser EXIF orientation", async ({ page }) => {
  await page.goto("/");
  const source = await readFile(resolve("lib/training/share-photo.ts"), "utf8");
  const bundle = await transform(source, { loader: "ts", format: "iife", globalName: "SharePhotoTest" });
  await page.addScriptTag({ content: bundle.code });
  const resized = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 3600; canvas.height = 2400;
    const context = canvas.getContext("2d")!; context.fillStyle = "#5599cc"; context.fillRect(0, 0, 3600, 2400);
    const original = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
    const photo = await (window as unknown as { SharePhotoTest: { processSharePhoto(file: File): Promise<Blob> } }).SharePhotoTest.processSharePhoto(new File([original], "large.png", { type: "image/png" }));
    const bitmap = await createImageBitmap(photo);
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const metadataStripped = !new TextDecoder("latin1").decode(bytes).includes("Exif");
    const result = { width: bitmap.width, height: bitmap.height, type: photo.type, smaller: photo.size < original.size + 1_000_000, metadataStripped };
    bitmap.close(); return result;
  });
  expect(resized).toEqual({ width: 1600, height: 1067, type: "image/jpeg", smaller: true, metadataStripped: true });
  const jpeg = await raster(page, 120, 60, "#cc4444", "image/jpeg");
  // EXIF orientation 6 rotates the decoded 120×60 image to 60×120.
  const exif = Buffer.from([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0,
    0x49, 0x49, 0x2a, 0, 0x08, 0, 0, 0, 0x01, 0, 0x12, 0x01, 0x03, 0, 0x01, 0, 0, 0, 0x06, 0, 0, 0, 0, 0, 0]);
  const oriented = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
  const result = await page.evaluate(async (bytes) => {
    const photoApi = (window as unknown as { SharePhotoTest: { processSharePhoto(file: File): Promise<Blob> } }).SharePhotoTest;
    const blob = await photoApi.processSharePhoto(new File([new Uint8Array(bytes)], "rotated.jpg", { type: "image/jpeg" }));
    const bitmap = await createImageBitmap(blob);
    const dimensions = [bitmap.width, bitmap.height]; bitmap.close(); return dimensions;
  }, Array.from(oriented));
  expect(result).toEqual([60, 120]);
});
