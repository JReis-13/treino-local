import { exerciseKey } from "@/lib/training/exercise-notes";
import type { ExerciseBlock, ExerciseNote, ImportedTraining, TrainingData, TrainingWorkout } from "@/types/training";

export const noteIdentity=(block:ExerciseBlock)=>`${exerciseKey(block.name)}|${exerciseKey(block.equipment??"")}`;
export function notesForExcelExport(data: TrainingData, planId: string) {
  const notes = data.exerciseNotes.filter(note => note.planId === planId);
  const scopedKeys = new Set(notes.filter(note => note.id && note.workoutId && note.identity).map(note => note.exerciseKey));
  return notes.filter(note => (note.text || note.exported) && (note.id || !scopedKeys.has(note.exerciseKey)));
}
export function scopedNotes(data:TrainingData,planId:string,workout:TrainingWorkout,block:ExerciseBlock) {
  const identity=noteIdentity(block);
  if(workout.blocks.filter(b=>b.kind==="exercise"&&noteIdentity(b)===identity).length!==1) return [];
  return data.exerciseNotes.filter(n=>n.planId===planId&&n.workoutId===workout.id&&n.identity===identity);
}
export function saveScopedNote(data:TrainingData,planId:string,workoutId:string,blockId:string,text:string,id?:string,now=new Date().toISOString()):TrainingData {
  const workout=data.plans.find(p=>p.id===planId)?.workouts.find(w=>w.id===workoutId);
  const block=workout?.blocks.find(b=>b.id===blockId);
  if(!workout||block?.kind!=="exercise") throw new Error("Exercise unavailable in the current plan. Existing notes are unchanged.");
  if(workout.blocks.filter(b=>b.kind==="exercise"&&noteIdentity(b)===noteIdentity(block)).length!==1)throw new Error("These exercises have indistinguishable names and equipment. Review the plan before assigning a personal note.");
  if(text.trim().length>1000) throw new Error("Exercise note is too long.");
  const existing=id?scopedNotes(data,planId,workout,block).find(n=>n.id===id):undefined;
  const legacy=!id&&!scopedNotes(data,planId,workout,block).length?data.exerciseNotes.find(n=>n.planId===planId&&!n.workoutId&&n.exerciseKey===exerciseKey(block.name)):undefined;
  if(!text.trim()&&!id&&!legacy)return data;
  if(id&&!existing) throw new Error("This note no longer matches the selected exercise.");
  if(existing?.text===text.trim()) return data;
  const note:ExerciseNote={...existing,id:existing?.id??`{${crypto.randomUUID().toUpperCase()}}`,planId,workoutId,
    exerciseKey:exerciseKey(block.name),identity:noteIdentity(block),text:text.trim(),createdAt:existing?.createdAt??legacy?.updatedAt??now,updatedAt:now,
    history:existing?[...(existing.history??[]),{text:existing.text,updatedAt:existing.updatedAt}]:legacy?[{text:legacy.text,updatedAt:legacy.updatedAt}]:[]};
  return {...data,exerciseNotes:[...data.exerciseNotes.filter(n=>n!==existing),note]};
}
/** A reviewed import merges annotation versions only; completed sessions are never touched. */
export function reconcileNotes(data:TrainingData,planId:string,imported:ImportedTraining,old?:TrainingData["plans"][number]):TrainingData {
  let notes=[...data.exerciseNotes];
  for(const contribution of imported.noteContributions??[]) {
    const workout=imported.workouts.find(w=>imported.source.kind!=="builtin"&&imported.source.mappings[w.id]?.sheetName===contribution.sheet);
    const candidates=workout?.blocks.filter((b):b is ExerciseBlock=>b.kind==="exercise"&&noteIdentity(b)===contribution.identity)??[];
    if (!workout || candidates.length !== 1 || candidates[0].sourceCell !== contribution.cell) continue;
    const existing=notes.find(n=>n.planId===planId&&n.id===contribution.id);
    if (existing && (existing.workoutId !== workout.id || existing.identity !== contribution.identity)) continue;
    const common={id:contribution.id,planId,workoutId:workout.id,identity:contribution.identity,exerciseKey:exerciseKey(candidates[0].name),createdAt:contribution.createdAt};
    if(!existing) notes.push({...common,text:contribution.text,updatedAt:contribution.updatedAt,exported:{text:contribution.text,updatedAt:contribution.updatedAt,generatedAt:contribution.updatedAt}});
    else if(existing.text===contribution.text) notes=notes.map(n=>n!==existing?n:{...n,exported:{text:contribution.text,updatedAt:contribution.updatedAt,generatedAt:contribution.updatedAt}});
    else if(existing.exported?.text!==contribution.text) notes=notes.map(n=>n!==existing?n:{...n,conflicts:[...new Set([...(n.conflicts??[]),contribution.text])]});
  }
  const previous=old?.excelAnnotations??[];
  const merged=(imported.excelAnnotations??[]).map(n=>{const before=previous.find(p=>p.id===n.id);return {...n,previousTexts:[...new Set([...(before?.previousTexts??[]),...(before&&before.text!==n.text?[before.text]:[])])]};});
  return {...data,exerciseNotes:notes,plans:data.plans.map(p=>p.id!==planId?p:{...p,
    excelAnnotations:[...merged,...previous.filter(n=>!merged.some(m=>m.id===n.id))],
    workouts:p.workouts.map(w=>({...w,blocks:w.blocks.map(b=>b.kind!=="exercise"?b:{...b,sourceNotes:b.sourceNotes?.map(n=>({...n,previousTexts:merged.find(m=>m.id===n.id)?.previousTexts}))})}))})};
}
export function resolveNoteConflict(data:TrainingData,id:string,planId:string,workbookText:string,useWorkbook:boolean):TrainingData {
  return {...data,exerciseNotes:data.exerciseNotes.map(n=>n.id!==id||n.planId!==planId?n:{...n,
    history:[...(n.history??[]),{text:n.text,updatedAt:n.updatedAt},{text:workbookText,updatedAt:new Date().toISOString()}],
    ...(useWorkbook?{text:workbookText,updatedAt:new Date().toISOString()}:{}),
    exported:{text:workbookText,updatedAt:n.updatedAt,generatedAt:new Date().toISOString()},conflicts:(n.conflicts??[]).filter(t=>t!==workbookText)})};
}
export function applyNoteUpdates(data:TrainingData,planId:string,updates:ExerciseNote[]):TrainingData {
  const notes=[...data.exerciseNotes];
  for(const note of updates) {
    let i=notes.findIndex(n=>n.planId===planId&&n.id===note.id);
    if(i<0)i=notes.findIndex(n=>n.planId===planId&&!n.id&&n.exerciseKey===note.exerciseKey&&!n.workoutId);
    if(i<0||notes[i].updatedAt!==note.updatedAt||notes[i].text!==note.text)throw new Error("A note changed while exporting. Retry to include its saved version.");
    notes[i]=note;
  }
  return {...data,exerciseNotes:notes};
}
