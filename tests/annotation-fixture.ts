import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { MAIN, THREAD, REL } from "../lib/import/xlsx-annotations";
const root="{11111111-1111-4111-8111-111111111111}",reply="{22222222-2222-4222-8222-222222222222}",person="{33333333-3333-4333-8333-333333333333}";
const baseRel="http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const msRel="http://schemas.microsoft.com/office/2017/10/relationships/";
export async function annotatedFixture(format:"legacy"|"threaded"|"both"="both") {
 const zip=await JSZip.loadAsync(await readFile("tests/fixtures/mobile-audit.xlsx"));
 const sheets=(await snapshotFromXlsx(await zip.generateAsync({type:"uint8array"}))).sheets;
 const path=sheets[0].path!,rp=path.replace(/\/([^/]+)$/, "/_rels/$1.rels");
 const relations=zip.file(rp)?await zip.file(rp)!.async("string"):`<Relationships xmlns="${REL}"></Relationships>`;
 const extra=(format!=="threaded"?`<Relationship xmlns="${REL}" Id="legacy" Type="${baseRel}comments" Target="../comments-synthetic.xml"/>`:"")+(format!=="legacy"?`<Relationship xmlns="${REL}" Id="threaded" Type="${msRel}threadedComment" Target="../threadedComments/synthetic.xml"/>`:"");
 zip.file(rp,relations.replace(/<\/(?:\w+:)?Relationships>/,`${extra}</Relationships>`));
 if(format!=="threaded")zip.file("xl/comments-synthetic.xml",`<comments xmlns="${MAIN}"><authors><author>Synthetic coach</author>${format==="both"?`<author>tc=${root}</author>`:""}</authors><commentList><comment ref="E26" authorId="0"><text><r><rPr><b/></rPr><t>Keep the movement controlled.</t></r></text></comment><comment ref="A1" authorId="0"><text><t>Unrelated admin note</t></text></comment>${format==="both"?'<comment ref="E28" authorId="1"><text><t>[Threaded comment] compatibility rendering</t></text></comment>':""}</commentList></comments>`);
 if(format!=="legacy") {
  zip.file("xl/threadedComments/synthetic.xml",`<ThreadedComments xmlns="${THREAD}"><threadedComment ref="E28" dT="2026-10-22T14:03:40Z" personId="${person}" id="${root}"><text>Coach thread guidance.</text></threadedComment><threadedComment ref="E28" dT="2026-10-23T14:03:40Z" personId="${person}" id="${reply}" parentId="${root}"><text>Coach follow-up.</text></threadedComment></ThreadedComments>`);
  zip.file("xl/persons/person.xml",`<personList xmlns="${THREAD}"><person id="${person}" displayName="Synthetic coach"/></personList>`);
  zip.file("xl/_rels/workbook.xml.rels",(await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).replace(/<\/(?:\w+:)?Relationships>/,`<Relationship xmlns="${REL}" Id="people" Type="${msRel}person" Target="persons/person.xml"/></Relationships>`));
 }
 // Explicit source content types, independently checked after export.
 zip.file("[Content_Types].xml",(await zip.file("[Content_Types].xml")!.async("string")).replace(/<\/(?:\w+:)?Types>/,`${format!=="threaded"?'<Override PartName="/xl/comments-synthetic.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>':""}${format!=="legacy"?'<Override PartName="/xl/threadedComments/synthetic.xml" ContentType="application/vnd.ms-excel.threadedcomments+xml"/><Override PartName="/xl/persons/person.xml" ContentType="application/vnd.ms-excel.person+xml"/>':""}</Types>`));
 return new Uint8Array(await zip.generateAsync({type:"uint8array"}));
}
