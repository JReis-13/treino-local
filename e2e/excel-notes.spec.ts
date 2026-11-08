import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { annotatedFixture } from "../tests/annotation-fixture";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { addTraining } from "../lib/training/library";
import { emptyTrainingData } from "../lib/training/storage";

async function mock(page:Page) {
 await page.route("**/api/social/**",r=>r.fulfill({status:401,json:{error:"Not connected"}}));
 await page.route("**/api/google/auth/status",r=>r.fulfill({json:{connected:false}}));
 await page.route("**/api/push/status",r=>r.fulfill({json:{configured:false}}));
}
const file=(bytes:Uint8Array)=>({name:"synthetic-comments.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(bytes)});
async function importFile(page:Page,bytes:Uint8Array) {
 await page.goto("/plans/?source=excel");await page.locator('input[type="file"]').setInputFiles(file(bytes));
 await expect(page.getByRole("heading",{name:"Training ready"})).toBeVisible();
 await page.getByRole("button",{name:/Use this training/}).click();
}
async function openNotes(page:Page,name:string) {
 await page.goto("/workout?id=A");
 const card=page.locator(".exercise-card").filter({has:page.getByRole("heading",{name,exact:true})});
 await card.getByRole("button",{name:"Details",exact:true}).click();
 const detail=page.getByRole("dialog",{name,exact:true});
 await detail.getByRole("tab",{name:"Notes",exact:true}).click();return detail;
}

for(const format of ["legacy","threaded"] as const)test(`${format} notes: instructor visible, personal edit, export and clean reimport without duplicates`,async({page,context,browser},info)=>{
 await mock(page);
 const bytes=await annotatedFixture(format),name=format==="legacy"?"Nova Press":"Quartz Pull";
 await importFile(page,bytes);await page.getByRole("button",{name:"Start workout",exact:true}).click();
 let detail=await openNotes(page,name);
 await expect(detail.getByRole("heading",{name:"Instructor notes",exact:true})).toBeVisible();
 await expect(detail.getByText(format==="legacy"?"Keep the movement controlled.":"Coach thread guidance.",{exact:true})).toBeVisible();
 await detail.getByRole("textbox",{name:"EXERCISE NOTE",exact:true}).fill("My synthetic reminder");
 await detail.getByRole("button",{name:"Save note",exact:true}).click();
 await expect(detail.getByText("Note saved on this device.",{exact:true})).toBeVisible();
 for(const width of [320,393]) {
  await page.setViewportSize({width,height:844});
  await detail.getByRole("textbox",{name:"EXERCISE NOTE",exact:true}).scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect((await detail.getByRole("button",{name:"Save note",exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:info.outputPath(`notes-${format}-${width}.png`)});
 }
 await page.goto("/source/");await page.locator('input[type="file"]').setInputFiles(file(bytes));
 let wait=page.waitForEvent("download");
 await page.getByRole("button",{name:/Export updated Excel with notes/}).click();
 const first=Buffer.from(await readFile((await (await wait).path())!));
 const source={kind:"excel" as const,filename:"copy.xlsx",template:"",mappings:{},mode:"copy" as const};
 let training=parseTrainingSnapshot(await snapshotFromXlsx(first),source,"Copy");
 expect(training.noteContributions).toHaveLength(1);expect(training.noteContributions![0].text).toBe("My synthetic reminder");
 await page.locator('input[type="file"]').setInputFiles(file(first));
 detail=await openNotes(page,name);
 await expect(detail.getByRole("textbox",{name:"EXERCISE NOTE",exact:true})).toHaveValue("My synthetic reminder");
 await detail.getByRole("textbox",{name:"EXERCISE NOTE",exact:true}).fill("Edited synthetic reminder");
 await detail.getByRole("button",{name:"Save note",exact:true}).click();
 await expect(detail.getByText("Note saved on this device.",{exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBeTruthy();
 await context.setOffline(true);await page.reload();
 detail=await openNotes(page,name);
 await expect(detail.getByRole("textbox",{name:"EXERCISE NOTE",exact:true})).toHaveValue("Edited synthetic reminder");
 await context.setOffline(false);
 await page.goto("/source/");await page.locator('input[type="file"]').setInputFiles(file(first));
 wait=page.waitForEvent("download");await page.getByRole("button",{name:/Export updated Excel with notes/}).click();
 const edited=Buffer.from(await readFile((await (await wait).path())!));
 training=parseTrainingSnapshot(await snapshotFromXlsx(edited),source,"Copy");
 expect(training.noteContributions).toHaveLength(1);expect(training.noteContributions![0].text).toBe("Edited synthetic reminder");
 expect(training.excelAnnotations?.some(n=>n.text.includes("Keep the movement controlled.")||n.text.includes("Coach thread guidance."))).toBeTruthy();
 await page.goto("/settings/#diagnostics");
 const reportWait=page.waitForEvent("download");await page.getByRole("button",{name:"Download debug report",exact:true}).click();
 const report=await readFile((await (await reportWait).path())!,"utf8");
 for(const text of ["Edited synthetic reminder","Coach thread guidance.","Keep the movement controlled.","Synthetic coach","noteContributions","excelAnnotations"])expect(report).not.toContain(text);
 const fresh=await browser.newContext();
 try {
  const clean=await fresh.newPage();await mock(clean);await importFile(clean,edited);
  await clean.getByRole("button",{name:"Start workout",exact:true}).click();
  const reopened=await openNotes(clean,name);
  await expect(reopened.getByRole("textbox",{name:"EXERCISE NOTE",exact:true})).toHaveValue("Edited synthetic reminder");
  expect(await clean.evaluate(()=>JSON.parse(localStorage.getItem("treino-local:v2")!).exerciseNotes.length)).toBe(1);
 }finally{await fresh.close();}
});

test("reviewed same-Google-Sheet update accepts a legitimate changed exercise without replacing the saved plan",async({page})=>{
 await mock(page);
 const training=parseTrainingSnapshot(await snapshotFromXlsx(await annotatedFixture("legacy")),{kind:"google",filename:"Synthetic Google",template:"",mappings:{},authMode:"oauth",spreadsheetId:"SyntheticSheetIdentity123456",sourceProof:"a".repeat(43),syncEnabled:true},"Synthetic Google");
 const data=addTraining(emptyTrainingData(),training,undefined,undefined,"P"),next=structuredClone(training);
 next.sourceFingerprint="f00dcafe";if(next.workouts[0].blocks[0].kind==="exercise")next.workouts[0].blocks[0].name="Updated synthetic exercise";
 await page.addInitScript(data=>localStorage.setItem("treino-local:v2",JSON.stringify(data)),data);
 await page.route("**/api/google/sheets/refresh",r=>r.fulfill({json:{imported:next}}));
 await page.goto("/plans/");await page.getByText("Manage this training",{exact:true}).click();
 await page.getByRole("button",{name:"Refresh training",exact:true}).click();
 await expect(page.getByText(/1 exercise added · 1 exercise removed/)).toBeVisible();
 await page.getByRole("button",{name:/Update this training/}).click();
 await expect(page).toHaveURL(/\/$/);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("treino-local:v2")!));
 expect(stored.plans).toHaveLength(1);expect(stored.plans[0].id).toBe("P");
 expect(stored.plans[0].version).toBe(2);expect(stored.plans[0].source.spreadsheetId).toBe("SyntheticSheetIdentity123456");
 expect(stored.plans[0].workouts[0].blocks[0].name).toBe("Updated synthetic exercise");
 expect(stored.plans[0].legacyCompletions).toHaveLength(training.legacyCompletions.length);
});

test("a stale second window cannot overwrite a note saved in the first window", async ({ page, context }) => {
  await mock(page);
  await importFile(page, await annotatedFixture("legacy"));
  await page.getByRole("button", { name: "Start workout", exact: true }).click();
  const other = await context.newPage();
  try {
    await mock(other);
    const first = await openNotes(page, "Nova Press");
    const stale = await openNotes(other, "Nova Press");
    await first.getByRole("textbox", { name: "EXERCISE NOTE" }).fill("Saved in first window");
    await first.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(first.getByText("Note saved on this device.", { exact: true })).toBeVisible();
    await stale.getByRole("textbox", { name: "EXERCISE NOTE" }).fill("Unsaved second window text");
    await stale.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(stale.getByText(/Training data changed in another window/)).toBeVisible();
    await expect(stale.getByRole("textbox", { name: "EXERCISE NOTE" })).toHaveValue("Unsaved second window text");
    await expect((await openNotes(other, "Nova Press")).getByRole("textbox", { name: "EXERCISE NOTE" })).toHaveValue("Saved in first window");
  } finally {
    await other.close();
  }
});
