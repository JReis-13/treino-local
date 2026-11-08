import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export function independentlyValidate(bytes: Uint8Array, originalPath?: string) {
 const result=spawnSync(process.env.PYTHON??(process.platform==="win32"?"python":"python3"),["-c",`import sys,io,zipfile,xml.etree.ElementTree as E,posixpath
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
types=E.fromstring(z.read('[Content_Types].xml'))
overrides={e.get('PartName').lstrip('/'):e.get('ContentType') for e in types if e.get('PartName')}
tc='http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments'
people=set()
for p in z.namelist():
 if p.endswith('.xml'):
  r=E.fromstring(z.read(p))
  if r.tag=='{'+tc+'}personList':
   assert overrides[p]=='application/vnd.ms-excel.person+xml'
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
   assert overrides[p]=='application/vnd.ms-excel.threadedcomments+xml'
   entries=[e for e in r if e.tag=='{'+tc+'}threadedComment'];ids={e.attrib['id']:e for e in entries};assert len(ids)==len(entries)
   if any(e.tag.endswith('}extLst') for e in r): assert r[-1].tag.endswith('}extLst')
   for e in entries:
    assert e.attrib['personId'] in people
    if 'parentId' in e.attrib: assert e.attrib['parentId'] in ids and ids[e.attrib['parentId']].attrib.get('ref')==e.attrib.get('ref')
if len(sys.argv)>1:
 original=zipfile.ZipFile(sys.argv[1])
 for p in original.namelist():
  if (p.startswith('xl/worksheets/') and p.endswith('.xml')) or p in ('xl/styles.xml','xl/sharedStrings.xml'):
   assert original.read(p)==z.read(p)
  if p.startswith('xl/threadedComments/') and p.endswith('.xml'):
   before=E.fromstring(original.read(p))
   after={e.get('id'):E.tostring(e) for e in E.fromstring(z.read(p)) if e.get('id')}
   assert all(after[e.get('id')]==E.tostring(e) for e in before if e.get('id'))
 manifest=E.fromstring(z.read('customXml/treino-exercise-notes.xml'))
 for n in manifest:
  if n.get('format')!='threaded': continue
  replies=[e for p in z.namelist() if p.startswith('xl/threadedComments/') and p.endswith('.xml')
           for e in E.fromstring(z.read(p)) if e.get('id')==n.get('id')]
  assert len(replies)==1 and replies[0].get('parentId') and replies[0].get('ref')==n.get('cell')
print('XML and package relationships valid')`,...(originalPath?[originalPath]:[])],{input:bytes,encoding:"utf8",windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/relationships valid/);
}
