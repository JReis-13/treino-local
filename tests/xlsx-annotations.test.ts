import { annotatedFixture } from "./annotation-fixture";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import JSZip from "jszip";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { readManifest, parseXml, obj, arr, attr } from "../lib/import/xlsx-annotations";
import { addTraining, refreshTraining } from "../lib/training/library";
import { emptyTrainingData, parseTrainingData } from "../lib/training/storage";
import { saveScopedNote, applyNoteUpdates, resolveNoteConflict } from "../lib/training/annotation-notes";
import { exportExerciseNotes } from "../lib/sync/xlsx-notes";
import { updateExerciseNote } from "../lib/training/exercise-notes";
import { startTrainingSession, updateTrainingBlock, finishTrainingSession } from "../lib/training/session";
import type { TrainingSource } from "../types/training";

const source:TrainingSource={kind:"excel",filename:"synthetic.xlsx",template:"",mappings:{},mode:"copy"};
const root="{11111111-1111-4111-8111-111111111111}",person="{33333333-3333-4333-8333-333333333333}";
async function imported(bytes:Uint8Array) {return parseTrainingSnapshot(await snapshotFromXlsx(bytes),source,"Synthetic");}
async function setup(format:"legacy"|"threaded"|"both"="both",block="A-strength-26-1") {
 const bytes=await annotatedFixture(format), training=await imported(bytes);
 let data=addTraining(emptyTrainingData(),training,"Synthetic",undefined,"P");
 data=saveScopedNote(data,"P","A",block,"My private reminder",undefined,"2026-11-01T08:00:00Z");
 return {bytes,data};
}
function independentlyValidate(bytes:Uint8Array) {
 const result=spawnSync(process.env.PYTHON??(process.platform==="win32"?"python":"python3"),["-c",`import sys,io,zipfile,xml.etree.ElementTree as E,posixpath
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
tc='http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments'
people=set()
for p in z.namelist():
 if p.endswith('.xml'):
  r=E.fromstring(z.read(p))
  if r.tag=='{'+tc+'}personList':
   ids=[e.attrib['id'] for e in r if e.tag=='{'+tc+'}person']; assert len(ids)==len(set(ids));people.update(ids)
for p in z.namelist():
 if p.endswith(('.xml','.rels','.vml')):
  r=E.fromstring(z.read(p))
  if p.endswith('.rels'):
   base=posixpath.dirname(posixpath.dirname(p))
   for x in r:
    if x.attrib.get('TargetMode')=='External': continue
    t=x.attrib['Target']; target=t.lstrip('/') if t.startswith('/') else posixpath.normpath(posixpath.join(base,t))
    assert target in z.namelist(), (p,target)
  if r.tag=='{'+tc+'}ThreadedComments':
   entries=[e for e in r if e.tag=='{'+tc+'}threadedComment'];ids={e.attrib['id']:e for e in entries};assert len(ids)==len(entries)
   if any(e.tag.endswith('}extLst') for e in r): assert r[-1].tag.endswith('}extLst')
   for e in entries:
    assert e.attrib['personId'] in people
    if 'parentId' in e.attrib: assert e.attrib['parentId'] in ids and ids[e.attrib['parentId']].attrib.get('ref')==e.attrib.get('ref')
print('XML and package relationships valid')`],{input:bytes,encoding:"utf8",windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/relationships valid/);
}

test("no comments still imports; legacy and native threads retain authors, replies and shared-cell attribution",async()=>{
 const plain=await imported(new Uint8Array(await readFile("tests/fixtures/mobile-audit.xlsx")));
 for(const format of ["legacy","threaded","both"] as const) {
  const training=await imported(await annotatedFixture(format));
  assert.equal(training.sourceFingerprint,plain.sourceFingerprint,"Annotation text is not source exercise identity");
  assert.equal(training.workouts[0].blocks.length,plain.workouts[0].blocks.length);
  const notes=training.workouts[0].blocks.flatMap(b=>b.kind==="exercise"?b.sourceNotes??[]:[]);
  assert(notes.every(n=>n.author==="Synthetic coach"));
  if(format!=="threaded") assert(notes.some(n=>n.shared&&n.cell==="E26"));
  if(format!=="legacy")assert(notes.some(n=>n.parentId===root&&n.timestamp));
  assert(!notes.some(n=>n.text.includes("compatibility rendering")||n.cell==="A1"));
  assert(training.excelAnnotations?.some(n=>n.cell==="A1")||format==="threaded");
 }
});

for(const format of ["legacy","threaded","both"] as const)test(`${format}: import, export, reimport, repeat and edit preserve instructor XML and personal identity`,async()=>{
 const f=await setup(format,format==="legacy"?"A-strength-26-1":"A-strength-28-1");
 const original=await JSZip.loadAsync(f.bytes), first=await exportExerciseNotes(f.bytes,f.data.plans[0],f.data);
 independentlyValidate(first.bytes);
 const saved=parseTrainingData(JSON.stringify(applyNoteUpdates(f.data,"P",first.updates)));
 const roundtrip=await imported(first.bytes), fresh=addTraining(emptyTrainingData(),roundtrip,"Roundtrip",undefined,"R");
 assert.equal(fresh.exerciseNotes.length,1);assert.equal(fresh.exerciseNotes[0].text,"My private reminder");
 assert.equal(fresh.exerciseNotes[0].id,saved.exerciseNotes[0].id);
 assert.equal(roundtrip.excelAnnotations?.filter(n=>n.format==="threaded").length,format==="legacy"?0:2);
 const repeat=await exportExerciseNotes(first.bytes,saved.plans[0],saved);
 assert.equal((await readManifest(await JSZip.loadAsync(repeat.bytes))).notes.length,1);
 assert.equal((await imported(repeat.bytes)).noteContributions?.length,1);
 const block=format==="legacy"?"A-strength-26-1":"A-strength-28-1";
 const edited=saveScopedNote(saved,"P","A",block,"Edited reminder",saved.exerciseNotes[0].id,"2026-11-02T08:00:00Z");
 const updated=await exportExerciseNotes(first.bytes,edited.plans[0],edited);
 const notes=(await imported(updated.bytes)).noteContributions!;
 assert.equal(notes.length,1);assert.equal(notes[0].text,"Edited reminder");
 assert.equal(edited.exerciseNotes[0].history?.[0].text,"My private reminder");
 const after=await JSZip.loadAsync(updated.bytes);
 const text=await after.file(format==="legacy"?"xl/comments-synthetic.xml":"xl/threadedComments/synthetic.xml")!.async("string");
 if(format==="legacy")assert(text.includes('<r><rPr><b/></rPr><t>Keep the movement controlled.</t></r>'));
 else {
  const prior=await original.file("xl/threadedComments/synthetic.xml")!.async("string");
  for(const record of prior.match(/<threadedComment\b[^>]*>[\s\S]*?<\/threadedComment>/g)!)assert(text.includes(record));
  const doc=obj(parseXml(text).ThreadedComments);const personal=arr(doc.threadedComment).filter(n=>attr(n,"id")===saved.exerciseNotes[0].id);
  assert.equal(personal.length,1);assert.equal(attr(personal[0],"parentId"),root);assert.notEqual(attr(personal[0],"personId"),person);
 }
 independentlyValidate(updated.bytes);
});

test("a note in an uncommented workbook creates a real legacy note, VML shape and valid relationships",async()=>{
 const bytes=new Uint8Array(await readFile("tests/fixtures/mobile-audit.xlsx"));
 let data=addTraining(emptyTrainingData(),await imported(bytes),"Synthetic",undefined,"P");
 data=saveScopedNote(data,"P","A","A-strength-30-1","New cell note");
 const output=await exportExerciseNotes(bytes,data.plans[0],data);
 independentlyValidate(output.bytes);
 const zip=await JSZip.loadAsync(output.bytes);
 assert(Object.keys(zip.files).some(p=>p.endsWith(".vml")));
 assert.equal((await imported(output.bytes)).noteContributions?.[0].cell,"E30");
 assert.equal((await readManifest(zip)).notes.length,1);
});

test("empty self-closing comments cannot consume or modify a neighboring instructor comment",async()=>{
 const f=await setup("legacy"),zip=await JSZip.loadAsync(f.bytes);
 const original=await zip.file("xl/comments-synthetic.xml")!.async("string");
 zip.file("xl/comments-synthetic.xml",original.replace(/<comment ref="E26"[\s\S]*?<\/comment>/,'<comment ref="E26" authorId="0"/>'));
 const output=await exportExerciseNotes(new Uint8Array(await zip.generateAsync({type:"uint8array"})),f.data.plans[0],f.data);
 const text=await (await JSZip.loadAsync(output.bytes)).file("xl/comments-synthetic.xml")!.async("string");
 assert(text.includes('<comment ref="A1" authorId="0"><text><t>Unrelated admin note</t></text></comment>'));
 assert.equal((await imported(output.bytes)).noteContributions?.[0].text,"My private reminder");
 independentlyValidate(output.bytes);
});

test("reordered rows map by logical exercise identity; changed or duplicate exercises cannot receive another exercise's note",async()=>{
 const f=await setup();const zip=await JSZip.loadAsync(f.bytes), sheet=(await snapshotFromXlsx(f.bytes)).sheets[0];
 let text=await zip.file(sheet.path!)!.async("string");
 const a=text.match(/<(?:\w+:)?c\b(?=[^>]*\br="E26")[^>]*>[\s\S]*?<\/(?:\w+:)?c>/)![0];
 const b=text.match(/<(?:\w+:)?c\b(?=[^>]*\br="E28")[^>]*>[\s\S]*?<\/(?:\w+:)?c>/)![0];
 // Move entire logical names and equipment together; never map just by old row number.
 text=text.replace(a,b.replace('r="E28"','r="E26"')).replace(b,a.replace('r="E26"','r="E28"'));
 zip.file(sheet.path!,text);
 const output=await exportExerciseNotes(new Uint8Array(await zip.generateAsync({type:"uint8array"})),f.data.plans[0],f.data);
 assert.equal((await imported(output.bytes)).noteContributions![0].cell,"E28");
 const changed=structuredClone(f.data);changed.exerciseNotes[0].identity="no matching exercise";
 await assert.rejects(()=>exportExerciseNotes(f.bytes,changed.plans[0],changed),/no longer matches/);
 const duplicate=structuredClone(f.data);duplicate.plans[0].workouts[0].blocks.push({...duplicate.plans[0].workouts[0].blocks[3],id:"duplicate"});
 await assert.rejects(()=>exportExerciseNotes(f.bytes,duplicate.plans[0],duplicate),/Ambiguous/);
});

test("inserting rows that move template markers fails safely without partially replacing the saved plan",async()=>{
 const f=await setup(),before=JSON.stringify(f.data),zip=await JSZip.loadAsync(f.bytes),path=(await snapshotFromXlsx(f.bytes)).sheets[0].path!;
 zip.file(path,(await zip.file(path)!.async("string")).replace(/\br="([A-Z]*)(\d+)"/g,(all,letters,row)=>Number(row)>=24?`r="${letters}${Number(row)+1}"`:all));
 const shifted=new Uint8Array(await zip.generateAsync({type:"uint8array"}));
 await assert.rejects(()=>imported(shifted),/Equipment\/video headers do not match a supported workbook layout/);
 assert.equal(JSON.stringify(f.data),before);
});

test("external edits preserve both versions and require explicit resolution; refresh never changes saved History",async()=>{
 const f=await setup(),first=await exportExerciseNotes(f.bytes,f.data.plans[0],f.data);
 let data=applyNoteUpdates(f.data,"P",first.updates);
 data=startTrainingSession(data,"P","A",new Date("2026-11-01T08:00:00Z"),"S").data;
 data=updateTrainingBlock(data,"S","A-strength-26-1",{completed:true});
 data=finishTrainingSession(data,"S","2026-11-01",new Date("2026-11-01T08:30:00Z"));
 const history=JSON.stringify(data.sessions);
 data=saveScopedNote(data,"P","A","A-strength-26-1","Local edit",data.exerciseNotes[0].id);
 const zip=await JSZip.loadAsync(first.bytes);
 zip.file("xl/comments-synthetic.xml",(await zip.file("xl/comments-synthetic.xml")!.async("string")).replace("My private reminder","Workbook edit").replace("Keep the movement controlled.","Updated coach guidance."));
 const external=new Uint8Array(await zip.generateAsync({type:"uint8array"}));
 await assert.rejects(()=>exportExerciseNotes(external,data.plans[0],data),/changed or removed outside/);
 const refreshed=refreshTraining(data,"P",await imported(external));
 assert.equal(JSON.stringify(refreshed.sessions),history);
 assert(refreshed.exerciseNotes[0].conflicts?.includes("Workbook edit"));
 assert(refreshed.plans[0].excelAnnotations?.find(n=>n.cell==="E26")?.previousTexts?.some(text=>text.trim()==="Keep the movement controlled."));
 const resolved=resolveNoteConflict(refreshed,refreshed.exerciseNotes[0].id!,"P","Workbook edit",false);
 const corrected=await exportExerciseNotes(external,resolved.plans[0],resolved);
 assert.equal((await imported(corrected.bytes)).noteContributions?.[0].text,"Local edit");
});

test("malformed annotation parts warn without blocking usable exercises; export refuses destructive repair",async()=>{
 const f=await setup(),zip=await JSZip.loadAsync(f.bytes);
 zip.file("xl/comments-synthetic.xml","<comments><broken>");
 const broken=new Uint8Array(await zip.generateAsync({type:"uint8array"})), parsed=await imported(broken);
 assert.equal(parsed.workouts.length,1);assert(parsed.warnings.some(w=>w.code==="annotation-part"));
 assert(!parsed.warnings.some(w=>w.severity==="activationBlocker"));
 await assert.rejects(()=>exportExerciseNotes(broken,f.data.plans[0],f.data),/unsupported or malformed/);
});

test("unrepresentable XML text is retained locally and refused during export rather than corrupted",async()=>{
 const f=await setup();f.data.exerciseNotes[0].text="Keep locally\u0001";
 await assert.rejects(()=>exportExerciseNotes(f.bytes,f.data.plans[0],f.data),/characters Excel cannot store/);
 assert.equal(f.data.exerciseNotes[0].text,"Keep locally\u0001");
});

test("multiple personal entries, unicode and interrupted-session exports preserve independent identities",async()=>{
 const f=await setup();
 let data=saveScopedNote(f.data,"P","A","A-strength-26-1","Segunda nota: ação & <amplitude> \"boa\" 💪\nOutra linha");
 data=startTrainingSession(data,"P","A",new Date("2026-11-01T08:00:00Z"),"interrupted").data;
 const before=JSON.stringify(data.sessions),first=await exportExerciseNotes(f.bytes,data.plans[0],data);
 assert.equal(JSON.stringify(data.sessions),before);
 const read=await imported(first.bytes);assert.equal(read.noteContributions?.length,2);
 assert.equal(new Set(read.noteContributions?.map(n=>n.id)).size,2);
 assert(read.noteContributions?.some(n=>n.text.includes("💪\nOutra linha")));
 const saved=applyNoteUpdates(data,"P",first.updates),next=await exportExerciseNotes(first.bytes,saved.plans[0],saved);
 assert.equal((await imported(next.bytes)).noteContributions?.length,2);
 independentlyValidate(next.bytes);
});

test("legacy local notes retain their old version when scoped, never export twice and cannot resurrect after removal",async()=>{
 const bytes=await annotatedFixture("legacy");let data=addTraining(emptyTrainingData(),await imported(bytes),"Synthetic",undefined,"P");
 data=updateExerciseNote(data,"P","Nova Press","Old local text","2026-10-01T08:00:00Z");
 data=saveScopedNote(data,"P","A","A-strength-26-1","Updated text");
 assert.equal(data.exerciseNotes.length,2);assert.equal(data.exerciseNotes[1].history?.[0].text,"Old local text");
 const first=await exportExerciseNotes(bytes,data.plans[0],data);assert.equal((await imported(first.bytes)).noteContributions?.length,1);
 data=applyNoteUpdates(data,"P",first.updates);
 const current=data.exerciseNotes.find(n=>n.id)!;data=saveScopedNote(data,"P","A","A-strength-26-1","",current.id);
 const removed=await exportExerciseNotes(first.bytes,data.plans[0],data);
 const read=await imported(removed.bytes);assert.equal(read.noteContributions?.length,1);assert.equal(read.noteContributions![0].text,"");
 assert.equal(data.exerciseNotes[0].text,"Old local text");
});

test("identical exercise names on separate worksheets keep instructor and personal contributions separate",async()=>{
 const bytes=await annotatedFixture("legacy"),zip=await JSZip.loadAsync(bytes);
 zip.file("xl/workbook.xml",(await zip.file("xl/workbook.xml")!.async("string")).replace(/<\/(?:\w+:)?sheets>/,'<sheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="TREINO B" sheetId="2" r:id="syntheticB"/>$&'));
 zip.file("xl/_rels/workbook.xml.rels",(await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).replace(/<\/(?:\w+:)?Relationships>/,'<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="syntheticB" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>$&'));
 zip.file("xl/worksheets/sheet2.xml",await zip.file("xl/worksheets/sheet1.xml")!.async("string"));
 zip.file("xl/worksheets/_rels/sheet2.xml.rels",(await zip.file("xl/worksheets/_rels/sheet1.xml.rels")!.async("string")).replace("comments-synthetic.xml","comments-second.xml"));
 zip.file("xl/comments-second.xml",(await zip.file("xl/comments-synthetic.xml")!.async("string")).replace("Keep the movement controlled.","Second worksheet guidance."));
 zip.file("[Content_Types].xml",(await zip.file("[Content_Types].xml")!.async("string")).replace(/<\/(?:\w+:)?Types>/,'<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/comments-second.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>$&'));
 const input=new Uint8Array(await zip.generateAsync({type:"uint8array"})),training=await imported(input);
 assert.equal(training.workouts.length,2);
 assert(training.workouts[1].blocks.some(b=>b.kind==="exercise"&&b.sourceNotes?.some(n=>n.text==="Second worksheet guidance.")));
 let data=addTraining(emptyTrainingData(),training,"Synthetic",undefined,"P");
 data=saveScopedNote(data,"P","A","A-strength-26-1","Only A");data=saveScopedNote(data,"P","B","B-strength-26-1","Only B");
 const output=await exportExerciseNotes(input,data.plans[0],data),read=await imported(output.bytes);
 assert.equal(read.noteContributions?.filter(n=>n.sheet==="TREINO A")[0].text,"Only A");
 assert.equal(read.noteContributions?.filter(n=>n.sheet==="TREINO B")[0].text,"Only B");
 independentlyValidate(output.bytes);
});

test("moving an already exported note with its exercise follows the contribution ID, not its old row",async()=>{
 const f=await setup("legacy"),first=await exportExerciseNotes(f.bytes,f.data.plans[0],f.data);
 const saved=applyNoteUpdates(f.data,"P",first.updates),zip=await JSZip.loadAsync(first.bytes);
 const path=(await snapshotFromXlsx(first.bytes)).sheets[0].path!;
 let text=await zip.file(path)!.async("string");
 const a=text.match(/<(?:\w+:)?c\b(?=[^>]*\br="E26")[^>]*>[\s\S]*?<\/(?:\w+:)?c>/)![0],b=text.match(/<(?:\w+:)?c\b(?=[^>]*\br="E28")[^>]*>[\s\S]*?<\/(?:\w+:)?c>/)![0];
 text=text.replace(a,b.replace('r="E28"','r="E26"')).replace(b,a.replace('r="E26"','r="E28"'));
 zip.file(path,text);zip.file("xl/comments-synthetic.xml",(await zip.file("xl/comments-synthetic.xml")!.async("string")).replace('ref="E26"','ref="E28"'));
 const moved=new Uint8Array(await zip.generateAsync({type:"uint8array"})),parsed=await imported(moved);
 assert.equal(parsed.noteContributions?.[0].cell,"E28");
 const output=await exportExerciseNotes(moved,saved.plans[0],saved);
 assert.equal((await imported(output.bytes)).noteContributions?.[0].cell,"E28");
});

test("thread extensions stay terminal and metadata loss cannot cause duplicate owned entries",async()=>{
 const f=await setup("threaded","A-strength-28-1"),zip=await JSZip.loadAsync(f.bytes);
 for(const [part,closing] of [["xl/threadedComments/synthetic.xml","ThreadedComments"],["xl/persons/person.xml","personList"]])zip.file(part,(await zip.file(part)!.async("string")).replace(`</${closing}>`,`<extLst><ext xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" uri="synthetic-extension"><custom xmlns="urn:synthetic"/></ext></extLst></${closing}>`));
 const output=await exportExerciseNotes(new Uint8Array(await zip.generateAsync({type:"uint8array"})),f.data.plans[0],f.data);
 const updated=await JSZip.loadAsync(output.bytes);
 for(const [part,rootTag] of [["xl/threadedComments/synthetic.xml","ThreadedComments"],["xl/persons/person.xml","personList"]]) {
  const text=await updated.file(part)!.async("string");assert.match(text,new RegExp(`</extLst></${rootTag}>$`));
 }
 const saved=applyNoteUpdates(f.data,"P",output.updates);
 // Simulate ownership metadata being stripped by an external tool; do not guess ownership.
 updated.remove(MANIFEST_PATH);
 const stripped=new Uint8Array(await updated.generateAsync({type:"uint8array"}));
 await assert.rejects(()=>exportExerciseNotes(stripped,saved.plans[0],saved),/not an app-authored/);
});

const MANIFEST_PATH="customXml/treino-exercise-notes.xml";

test("actual instructor workbook remains read-only and imports its modern comment threads",{skip:!process.env.WORKBOOK_COMMENT_FIXTURE},async()=>{
 const file=process.env.WORKBOOK_COMMENT_FIXTURE!,bytes=new Uint8Array(await readFile(file)),hash=createHash("sha256").update(bytes).digest("hex");
 const parsed=await imported(bytes);
 assert.equal(parsed.workouts.length,2);assert.equal(parsed.workouts.flatMap(w=>w.blocks.filter(b=>b.kind==="exercise")).length,24);
 assert.equal(parsed.excelAnnotations?.filter(n=>n.format==="threaded").length,10);
 assert(!parsed.warnings.some(w=>w.severity==="activationBlocker"));
 assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"),hash);
});
