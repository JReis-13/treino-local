import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { emptyTrainingData } from "../lib/training/storage";
import { startTrainingSession, finishTrainingSession } from "../lib/training/session";
import { addTraining } from "../lib/training/library";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import type { TrainingData, TrainingPlanRecord } from "../types/training";

let server:Server,origin:string,version="aaaabbbb-20261101T000001";
const next="aaaabbbb-20261101T000002";
test.beforeAll(async()=>{
 const worker=await readFile("public/sw.js","utf8"),build=worker.match(/const CACHE = "treino-([^"]+)"/)![1];
 server=createServer(async(req,res)=>{
  const path=new URL(req.url??"/","http://localhost").pathname;
  if(path==="/sw.js"){res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/javascript");res.end(worker.replaceAll(build,version));return;}
  if(path.startsWith("/api/")){res.statusCode=path.includes("/social/")?401:200;res.setHeader("Content-Type","application/json");res.end(JSON.stringify(path.includes("/google/auth/status")?{connected:false}:{configured:false}));return;}
  try {
   const headers=Object.fromEntries(Object.entries(req.headers).filter(([k,v])=>v!==undefined&&!["host","connection","cookie","content-length"].includes(k)).map(([k,v])=>[k,Array.isArray(v)?v.join(","):v!]));
   const response=await fetch(`${process.env.E2E_BASE_URL??"http://localhost:3000"}${req.url}`,{headers,redirect:"manual"});
   res.statusCode=response.status;
   response.headers.forEach((v,k)=>{if(!["content-encoding","content-length","transfer-encoding","connection","set-cookie"].includes(k))res.setHeader(k,v);});
   res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.statusCode=502;res.end("Synthetic proxy unavailable");}
 });
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();if(!address||typeof address==="string")throw new Error("No fixture port");origin=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));});
function plan(id:string):TrainingPlanRecord{return {id,name:`Synthetic ${id}`,source:{kind:"builtin",label:"Local"},version:1,importedAt:"2026-10-01T08:00:00Z",updatedAt:"2026-10-01T08:00:00Z",importWarnings:[],legacyCompletions:[],workouts:[{id:"A",title:"Workout A",description:"Synthetic",blocks:[{kind:"exercise",id:"one",section:"Strength",name:"Synthetic press",prescription:"3x8",defaultLoad:"10kg",sourceNotes:[{id:"coach",format:"legacy",part:"xl/comments.xml",sheet:"Synthetic",cell:"E26",text:"Synthetic instructor note"}]}]}]};}
function seed(active=false):TrainingData {
 let data:TrainingData={...emptyTrainingData(),plans:[plan("P"),plan("Q")],activePlanId:"P"};
 data=startTrainingSession(data,"P","A",new Date("2026-10-01T08:00:00Z"),"history").data;
 data=finishTrainingSession(data,"history","2026-10-01",new Date("2026-10-01T08:30:00Z"));
 data=startTrainingSession(data,active?"P":"Q","A",new Date("2026-10-02T08:00:00Z"),"retained-draft").data;
 data.exerciseNotes=[{planId:"P",exerciseKey:"synthetic press",text:"Synthetic personal note",updatedAt:"2026-10-01T08:00:00Z"}];return data;
}
async function begin(page:Page,data:TrainingData){
 version="aaaabbbb-20261101T000001";
 await page.addInitScript(data=>{if(!localStorage.getItem("treino-local:v2"))localStorage.setItem("treino-local:v2",JSON.stringify(data));Object.defineProperty(window,"showOpenFilePicker",{value:undefined,configurable:true});},data);
 await page.goto(origin);await expect(page.locator(".home-page")).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
}
async function waiting(page:Page){version=next;await page.evaluate(()=>{document.dispatchEvent(new Event("visibilitychange"));});await expect.poll(()=>page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);}
const state=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem("treino-local:v2")!));
async function apply(page:Page){
 const before=await state(page);await page.getByRole("button",{name:"Update now",exact:true}).click();
 await expect(page.locator(".update-banner")).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>new Promise<string>(r=>{const c=new MessageChannel();c.port1.onmessage=e=>r(e.data);navigator.serviceWorker.controller!.postMessage("GET_BUILD_ID",[c.port2]);}))).toBe(next);
 expect(await state(page)).toEqual(before);
}

