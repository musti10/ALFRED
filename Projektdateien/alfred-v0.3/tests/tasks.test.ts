import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.ts';
import {parseTaskLines,suggestedTaskLines,localDay} from '../public/task-parser.js';
import {validDay} from '../task-store.ts';
const listen=(app:any)=>new Promise<string>(resolve=>app.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${app.address().port}`)));
const close=(app:any)=>new Promise<void>(resolve=>{app.close(()=>resolve());app.closeAllConnections();});
test('Tagespläne vorschlagen und prüfen, ohne Einleitung oder freie Tage zu erfinden',()=>{
 const original='Hier ist Ihr Plan:\n\n9:00 Uhr: Frühstück\n10:30 Uhr: Einkaufen\n\nDer Plan ist flexibel.';
 assert.equal(suggestedTaskLines(original),'9:00 Uhr: Frühstück\n10:30 Uhr: Einkaufen');
 assert.deepEqual(parseTaskLines(suggestedTaskLines(original)),[{time:'09:00',text:'Frühstück'},{time:'10:30',text:'Einkaufen'}]);
 assert.deepEqual(parseTaskLines('- [ ] **Spaziergang**\n2. Pause'),[{time:'',text:'Spaziergang'},{time:'',text:'Pause'}]);
 assert.throws(()=>parseTaskLines('25:00 Einkaufen'),/Ungültige/);
 assert.throws(()=>parseTaskLines('Aufgabe\n'.repeat(51)),/höchstens 50/);
 assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2028-02-29'),true);assert.equal(localDay(new Date(2026,9,26,12)),'2026-10-26');
});
test('Aufgaben bearbeiten, abhaken, erhalten, sichern und kontrolliert wiederherstellen',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'alfred-tasks-'));let app=createApp({dataDir});let base=await listen(app);
 const request=(path:string,method='GET',body?:any,headers={})=>fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json'}),...headers},body:method==='GET'?undefined:JSON.stringify(body||{})});
 const day='2026-10-27';
 try{
 const tasks=[{text:'Frühstück',time:'09:00'},{text:'Pause',time:''}];
 assert.equal((await request('/tasks','POST',{day,tasks},{Origin:'https://evil.example'})).status,403);
 assert.equal((await request('/tasks','POST',{day:'2026-02-30',tasks})).status,400);
 assert.equal((await request('/tasks','POST',{day,tasks:[{text:'Ungültig',time:'25:00'}]})).status,400);
 assert.equal((await request('/tasks','POST',{day,tasks})).status,201);
 assert.equal((await request('/tasks','POST',{day,tasks}).then(r=>r.json())).added,0);
 const stored=await request('/tasks?day='+day).then(r=>r.json());assert.equal(stored.length,2);assert.equal(stored[0].text,'Frühstück');
 assert.equal((await request('/tasks/'+stored[0].id,'PATCH',{text:'In Ruhe frühstücken',time:'09:30',done:true})).status,200);
 const backup=await request('/export').then(r=>r.json());assert.equal(backup.version,3);assert.equal(backup.tasks.length,2);assert.equal(backup.tasks.find((task:any)=>task.text==='In Ruhe frühstücken').done,1);
 assert.equal((await request('/tasks?day=2026-10-28').then(r=>r.json())).length,0);
 assert.equal((await request('/state').then(r=>r.json())).memories.length,0);
 await close(app);app=createApp({dataDir});base=await listen(app);
 assert.equal((await request('/tasks?day='+day).then(r=>r.json()))[0].done,1);
 const before=await request('/tasks?day='+day).then(r=>r.json());
 assert.equal((await request('/import','POST',{...backup,tasks:[{day,time:'09:30',text:'Ungültig',done:'ja'}]})).status,400);
 assert.deepEqual(await request('/tasks?day='+day).then(r=>r.json()),before);
 assert.equal((await request('/import','POST',backup).then(r=>r.json())).tasks,0);
 const old={format:'alfred-backup',version:1,chats:[],messages:[],memories:[]};assert.equal((await request('/import','POST',old)).status,201);
 await request('/tasks/'+stored[1].id,'DELETE');assert.equal((await request('/tasks?day='+day).then(r=>r.json())).length,1);
 await request('/data','DELETE');assert.equal((await request('/tasks?day='+day).then(r=>r.json())).length,0);
 const restore=await request('/import','POST',backup).then(r=>r.json());assert.equal(restore.tasks,2);assert.equal((await request('/tasks?day='+day).then(r=>r.json()))[0].done,1);
 const invalidBatch=Array.from({length:51},(_,i)=>({text:'Aufgabe '+i,time:''}));assert.equal((await request('/tasks','POST',{day,tasks:invalidBatch})).status,400);
 }finally{await close(app);rmSync(dataDir,{recursive:true,force:true});}
});

test('Planungsentwurf nimmt nur offene Aufgaben und erhält vorhandenen Text',async()=>{
 const {buildPlanningDraft,mergePlanningDraft}=await import('../public/task-parser.js');
 const tasks=[{text:'Frühstücken',time:'09:00',done:0},{text:'Schon erledigt',time:'',done:1},{text:'Pause',time:'',done:false}];
 const snapshot=JSON.stringify(tasks);const draft=buildPlanningDraft('2026-10-27',tasks);
 assert.match(draft,/27\.10\.2026/);assert.match(draft,/09:00 · Frühstücken/);assert.match(draft,/- Pause/);assert.doesNotMatch(draft,/Schon erledigt/);assert.equal(JSON.stringify(tasks),snapshot);
 assert.equal(mergePlanningDraft('Mein alter Entwurf',draft),'Mein alter Entwurf\n\n'+draft);assert.equal(mergePlanningDraft(draft,draft),draft);
 assert.throws(()=>buildPlanningDraft('2026-02-30',tasks),/gültiges Datum/);assert.throws(()=>buildPlanningDraft('2026-10-27',[tasks[1]]),/keine offenen/);
 assert.throws(()=>mergePlanningDraft('x'.repeat(3999),draft),/4000 Zeichen/);
 assert.throws(()=>buildPlanningDraft('2026-10-27',Array.from({length:20},()=>({text:'x'.repeat(400),time:'',done:0}))),/umfangreich/);
});
