import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";
import { dateToSerial, snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { addTraining } from "../lib/training/library";
import { emptyTrainingData, parseTrainingData } from "../lib/training/storage";
import { startTrainingSession, updateTrainingBlock, finishTrainingSession } from "../lib/training/session";
import { prepareXlsxSync } from "../lib/sync/xlsx";
import { applyExcelSync, excelPreparedPatches, verifyExcelCopy } from "../lib/sync/excel-state";
import { sessionsWaitingForSource } from "../lib/sync/logic";
import { createBackup, parseBackup } from "../lib/training/backup";
import { aggregateSync } from "../lib/training/sync-state";
import type { TrainingData } from "../types/training";

const hash = "a".repeat(64), blockId = "A-strength-26-1";
async function fixture() {
 const bytes = new Uint8Array(await readFile("tests/fixtures/mobile-audit.xlsx"));
 const imported = parseTrainingSnapshot(await snapshotFromXlsx(bytes), {kind:"excel",filename:"audit.xlsx",template:"",mappings:{},mode:"copy"}, "Synthetic");
 return { bytes, data: addTraining(emptyTrainingData(), imported, "Synthetic", "2026-10-01T07:00:00Z", "P") };
}
function finish(data: TrainingData, id: string, day: string, load?: string, choice: "normal"|"add"|"replace" = "normal") {
 data=startTrainingSession(data,"P","A",new Date(`${day}T08:00:0${data.sessions.length}Z`),id).data;
 data=updateTrainingBlock(data,id,blockId,{completed:true,...(load?{actualLoad:load}:{})});
 return finishTrainingSession(data,id,day,new Date(`${day}T08:40:0${data.sessions.length}Z`),choice);
}
async function exported(data: TrainingData, bytes: Uint8Array) {
 const output=await prepareXlsxSync(bytes,data.plans[0],sessionsWaitingForSource(data.sessions,"P"),data.sessions);
 assert(output.bytes);
 const staged=applyExcelSync(data,"P",excelPreparedPatches(data.plans[0],data.sessions,output.outcomes,output.loadOutcomes,hash));
 return { output, bytes: output.bytes, staged };
}
async function verify(data: TrainingData, bytes: Uint8Array) {
 const imported=parseTrainingSnapshot(await snapshotFromXlsx(bytes),data.plans[0].source,"Synthetic");
 const result=verifyExcelCopy(data.plans[0],data.sessions,imported,hash);
 return { result, data: applyExcelSync(data,"P",result.patches,imported) };
}

test("two sessions: actual workbook dates, latest load, receipts and zero pending agree after reload", async () => {
 const f=await fixture(); let data=finish(f.data,"one","2026-10-01","14kg"); data=finish(data,"two","2026-10-02","15kg");
 const history=JSON.stringify(data.sessions.map(s=>({id:s.id,blocks:s.blocks,workout:s.workoutSnapshot})));
 const exp=await exported(data,f.bytes);
 assert.equal(sessionsWaitingForSource(parseTrainingData(JSON.stringify(exp.staged)).sessions,"P").length,2);
 const snapshot=await snapshotFromXlsx(exp.bytes), sheet=snapshot.sheets[0];
 assert.equal(sheet.cells.E6.raw,String(dateToSerial("2026-10-01")));
 assert.equal(sheet.cells.E7.raw,String(dateToSerial("2026-10-02")));
 assert.equal(sheet.cells.G26.displayed,"15kg");
 const done=await verify(exp.staged,exp.bytes);
 assert.equal(done.result.dates,2); assert.equal(done.result.historicalLoads,1);
 assert.equal(sessionsWaitingForSource(done.data.sessions,"P").length,0);
 assert(done.data.sessions.every(s=>s.completionReceipt?.sourceId==="P"&&s.excelSync?.verifiedAt));
 assert.equal(done.data.sessions.find(s=>s.id==="one")!.loadSyncStatus,"notApplicable");
 assert.equal(done.data.sessions.find(s=>s.id==="two")!.loadSyncStatus,"synced");
 assert.equal(JSON.stringify(done.data.sessions.map(s=>({id:s.id,blocks:s.blocks,workout:s.workoutSnapshot}))),history);
 assert.equal(sessionsWaitingForSource(parseTrainingData(JSON.stringify(done.data)).sessions,"P").length,0);
});

test("two dates with no load changes need no additional workbook operation", async () => {
 const f=await fixture(); const data=finish(finish(f.data,"one","2026-10-01"),"two","2026-10-02");
 const exp=await exported(data,f.bytes); const done=await verify(exp.staged,exp.bytes);
 assert.equal(done.result.dates,2); assert.equal(done.result.loads,0);
 assert.equal(sessionsWaitingForSource(done.data.sessions,"P").length,0);
});

test("partial workbook verifies dates independently and retains unmatched load operations", async () => {
 const f=await fixture(); const data=finish(finish(f.data,"one","2026-10-01","14kg"),"two","2026-10-02","15kg");
 const exp=await exported(data,f.bytes); const zip=await JSZip.loadAsync(exp.bytes);
 const path=(await snapshotFromXlsx(exp.bytes)).sheets[0].path!;
 zip.file(path,(await zip.file(path)!.async("string")).replace('>15kg<','>13kg<'));
 const partial=new Uint8Array(await zip.generateAsync({type:"uint8array"}));
 const done=await verify(exp.staged,partial);
 assert.equal(done.result.dates,2); assert.equal(done.result.loads,0);
 assert(done.data.sessions.every(s=>s.completionReceipt&&aggregateSync(s)==="partial"));
 assert.equal(sessionsWaitingForSource(done.data.sessions,"P").length,2);
 const retry=await verify(done.data,exp.bytes);
 assert.equal(retry.result.dates,0);
 assert.equal(sessionsWaitingForSource(retry.data.sessions,"P").length,0);
});

test("older reconnect cannot verify prepared dates or recreate a missing prepared occurrence", async () => {
 const f=await fixture(); const exp=await exported(finish(f.data,"one","2026-10-01","14kg"),f.bytes);
 const older=await verify(exp.staged,f.bytes);
 assert.equal(older.result.dates,0); assert.equal(older.data.sessions[0].completionReceipt,undefined);
 const retry=await prepareXlsxSync(f.bytes,older.data.plans[0],older.data.sessions);
 assert(retry.outcomes.every(o=>o.decision.kind!=="write"));
 assert.equal((await snapshotFromXlsx(f.bytes)).sheets[0].cells.E6.raw,"");
});

test("repeat verification is idempotent; verified date deletion and stale copies are rejected", async () => {
 const f=await fixture(); const exp=await exported(finish(f.data,"one","2026-10-01","14kg"),f.bytes);
 const done=await verify(exp.staged,exp.bytes); const repeated=await verify(done.data,exp.bytes);
 assert.equal(repeated.result.dates,0); assert.deepEqual(repeated.data,done.data);
 await assert.rejects(()=>verify(done.data,f.bytes),/missing a previously verified date/);
 assert.equal(aggregateSync(done.data.sessions[0]),"synced");
});

test("stale loads with all dates present cannot roll back a verified plan", async () => {
 const f=await fixture(); const exp=await exported(finish(f.data,"one","2026-10-01","14kg"),f.bytes);
 const done=await verify(exp.staged,exp.bytes); const zip=await JSZip.loadAsync(exp.bytes);
 const path=(await snapshotFromXlsx(exp.bytes)).sheets[0].path!;
 zip.file(path,(await zip.file(path)!.async("string")).replace('>14kg<','>12kg<'));
 const stale=new Uint8Array(await zip.generateAsync({type:"uint8array"}));
 await assert.rejects(()=>verify(done.data,stale),/missing a previously verified load/);
});

test("same-day Add uses separate slots; Replace retains its verified date and exports only loads", async () => {
 const f=await fixture(); let data=finish(f.data,"one","2026-10-01","14kg");
 data=finish(data,"two","2026-10-01","15kg","add");
 const exp=await exported(data,f.bytes); const done=await verify(exp.staged,exp.bytes);
 assert.equal(new Set(done.data.sessions.map(s=>s.completionReceipt!.slot)).size,2);
 data=finish(done.data,"replacement","2026-10-01","17kg","replace");
 const next=await exported(data,exp.bytes);
 assert.equal(next.output.outcomes.length,0);
 const result=await verify(next.staged,next.bytes);
 assert.equal(result.data.sessions.length,2);
 assert.equal(sessionsWaitingForSource(result.data.sessions,"P").length,0);
 assert.equal(parseTrainingSnapshot(await snapshotFromXlsx(next.bytes),data.plans[0].source,"Synthetic").legacyCompletions.length,3);
});

test("ambiguous grouped loads keep two real pending operations after both dates verify", async () => {
 const f=await fixture();
 const zip=await JSZip.loadAsync(f.bytes), path=(await snapshotFromXlsx(f.bytes)).sheets[0].path!;
 zip.file(path,(await zip.file(path)!.async("string")).replace(/<(?:[\w]+:)?c\b(?=[^>]*\br="H26")[^>]*(?:\/>|>[\s\S]*?<\/(?:[\w]+:)?c>)/g, match=>match.replace(/>[\s\S]*$/, "/>")));
 f.bytes=new Uint8Array(await zip.generateAsync({type:"uint8array"}));
 const imported=parseTrainingSnapshot(await snapshotFromXlsx(f.bytes),f.data.plans[0].source,"Synthetic ambiguous group");
 assert.equal(imported.workouts[0].blocks.find(item=>item.id===blockId&&item.kind==="exercise")?.kind==="exercise" && (imported.workouts[0].blocks.find(item=>item.id===blockId) as {loadSource?:unknown}).loadSource,undefined);
 f.data=addTraining(emptyTrainingData(),imported,"Synthetic","2026-10-01T07:00:00Z","P");
 let data=f.data;
 for (const [id,day] of [["one","2026-10-01"],["two","2026-10-02"]]) {
  data=startTrainingSession(data,"P","A",new Date(`${day}T08:00:00Z`),id).data;
  data=updateTrainingBlock(data,id,blockId,{completed:true,actualLoad:"6kg"});
  data=finishTrainingSession(data,id,day,new Date(`${day}T08:40:00Z`));
 }
 const exp=await exported(data,f.bytes);
 assert.equal(exp.output.loadOutcomes.filter(item=>item.status==="conflict").length,2);
 const done=await verify(exp.staged,exp.bytes);
 assert.equal(done.result.dates,2);
 assert.equal(sessionsWaitingForSource(done.data.sessions,"P").length,2);
 assert(done.data.sessions.every(item=>item.completionReceipt&&item.loadSyncStatus==="conflict"&&aggregateSync(item)==="partial"));
 assert(done.data.sessions.every(item=>item.blocks.some(block=>block.actualLoad==="6kg")));
});

test("first load in a blank self-closing cell preserves neighboring equipment and source structure", async () => {
 const f=await fixture(); let data=startTrainingSession(f.data,"P","A",new Date("2026-10-01T08:00:00Z"),"blank").data;
 data=updateTrainingBlock(data,"blank","A-strength-30-1",{completed:true,actualLoad:"6kg"});
 data=finishTrainingSession(data,"blank","2026-10-01",new Date("2026-10-01T08:40:00Z"));
 const exp=await exported(data,f.bytes); const before=(await snapshotFromXlsx(f.bytes)).sheets[0], after=(await snapshotFromXlsx(exp.bytes)).sheets[0];
 assert.equal(after.cells.G30.displayed,"6kg");
 for(const ref of Object.keys(before.cells).filter(ref=>!['G30','E6'].includes(ref))) assert.deepEqual(after.cells[ref],before.cells[ref],`Unrelated cell ${ref} changed`);
 assert.equal(sessionsWaitingForSource((await verify(exp.staged,exp.bytes)).data.sessions,"P").length,0);
});

test("prepared proof survives backups and cannot cross a different workbook identity", async () => {
 const f=await fixture(); const exp=await exported(finish(f.data,"one","2026-10-01","14kg"),f.bytes);
 const restored=parseBackup(createBackup(exp.staged)).data;
 assert.deepEqual(restored.sessions[0].excelSync,exp.staged.sessions[0].excelSync);
 const imported=parseTrainingSnapshot(await snapshotFromXlsx(exp.bytes),f.data.plans[0].source,"Synthetic");
 assert.throws(()=>verifyExcelCopy({...f.data.plans[0],sourceFingerprint:"different"},restored.sessions,imported,hash),/different workbook/);
});

test("one source occurrence cannot verify two local same-day sessions", async () => {
 const f=await fixture(); const data=finish(finish(f.data,"one","2026-10-01"),"two","2026-10-01",undefined,"add");
 const exp=await exported(data,f.bytes);
 exp.staged.sessions[1].preparedCompletionSlot=exp.staged.sessions[0].preparedCompletionSlot;
 const done=await verify(exp.staged,exp.bytes);
 assert.equal(done.result.dates,1);
 assert.equal(done.data.sessions.filter(item=>item.completionReceipt).length,1);
 assert.equal(done.data.sessions.filter(item=>item.completionSyncStatus==="conflict").length,1);
});