for(const standalone of [false,true])test(`idle Home (${standalone?"simulated standalone":"browser"}) with another plan's draft offers a real waiting update and retains saved data`,async({page,context},info)=>{
 await page.addInitScript(standalone=>{const original=window.matchMedia.bind(window);window.matchMedia=q=>{const result=original(q);if(q==="(display-mode: standalone)")Object.defineProperty(result,"matches",{value:standalone});return result;};},standalone);
 await begin(page,seed());await page.evaluate(()=>localStorage.setItem("synthetic-pending-change","retained"));await waiting(page);
 await expect(page.getByRole("button",{name:"Update now",exact:true})).toBeVisible();
 await expect(page.getByText(/update after this workout/)).toHaveCount(0);
 for(const width of [320,393]){await page.setViewportSize({width,height:844});const button=page.getByRole("button",{name:"Update now",exact:true});await expect(button).toBeInViewport();expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`idle-update-${width}.png`)});}
 await context.setOffline(true);await context.setOffline(false);await apply(page);
 expect(await page.evaluate(()=>localStorage.getItem("synthetic-pending-change"))).toBe("retained");
 expect((await state(page)).sessions.some((s:{id:string;status:string})=>s.id==="retained-draft"&&s.status==="inProgress")).toBe(true);
});
test("a genuine current workout defers activation until its normal local completion",async({page})=>{
 await begin(page,seed(true));await waiting(page);await expect(page.getByText(/update after this workout/)).toBeVisible();await expect(page.getByRole("button",{name:"Update now",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Resume Workout A",exact:true}).click();await page.getByRole("checkbox",{name:/Complete Synthetic press/}).click();
 await page.getByRole("link",{name:/Finish workout/}).first().click();await page.getByRole("button",{name:/Save workout/}).click();
 await expect(page.getByRole("button",{name:"Update now",exact:true})).toBeVisible();await apply(page);
 expect((await state(page)).sessions.filter((s:{status:string})=>s.status==="completed")).toHaveLength(2);
});
test("failed local persistence blocks updates and a successful retry releases the same waiting worker",async({page})=>{
 await begin(page,seed());await waiting(page);
 await page.goto(origin+"/plans");await page.getByText("Manage this training",{exact:true}).click();
 await page.evaluate(()=>{const original=Storage.prototype.setItem;let fail=true;Storage.prototype.setItem=function(k,v){if(k==="treino-local:v2"&&fail){fail=false;throw new Error("Synthetic write failure");}return original.call(this,k,v);};});
 page.on("dialog",d=>d.accept("Renamed synthetic plan"));
 await page.getByRole("button",{name:"Rename locally",exact:true}).first().click();
 await expect(page.getByText("Save local changes before updating",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Update now",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"Rename locally",exact:true}).first().click();await expect(page.getByRole("button",{name:"Update now",exact:true})).toBeEnabled();await apply(page);
});
test("Excel plan refresh does not turn another plan's preserved draft into an update blocker",async({page})=>{
 const bytes=new Uint8Array(await readFile(resolve("tests/fixtures/mobile-audit.xlsx")));
 const imported=parseTrainingSnapshot(await snapshotFromXlsx(bytes),{kind:"excel",filename:"synthetic.xlsx",template:"",mappings:{},mode:"copy"},"Synthetic Excel");
 const original=seed();const data=addTraining({...original,plans:[original.plans[1]],activePlanId:"Q",sessions:original.sessions.filter(s=>s.planId==="Q")},imported,undefined,undefined,"P");
 await begin(page,data);await waiting(page);await page.goto(origin+"/plans");await page.getByText("Manage this training",{exact:true}).click();
 const chooser=page.waitForEvent("filechooser");await page.getByRole("button",{name:"Refresh training",exact:true}).first().click();await (await chooser).setFiles({name:"synthetic.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(bytes)});
 await page.getByRole("button",{name:/Update this training/}).click();await expect(page.getByRole("button",{name:"Update now",exact:true})).toBeVisible();await apply(page);
 expect((await state(page)).sessions.find((s:{id:string})=>s.id==="retained-draft").status).toBe("inProgress");
});
