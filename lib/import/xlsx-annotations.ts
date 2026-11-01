import type JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ExcelAnnotation, ExcelNoteContribution } from "@/types/training";

export const MANIFEST = "customXml/treino-exercise-notes.xml";
export const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const THREAD = "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments";
export const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
export const xml = new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",removeNSPrefix:true,parseTagValue:false,trimValues:false});
export const obj = (v:unknown):Record<string,unknown> => v && typeof v === "object" ? v as Record<string,unknown> : {};
export const arr = (v:unknown):unknown[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
export const attr = (v:unknown,k:string) => String(obj(v)[`@_${k}`] ?? "");
export function parseXml(s:string) { if(XMLValidator.validate(s)!==true) throw new Error("Malformed annotation XML"); return obj(xml.parse(s)); }
export function richText(v:unknown):string { if(typeof v === "string") return v; const n=obj(v); return n.t !== undefined ? richText(n.t) : n["#text"] !== undefined ? String(n["#text"]) : arr(n.r).map(richText).join(""); }
export function relatedPath(base:string,target:string) {
  if(!target || /[\\?#]/.test(target)) throw new Error("Unsafe annotation relationship");
  const parts=target.startsWith("/")?[]:base.split("/").slice(0,-1);
  for(const p of target.split("/")) { if(p==="..") {if(!parts.length) throw new Error("Unsafe annotation relationship");parts.pop();} else if(p && p!==".") parts.push(p); }
  if(parts[0]!=="xl") throw new Error("Unsafe annotation relationship");
  return parts.join("/");
}
export function relPath(path:string) { const parts=path.split("/"); return [...parts.slice(0,-1),"_rels",`${parts.at(-1)}.rels`].join("/"); }
export function escaped(s:string) {
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(s)||[...s].some(c=>{const cp=c.codePointAt(0)!;return cp>=0xd800&&cp<=0xdfff;}))throw new Error("A note contains characters Excel cannot store. Edit that note and retry; its local text remains saved.");
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
export const guid = (s:string) => /^\{[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\}$/i.test(s);
export const markerStart = (id:string) => `[Treino Local ${id}]`;
export const markerEnd = (id:string) => `[/Treino Local ${id}]`;
export function legacySegment(n:ExcelNoteContribution) { return `${markerStart(n.id)}\nMy note — ${n.updatedAt}\n${n.text}\n${markerEnd(n.id)}`; }

export interface AnnotationRead { annotations:ExcelAnnotation[]; contributions:ExcelNoteContribution[]; issues:string[]; workbookId?:string; }
export async function readManifest(zip:JSZip) {
  if(!zip.file(MANIFEST)) return {notes:[] as ExcelNoteContribution[],workbookId:undefined as string|undefined};
  const root=obj(parseXml(await zip.file(MANIFEST)!.async("string")).notes);
  const notes=arr(root.note).map(n=>({id:attr(n,"id"),sheet:attr(n,"sheet"),cell:attr(n,"cell"),identity:attr(n,"identity"),
    createdAt:attr(n,"createdAt"),updatedAt:attr(n,"updatedAt"),text:richText(obj(n).text),format:attr(n,"format") as "legacy"|"threaded"}));
  if(!guid(attr(root,"workbookId")) || notes.length>2000 || new Set(notes.map(n=>n.id)).size!==notes.length || notes.some(n=>!guid(n.id)||!n.identity||!n.sheet||!/^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}$/.test(n.cell)||!["legacy","threaded"].includes(n.format)||!Number.isFinite(Date.parse(n.createdAt))||!Number.isFinite(Date.parse(n.updatedAt))||n.text.length>1000)) throw new Error("Invalid Treino Local note metadata");
  return {notes,workbookId:attr(root,"workbookId")};
}

/** Only related annotation parts are interpreted. Package bytes remain authoritative. */
export async function readAnnotations(zip:JSZip,sheet:string,path:string):Promise<AnnotationRead> {
  const result:AnnotationRead={annotations:[],contributions:[],issues:[]};
  let managed:ExcelNoteContribution[]=[];
  try { const m=await readManifest(zip); managed=m.notes.filter(n=>n.sheet===sheet); result.workbookId=m.workbookId; }
  catch { result.issues.push("annotation-metadata"); }
  let relations:unknown[]=[];
  try { if(zip.file(relPath(path))) relations=arr(obj(parseXml(await zip.file(relPath(path))!.async("string")).Relationships).Relationship); }
  catch { result.issues.push("annotation-relationships"); return result; }
  const persons=new Map<string,string>();
  try {
    const wrels=arr(obj(parseXml(await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).Relationships).Relationship);
    for(const rel of wrels.filter(r=>attr(r,"Type").endsWith("/person"))) {
      if(attr(rel,"TargetMode")==="External") throw new Error();
      const p=relatedPath("xl/workbook.xml",attr(rel,"Target"));
      const doc=parseXml(await zip.file(p)!.async("string"));
      for(const person of arr(obj(doc.personList).person)) persons.set(attr(person,"id"),attr(person,"displayName"));
    }
  } catch { result.issues.push("annotation-persons"); }
  for(const rel of relations.filter(r=>/\/(comments|threadedComment)$/.test(attr(r,"Type")))) {
    try {
      if(attr(rel,"TargetMode")==="External") throw new Error();
      const part=relatedPath(path,attr(rel,"Target")), file=zip.file(part);
      if(!file) throw new Error();
      const content=await file.async("string"); if(content.length>2_000_000) throw new Error();
      const doc=parseXml(content), threaded=attr(rel,"Type").endsWith("/threadedComment");
      if((threaded?doc.ThreadedComments:doc.comments)===undefined)throw new Error();
      const root=obj(threaded?doc.ThreadedComments:doc.comments);
      const authors=arr(obj(root.authors).author).map(richText);
      const records=threaded?arr(root.threadedComment):arr(obj(root.commentList).comment);
      if(records.length>2000) throw new Error();
      const seen=new Set<string>();
      for(const record of records) {
        const cell=attr(record,"ref");let id=threaded?attr(record,"id"):`${part}:${cell}`;
        if(!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(cell) || (threaded&&!guid(id))) {result.issues.push("annotation-record");continue;}
        if(seen.has(id)){result.issues.push("annotation-duplicate");id=`${id}:${seen.size}`;}seen.add(id);
        if(threaded&&!persons.has(attr(record,"personId")))result.issues.push("annotation-author");
        if(threaded&&attr(record,"parentId")&&!records.some(r=>attr(r,"id")===attr(record,"parentId")&&attr(r,"ref")===cell))result.issues.push("annotation-thread");
        let text=richText(obj(record).text);
        const own=managed.filter(n=>n.format===(threaded?"threaded":"legacy")&&(threaded?n.id===id:text.includes(markerStart(n.id))));
        let contribution=false;
        for(const note of own) {
          if(threaded && note.id===id) {result.contributions.push({...note,cell,text});contribution=true;}
          if(!threaded) {
            const start=text.indexOf(markerStart(note.id)), end=text.indexOf(markerEnd(note.id));
            if(start>=0&&end>start) {
              const segment=text.slice(start,end+markerEnd(note.id).length);
              const body=segment.slice(markerStart(note.id).length).replace(/^\r?\nMy note — [^\n]*\r?\n/,"");
              result.contributions.push({...note,cell,text:body.slice(0,body.lastIndexOf(`\n${markerEnd(note.id)}`))});
              text=text.replace(segment,"");
            } else result.issues.push("annotation-contribution-missing");
          }
        }
        if(!threaded&&[...text.matchAll(/\[Treino Local (\{[\da-f-]+\})\]/gi)].some(m=>!managed.some(n=>n.id===m[1])))result.issues.push("annotation-ownership");
        if(!contribution && (text.trim()||threaded)) result.annotations.push({id,format:threaded?"threaded":"legacy",sheet,cell,part,text,
          author:threaded?persons.get(attr(record,"personId"))||undefined:authors[Number(attr(record,"authorId"))],
          timestamp:threaded?attr(record,"dT")||undefined:undefined,parentId:threaded?attr(record,"parentId")||undefined:undefined,
          workbookId:result.workbookId});
      }
    } catch { result.issues.push("annotation-part"); }
  }
  // Excel creates a legacy compatibility rendering for each modern thread; display it only once.
  const roots=result.annotations.filter(n=>n.format==="threaded"&&!n.parentId);
  result.annotations=result.annotations.filter(n=>n.format!=="legacy"||!n.author?.startsWith("tc=")||
    !roots.some(root=>root.cell===n.cell&&root.id.toLowerCase()===n.author!.slice(3).toLowerCase()));
  return result;
}
