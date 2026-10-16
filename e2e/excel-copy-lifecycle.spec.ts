import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { snapshotFromXlsx, dateToSerial } from "../lib/import/snapshot";

const fixture = resolve("tests/fixtures/mobile-audit.xlsx");
async function mock(page: Page) {
 await page.route("**/api/social/**",r=>r.fulfill({status:401,json:{error:"Not connected"}}));
 await page.route("**/api/google/auth/status",r=>r.fulfill({json:{connected:false}}));
 await page.route("**/api/push/status",r=>r.fulfill({json:{configured:false}}));
}
async function twoSessions(page: Page) {
 await mock(page);
 await page.goto("/plans/?source=excel");
 await page.locator('input[type="file"]').setInputFiles(fixture);
 await page.getByRole("button",{name:/Use this training/}).click();
 for(const [date,load,expression] of [["2026-10-01","14","2x9kg"],["2026-10-02","15","2x10kg"]]) {
  await page.getByRole("button",{name:"Start workout",exact:true}).click();
  for(const [name,value] of [["Nova Press",load],["Quartz Pull",expression]]) {
   const card=page.locator(".exercise-card").filter({has:page.getByRole("heading",{name,exact:true})});
   await card.getByRole("textbox").fill(value);
   await card.getByRole("checkbox",{name:`Save load & complete ${name}`,exact:true}).click();
  }
  await page.getByRole("link",{name:/Finish workout/}).click();
  await page.locator('input[type="date"]').fill(date);
  await page.getByRole("button",{name:/Save workout/}).click();
  await page.getByRole("link",{name:"Done",exact:true}).click();
 }
 await page.goto("/source/");
 await page.locator('input[type="file"]').setInputFiles(fixture);
 const wait=page.waitForEvent("download");
 await page.getByRole("button",{name:/Save updated workbook copy/}).click();
 const download=await wait;
 return Buffer.from(await readFile((await download.path())!));
}
async function reconnect(page: Page, bytes: Buffer) {
 await page.locator('input[type="file"]').setInputFiles({name:"synthetic-updated.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:bytes});
}
async function state(page: Page) { return page.evaluate(()=>JSON.parse(localStorage.getItem("treino-local:v2")!)); }

test("two-session safe-copy export verifies actual cells, receipts, zero pending, restart and private composite Stats",async({page,context,browser},info)=>{
 const output=await twoSessions(page);
 const workbook=(await snapshotFromXlsx(new Uint8Array(output))).sheets[0];
 expect(workbook.cells.E6.raw).toBe(String(dateToSerial("2026-10-01")));
 expect(workbook.cells.E7.raw).toBe(String(dateToSerial("2026-10-02")));
 expect(workbook.cells.G26.displayed).toBe("15kg");
 expect(workbook.cells.G28.displayed).toBe("2x10kg");
 await context.setOffline(true);
 await page.reload();
 await expect(page.getByText("2 PENDING",{exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:/Save updated workbook copy/})).toBeDisabled();
 await expect(page.getByText(/An updated copy was already generated/)).toBeVisible();
 await reconnect(page,output);
 await expect(page.getByRole("heading",{name:"Source up to date",exact:true})).toBeVisible();
 await expect(page.getByText("0 PENDING",{exact:true})).toBeVisible();
 const saved=await state(page);
 expect(saved.sessions).toHaveLength(2);
 expect(new Set(saved.sessions.map((s:{completionReceipt:{slot:string}})=>s.completionReceipt.slot)).size).toBe(2);
 expect(saved.sessions.every((s:{syncStatus:string;excelSync:{verifiedAt?:string}})=>s.syncStatus==="synced"&&s.excelSync.verifiedAt)).toBeTruthy();
 expect(saved.sessions.find((s:{localDate:string})=>s.localDate==="2026-10-01").blocks.find((b:{blockId:string})=>b.blockId==="A-strength-26-1").actualLoad).toBe("14kg");
 await page.reload();
 await expect(page.getByText("0 PENDING",{exact:true})).toBeVisible();
 await context.setOffline(false);
 for(const width of [320,393]) {
  await page.setViewportSize({width,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:info.outputPath(`source-verified-${width}.png`),fullPage:true});
 }
 await reconnect(page,output);
 await expect(page.getByText("0 PENDING",{exact:true})).toBeVisible();
 await page.locator('input[type="file"]').setInputFiles(fixture);
 await expect(page.getByText(/missing a previously verified date/)).toBeVisible();
 expect((await state(page)).sessions.map((s:{completionReceipt:unknown})=>s.completionReceipt)).toEqual(saved.sessions.map((s:{completionReceipt:unknown})=>s.completionReceipt));
 await page.goto("/stats/");
 await page.getByRole("combobox",{name:"EXERCISE",exact:true}).selectOption({label:"Lumen Raise"});
 await expect(page.getByText("No recorded loads for this exercise in this period.")).toBeVisible();
 await page.getByRole("combobox",{name:"EXERCISE",exact:true}).selectOption({label:"Quartz Pull"});
 const progression=page.locator(".review-card").filter({has:page.getByRole("heading",{name:"Load progression",exact:true})});
 await expect(progression).toContainText("not numerically comparable");
 await expect(progression.locator(".detail-history-list")).toContainText("2x9kg");
 await expect(progression.locator(".detail-history-list")).toContainText("2x10kg");
 await expect(progression.getByRole("img",{name:"Recorded load progression"})).toHaveCount(0);
 for(const width of [320,393]) {
  await page.setViewportSize({width,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:info.outputPath(`stats-composite-${width}.png`),fullPage:true});
 }
 await progression.locator(".detail-history-list a").first().click();
 await expect(page.locator(".detail-list")).toContainText("2x10kg");
 await page.goto("/settings/#diagnostics");
 const reportDownload=page.waitForEvent("download");
 await page.getByRole("button",{name:"Download debug report",exact:true}).click();
 const report=await readFile((await (await reportDownload).path())!,"utf8");
 for(const privateValue of ["excelSync",saved.sessions[0].excelSync.exportId,"14kg","2x10kg","Nova Press","Quartz Pull","synthetic-updated.xlsx"]) expect(report).not.toContain(privateValue);
 const restarted=await browser.newContext();
 try {
  const fresh=await restarted.newPage(); await mock(fresh);
  await fresh.addInitScript(data=>localStorage.setItem("treino-local:v2",JSON.stringify(data)),saved);
  await fresh.goto("/source/");
  await expect(fresh.getByText("0 PENDING",{exact:true})).toBeVisible();
  await expect(fresh.getByRole("button",{name:/Save updated workbook copy/})).toBeDisabled();
 } finally { await restarted.close(); }
});

test("partial and stale workbook reconnects expose load failures without duplicating verified dates",async({page},info)=>{
 const output=await twoSessions(page);
 const zip=await JSZip.loadAsync(output), path=(await snapshotFromXlsx(new Uint8Array(output))).sheets[0].path!;
 zip.file(path,(await zip.file(path)!.async("string")).replace('>15kg<','>13kg<'));
 const partial=await zip.generateAsync({type:"nodebuffer"});
 await page.evaluate(()=>{ const original=Storage.prototype.setItem; Storage.prototype.setItem=function(key,value) { if(key==="treino-local:v2") throw new Error("Synthetic storage unavailable"); return original.call(this,key,value); }; });
 await reconnect(page,partial);
 await expect(page.getByText("Synthetic storage unavailable",{exact:true})).toBeVisible();
 expect((await state(page)).sessions.every((session:{completionReceipt?:unknown})=>!session.completionReceipt)).toBeTruthy();
 await page.reload();
 await reconnect(page,partial);
 await expect(page.getByText("2 PENDING",{exact:true})).toBeVisible();
 await expect(page.locator(".pending-list")).toContainText("Date: verified · Loads: needs attention");
 await expect(page.getByRole("button",{name:/Save updated workbook copy/})).toBeDisabled();
 await expect(page.getByText(/Dates are verified; load updates need review/)).toBeVisible();
 const partialState=await state(page);
 expect(partialState.sessions.every((s:{syncStatus:string;completionReceipt:unknown})=>s.syncStatus==="partial"&&s.completionReceipt)).toBeTruthy();
 for(const width of [320,393]) {
  await page.setViewportSize({width,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:info.outputPath(`source-partial-${width}.png`),fullPage:true});
 }
 await page.reload();
 await expect(page.getByText("2 PENDING",{exact:true})).toBeVisible();
 await reconnect(page,output);
 await expect(page.getByText("0 PENDING",{exact:true})).toBeVisible();
 await reconnect(page,output);
 expect((await state(page)).sessions).toHaveLength(2);
 expect((await snapshotFromXlsx(new Uint8Array(output))).sheets[0].cells.E8.raw).toBe("");
});
