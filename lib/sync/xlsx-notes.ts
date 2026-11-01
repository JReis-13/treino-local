import JSZip from "jszip";
import { snapshotFromXlsx } from "@/lib/import/snapshot";
import { parseTrainingSnapshot } from "@/lib/import/template-parser";
import { MANIFEST, MAIN, THREAD, REL, arr, attr, obj, parseXml, escaped as esc, readManifest, readAnnotations, relatedPath, relPath, legacySegment } from "@/lib/import/xlsx-annotations";
import { exerciseKey } from "@/lib/training/exercise-notes";
import { noteIdentity } from "@/lib/training/annotation-notes";
import type { ExcelNoteContribution, ExerciseNote, TrainingData, TrainingPlanRecord } from "@/types/training";

const PERSON="{64D688BE-A83C-4E55-A949-A353A6B5D2C1}";
const relationship="http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const msRel="http://schemas.microsoft.com/office/2017/10/relationships/";
const header='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ends=(text:string,tag:string,addition:string)=>{
 // Insert before terminal extension/drawing siblings, keeping OOXML child order.
 const before=tag==="worksheet"?new Set(["legacyDrawingHF","drawingHF","picture","oleObjects","controls","webPublishItems","tableParts","extLst"]):tag==="text"?new Set(["rPh","phoneticPr","extLst"]):new Set(["extLst"]);
 const tokens=/<\/?([A-Za-z_][\w:.-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
 let depth=0,active=false;
 for(const token of text.matchAll(tokens)) {
  const local=token[1].split(":").at(-1)!,closing=token[0].startsWith("</"),empty=token[0].endsWith("/>");
  if(!active&&local===tag&&!closing&&!empty){active=true;depth=1;continue;}
  if(!active)continue;
  if(!closing&&depth===1&&before.has(local))return text.slice(0,token.index)+addition+text.slice(token.index);
  if(closing){depth--;if(depth===0)break;}else if(!empty)depth++;
 }
 const pattern=new RegExp(`</((?:[\\w.-]+:)?${tag})\\s*>`);
 if(!pattern.test(text)) {
  const empty=new RegExp(`<((?:[\\w.-]+:)?${tag})\\b([^>]*?)/>`);
  if(empty.test(text))return text.replace(empty,`<$1$2>${addition}</$1>`);
  throw new Error(`Unsupported ${tag} annotation structure. Original workbook unchanged.`);
 }
 return text.replace(pattern,`${addition}</$1>`);
};
function records(xml:string,tag:string) { return [...xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</(?:[\\w.-]+:)?${tag}>)`,"g"))].map(m=>m[0]); }
function appendLegacyText(record:string,segment:string) {
 if(record.endsWith("/>")) {
  const name=record.match(/^<([\w:.-]+)/)![1];
  return record.slice(0,-2)+`><text xmlns="${MAIN}"><t xml:space="preserve">${esc(segment)}</t></text></${name}>`;
 }
 const match=record.match(/<((?:[\w.-]+:)?text)\b[^>]*>([\s\S]*?)<\/\1>/);
 if(!match) throw new Error("Unsupported legacy comment text. No comments were changed.");
 const inner=match[2], prefix=match[1].includes(":")?match[1].split(":")[0]+":":"";
 const run=`<${prefix}r><${prefix}t xml:space="preserve">\n\n${esc(segment)}</${prefix}t></${prefix}r>`;
 const updated=/<(?:[\w.-]+:)?r\b/.test(inner)?inner:inner.replace(/<((?:[\w.-]+:)?t)\b[^>]*>[\s\S]*?<\/\1>/,value=>`<${prefix}r>${value}</${prefix}r>`);
 return record.replace(match[0],ends(match[0].replace(inner,updated),"text",run));
}
/** Patches only annotation XML and its explicit relationships; never serializes worksheets. */
export async function exportExerciseNotes(bytes:Uint8Array,plan:TrainingPlanRecord,data:TrainingData) {
 if(plan.source.kind!=="excel") throw new Error("Exercise-note export needs a connected Excel workbook.");
 const zip=await JSZip.loadAsync(bytes,{checkCRC32:true}), before=await JSZip.loadAsync(bytes,{checkCRC32:true});
 const snapshot=await snapshotFromXlsx(bytes);
 const imported=parseTrainingSnapshot(snapshot,plan.source,plan.name);
 const manifest=await readManifest(zip), saved=new Map(manifest.notes.map(n=>[n.id,n]));
 const workbookId=manifest.workbookId??`{${crypto.randomUUID().toUpperCase()}}`;
 const manifestXml=()=>`${header}<notes xmlns="urn:treino-local:exercise-notes:1" workbookId="${workbookId}">${[...saved.values()].map(n=>`<note id="${n.id}" sheet="${esc(n.sheet)}" cell="${n.cell}" identity="${esc(n.identity)}" createdAt="${esc(n.createdAt)}" updatedAt="${esc(n.updatedAt)}" format="${n.format}"><text>${esc(n.text)}</text></note>`).join("")}</notes>`;
 const changed=new Set<string>();
 const put=(path:string,value:string)=>{parseXml(value);zip.file(path,value);changed.add(path);};
 const get=async(path:string,fallback?:string)=>zip.file(path)?zip.file(path)!.async("string"):fallback??Promise.reject(new Error("Annotation package part missing."));
 async function addRel(base:string,type:string,target:string) {
  const path=relPath(base), current=await get(path,`${header}<Relationships xmlns="${REL}"></Relationships>`);
  const rels=arr(obj(parseXml(current).Relationships).Relationship);
  const found=rels.find(r=>attr(r,"Type")===type&&attr(r,"Target")===target);
  if(found) return attr(found,"Id");
  const ids=new Set(rels.map(r=>attr(r,"Id")));let i=1;while(ids.has(`tlNote${i}`))i++;
  put(path,ends(current,"Relationships",`<Relationship xmlns="${REL}" Id="tlNote${i}" Type="${esc(type)}" Target="${esc(target)}"/>`));return `tlNote${i}`;
 }
 async function contentType(path:string,type:string) {
  const current=await get("[Content_Types].xml");
  const list=arr(obj(parseXml(current).Types).Override);
  const found=list.find(r=>attr(r,"PartName")===`/${path}`);
  if(found) {if(attr(found,"ContentType")!==type)throw new Error("Unexpected annotation content type.");return;}
  put("[Content_Types].xml",ends(current,"Types",`<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${path}" ContentType="${type}"/>`));
 }
 async function ensurePerson() {
  const rels=arr(obj(parseXml(await get("xl/_rels/workbook.xml.rels")).Relationships).Relationship);
  const rel=rels.find(r=>attr(r,"Type")===`${msRel}person`);
  if(rel&&attr(rel,"TargetMode")==="External")throw new Error("External person metadata cannot be edited.");
  const path=rel?relatedPath("xl/workbook.xml",attr(rel,"Target")):"xl/persons/treino-person.xml";
  const current=await get(path,`${header}<personList xmlns="${THREAD}"></personList>`);
  const people=arr(obj(parseXml(current).personList).person), person=people.find(p=>attr(p,"id")===PERSON);
  if(person&&attr(person,"displayName")!=="User (Treino Local)")throw new Error("Comment author identity conflict.");
  if(!person)put(path,ends(current,"personList",`<person xmlns="${THREAD}" displayName="User (Treino Local)" id="${PERSON}"/>`));
  if(!rel)await addRel("xl/workbook.xml",`${msRel}person`,"persons/treino-person.xml");
  await contentType(path,"application/vnd.ms-excel.person+xml");
 }
 const updates:ExerciseNote[]=[], now=new Date().toISOString();
 const candidates=data.exerciseNotes.filter(n=>n.planId===plan.id&&(n.text||n.exported));
 for(const original of candidates) {
  if(original.conflicts?.length)throw new Error("Resolve the workbook/local note conflict in Exercise Details before exporting.");
  let note=original;
  if(!note.id||!note.workoutId||!note.identity) {
   if(data.exerciseNotes.some(n=>n.planId===plan.id&&n.id&&n.exerciseKey===note.exerciseKey))continue;
   const matches=plan.workouts.flatMap(w=>w.blocks.flatMap(b=>b.kind==="exercise"&&exerciseKey(b.name)===note.exerciseKey?[{w,b}]:[]));
   if(matches.length!==1) {
    throw new Error("A legacy local note has several possible exercises. Open its Exercise Details and save it for the intended exercise before exporting.");
   }
   note={...note,id:`{${crypto.randomUUID().toUpperCase()}}`,workoutId:matches[0].w.id,identity:noteIdentity(matches[0].b),createdAt:note.updatedAt};
  }
  const workout=imported.workouts.find(w=>w.id===note.workoutId);
  const match=workout?.blocks.filter(b=>b.kind==="exercise"&&noteIdentity(b)===note.identity);
  if(match?.length!==1||match[0].kind!=="exercise"||!match[0].sourceCell)throw new Error("A note no longer matches one source exercise. Refresh and review the workbook; no notes were exported.");
  const local=plan.workouts.find(w=>w.id===note.workoutId)?.blocks.filter(b=>b.kind==="exercise"&&noteIdentity(b)===note.identity);
  if(local?.length!==1)throw new Error("Ambiguous exercise identity; note export is blocked.");
  const sheet=snapshot.sheets.find(s=>s.name===(plan.source.kind==="excel"?plan.source.mappings[note.workoutId!]?.sheetName:undefined));
  if(!sheet?.path)throw new Error("Note worksheet unavailable.");
  const scope=sheet.path.split("/").at(-1)!.replace(/[^a-zA-Z0-9_-]/g,"_");
  const annotations=await readAnnotations(zip,sheet.name,sheet.path);
  if(annotations.issues.some(i=>i!=="annotation-persons"))throw new Error("This worksheet has unsupported or malformed annotation metadata. Review it in Excel; original comments remain unchanged.");
  const cell=match[0].sourceCell, previous=saved.get(note.id!);
  const remote=annotations.contributions.find(n=>n.id===note.id);
  if(remote&&remote.cell!==cell)throw new Error("The exported note moved to a different logical exercise. Review both versions before exporting.");
  if(previous&&(!remote||remote.text!==(note.exported?.text??note.text)))throw new Error("This workbook note was changed or removed outside the app. Refresh the workbook and resolve both versions in Exercise Details before exporting.");
  const root=annotations.annotations.find(a=>a.cell===cell&&a.format==="threaded"&&!a.parentId);
  const contribution:ExcelNoteContribution={id:note.id!,sheet:sheet.name,cell,identity:note.identity!,text:note.text,
    createdAt:note.createdAt??note.updatedAt,updatedAt:note.updatedAt,format:previous?.format??(root?"threaded":"legacy")};
  if(previous && (previous.sheet!==sheet.name || previous.identity!==contribution.identity))throw new Error("Note lineage changed; original contribution was preserved.");
  if(contribution.format==="threaded") {
   if(!root)throw new Error("Original comment thread is missing. Refresh before exporting.");
   await ensurePerson();
   let current=await get(root.part);
   const own=records(current,"threadedComment").find(r=>attr(obj(parseXml(r).threadedComment),"id")===note.id);
   if(own) {
    if(!previous||attr(obj(parseXml(own).threadedComment),"personId")!==PERSON)throw new Error("Existing comment is not an app-authored reply.");
    const ownRecord=obj(parseXml(own).threadedComment);
    if((ownRecord.mentions||ownRecord.extLst)&&note.text!==remote?.text)throw new Error("This reply has additional Excel mention or extension metadata. Preserve it in Excel and add a separate personal note instead.");
    const replacement=own.replace(/<((?:[\w.-]+:)?text)\b[^>]*>[\s\S]*?<\/\1>/,`<text xmlns="${THREAD}" xml:space="preserve">${esc(note.text)}</text>`);
    current=current.replace(own,replacement);
   } else current=ends(current,"ThreadedComments",`<threadedComment xmlns="${THREAD}" ref="${cell}" dT="${esc(contribution.createdAt)}" personId="${PERSON}" id="${note.id}" parentId="${esc(root.id)}"><text xml:space="preserve">${esc(note.text)}</text></threadedComment>`);
   put(root.part,current);
   // Keep Excel's compatibility rendering readable without modifying the instructor's runs.
   const rels=arr(obj(parseXml(await get(relPath(sheet.path))).Relationships).Relationship);
   const fallback=rels.find(r=>attr(r,"Type").endsWith("/comments"));
   if(fallback) {
    const part=relatedPath(sheet.path,attr(fallback,"Target"));let content=await get(part);
    const record=records(content,"comment").find(r=>attr(obj(parseXml(r).comment),"ref")===cell);
    if(record) {
     const old=previous?esc(legacySegment(previous)):undefined;
     const next=old&&record.includes(old)?record.replace(old,esc(legacySegment(contribution))):previous?(()=>{throw new Error("Compatibility comment changed; import the latest workbook before editing.");})():appendLegacyText(record,legacySegment(contribution));
     content=content.replace(record,next);put(part,content);
    }
   }
  } else {
   let relations=arr(obj(parseXml(await get(relPath(sheet.path),`${header}<Relationships xmlns="${REL}"></Relationships>`)).Relationships).Relationship);
   let rel=relations.find(r=>attr(r,"Type").endsWith("/comments"));
   const part=rel?relatedPath(sheet.path,attr(rel,"Target")):`xl/treino-notes-${scope}.xml`;
   if(!rel) { await addRel(sheet.path,`${relationship}comments`,`../treino-notes-${scope}.xml`);relations=arr(obj(parseXml(await get(relPath(sheet.path))).Relationships).Relationship);rel=relations.find(r=>attr(r,"Type").endsWith("/comments")); }
   let current=await get(part,`${header}<comments xmlns="${MAIN}"><authors><author>User (Treino Local)</author></authors><commentList></commentList></comments>`);
   const record=records(current,"comment").find(r=>attr(obj(parseXml(r).comment),"ref")===cell);
   if(record) {
    const old=previous?esc(legacySegment({...previous,text:remote!.text})):undefined;
    const next=old&&record.includes(old)?record.replace(old,esc(legacySegment(contribution))):previous?(()=>{throw new Error("Legacy note formatting changed; import the latest workbook before editing.");})():appendLegacyText(record,legacySegment(contribution));
    current=current.replace(record,next);
   } else {
    const authors=arr(obj(obj(parseXml(current).comments).authors).author);const authorIndex=authors.length;
    current=ends(current,"authors",`<author xmlns="${MAIN}">User (Treino Local)</author>`);
    current=ends(current,"commentList",`<comment xmlns="${MAIN}" ref="${cell}" authorId="${authorIndex}"><text><t xml:space="preserve">${esc(legacySegment(contribution))}</t></text></comment>`);
   }
   put(part,current);await contentType(part,"application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml");
   // Ensure a legacy note shape exists, preserving any existing VML drawing and shapes.
   const vrel=relations.find(r=>attr(r,"Type").endsWith("/vmlDrawing"));
   const vpath=vrel?relatedPath(sheet.path,attr(vrel,"Target")):`xl/drawings/treino-notes-${scope}.vml`;
   const drawingId=vrel?attr(vrel,"Id"):await addRel(sheet.path,`${relationship}vmlDrawing`,`../drawings/treino-notes-${scope}.vml`);
   let vml=await get(vpath,`${header}<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype></xml>`);
   const row=Number(cell.match(/\d+/)![0])-1,col=[...cell.match(/^[A-Z]+/)![0]].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)-1;
   if(!records(vml,"ClientData").some(r=>new RegExp(`<[^>]*Row>${row}</`).test(r)&&new RegExp(`<[^>]*Column>${col}</`).test(r))) {
    const ids=new Set([...vml.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));let id=1025;while(ids.has(`_x0000_s${id}`))id++;
    vml=ends(vml,"xml",`<v:shape xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" id="_x0000_s${id}" type="#_x0000_t202" style="position:absolute;visibility:hidden;width:144pt;height:79pt" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>${row}</x:Row><x:Column>${col}</x:Column></x:ClientData></v:shape>`);put(vpath,vml);
   }
   await contentType(vpath,"application/vnd.openxmlformats-officedocument.vmlDrawing");
   if(!vrel) {const sheetXml=await get(sheet.path);put(sheet.path,ends(sheetXml,"worksheet",`<legacyDrawing xmlns="${MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${drawingId}"/>`));}
  }
  saved.set(contribution.id,contribution);
  put(MANIFEST,manifestXml());
  updates.push({...note,exported:{text:note.text,updatedAt:note.updatedAt,generatedAt:now}});
 }
 if(!updates.length)return {bytes,updates};
 put(MANIFEST,manifestXml());
 await contentType(MANIFEST,"application/xml");
 // Spreadsheet customXml parts are related from WorkbookPart, not the package root.
 await addRel("xl/workbook.xml",`${relationship}customXml`,`../${MANIFEST}`);
 const output=new Uint8Array(await zip.generateAsync({type:"uint8array",compression:"DEFLATE"}));
 const verified=await JSZip.loadAsync(output,{checkCRC32:true});
 for(const [path,file] of Object.entries(before.files)) if(!file.dir&&!changed.has(path)) {
  const left=await file.async("uint8array"),right=await verified.file(path)!.async("uint8array");
  if(left.length!==right.length||left.some((b,i)=>b!==right[i]))throw new Error("Unrelated workbook part changed. Export refused.");
 }
 const result=await snapshotFromXlsx(output);
 for(const sheet of snapshot.sheets) if(JSON.stringify(sheet.cells)!==JSON.stringify(result.sheets.find(s=>s.name===sheet.name)?.cells))throw new Error("Worksheet values or formatting changed during note export.");
 for(const n of updates) if(!result.sheets.some(s=>s.noteContributions?.some(c=>c.id===n.id&&c.text===n.text)))throw new Error("Exported note readback failed. No copy was downloaded.");
 return {bytes:output,updates};
}
