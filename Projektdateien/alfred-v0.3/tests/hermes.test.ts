import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.ts';
import {workerCall,HERMES_MODEL,createHermes} from '../hermes.ts';
const listen=(app:any)=>new Promise<string>(resolve=>app.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${app.address().port}`)));
const close=(app:any)=>new Promise<void>(resolve=>{app.close(()=>resolve());app.closeAllConnections();});
test('Hermes übergibt nur bestätigten Text, kennzeichnet Ergebnisse und erhält ihre Herkunft in Sicherungen',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'alfred-hermes-test-'));let remote=false,mode='success',received:any[]=[],finish:()=>void=()=>{},aborted:()=>void=()=>{};
 const catalog=createServer((_req,res)=>res.end(JSON.stringify({models:[{name:HERMES_MODEL,...(remote?{remote_host:'cloud.example'}:{})}]})));const ollama=await listen(catalog);
 const hermes={status:async()=>({ready:true,message:'Bereit'}),run:async(content:string,signal:AbortSignal)=>{received.push(content);if(mode==='fail')throw Error('Testfehler');if(mode==='wait'){await new Promise<void>((resolve,reject)=>{finish=resolve;signal.addEventListener('abort',()=>{aborted();reject(Error('Abgebrochen'));},{once:true});});}return {content:'09:00 Frühstücken\n10:00 Pause',model:HERMES_MODEL};}};
 let app=createApp({dataDir:directory,ollama,hermes});let base=await listen(app);
 const request=(path:string,method='GET',body?:any,signal?:AbortSignal,headers={})=>fetch(base+'/api'+path,{method,signal,headers:{...(method==='GET'?{}:{'Content-Type':'application/json'}),...headers},body:method==='GET'?undefined:JSON.stringify(body||{})});
 const send=(body:any,signal?:AbortSignal,headers={})=>request('/hermes/requests','POST',body,signal,headers);
 try{
 const chat=await request('/chats','POST').then(r=>r.json());await request('/memories','POST',{content:'Privater Fakt, nie an Hermes'});await request('/tasks','POST',{day:'2026-10-26',tasks:[{text:'Private Aufgabe',time:''}]});
 assert.equal((await request('/hermes/status').then(r=>r.json())).ready,true);
 const payload={content:'Nur diese ausgewählte Frage $(NICHT_AUSFUEHREN)',chatId:chat.id,confirmed:true};
 assert.equal((await send({...payload,confirmed:false})).status,400);
 assert.equal((await send({...payload,base_url:'https://evil.example'})).status,400);
 assert.equal((await send({...payload,memories:['Privater Fakt']})).status,400);
 assert.equal((await send({...payload,content:'x'.repeat(4001)})).status,400);
 assert.equal((await send(payload,undefined,{Origin:'https://evil.example'})).status,403);
 assert.equal((await send({...payload,chatId:'missing'})).status,404);assert.equal(received.length,0);
 remote=true;assert.equal((await send(payload)).status,502);assert.equal(received.length,0);remote=false;
 assert.equal((await send(payload)).status,200);assert.deepEqual(received,[payload.content]);
 let messages=await request('/chats/'+chat.id).then(r=>r.json());assert.equal(messages.length,2);assert.ok(messages.every((m:any)=>m.source==='hermes'));assert.equal(messages[1].role,'assistant');
 const state=await request('/state').then(r=>r.json());assert.equal(state.memories.length,1);assert.equal((await request('/tasks?day=2026-10-26').then(r=>r.json())).length,1);
 const backup=await request('/export').then(r=>r.json());assert.equal(backup.version,3);assert.ok(backup.messages.every((m:any)=>m.source==='hermes'));assert.match(await request('/chats/'+chat.id+'/export').then(r=>r.text()),/HERMES/);
 assert.equal((await request('/import','POST',{...backup,messages:backup.messages.map((m:any)=>({...m,source:'unknown'}))})).status,400);
 assert.equal((await request('/import','POST',backup)).status,201);
 const restored=await request('/state').then(r=>r.json());const other=restored.chats.find((c:any)=>c.id!==chat.id);assert.ok((await request('/chats/'+other.id).then(r=>r.json())).every((m:any)=>m.source==='hermes'));
 mode='fail';assert.equal((await send({...payload,chatId:null})).status,502);assert.equal((await request('/state').then(r=>r.json())).chats.length,2);
 mode='wait';const controller=new AbortController();const pending=send(payload,controller.signal).catch(()=>null);
 while(received.length<3)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await request('/memories','POST',{content:'Nicht während Antwort'})).status,409);
 const cancelled=new Promise<void>(resolve=>aborted=resolve);controller.abort();await cancelled;await pending;
 while((await request('/state').then(r=>r.json())).busy)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await request('/chats/'+chat.id).then(r=>r.json())).length,2);
 mode='success';await close(app);app=createApp({dataDir:directory,ollama,hermes});base=await listen(app);assert.ok((await request('/chats/'+chat.id).then(r=>r.json())).every((m:any)=>m.source==='hermes'));
 }finally{finish();await close(app);await close(catalog);rmSync(directory,{recursive:true,force:true});}
});
test('Hermes-Prozess: Text über stdin, Unicode, begrenzte Ausgabe, Fehler, Timeout und Abbruch',async()=>{
 const run=(code:string,input='',options={})=>workerCall(process.execPath,['-e',code],input,options);
 const input='Grüße 👋 " $(nicht-ausführen)';
 assert.deepEqual(await run('let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({text:s,argv:process.argv.slice(1)})));',input),{text:input,argv:[]});
 await assert.rejects(run('console.log("not json")'),/gültige/);
 await assert.rejects(run('process.exit(1)'),/vollständige/);
 await assert.rejects(run('process.stdout.write("x".repeat(300000));setInterval(()=>{},1000)'),/umfangreich/);
 await assert.rejects(run('setInterval(()=>{},1000)','',{timeout:30}),/Zeitlimit/);
 const controller=new AbortController();const pending=run('setInterval(()=>{},1000)','',{signal:controller.signal});controller.abort();await assert.rejects(pending,/abgebrochen/);
 await assert.rejects(run('console.log("{}")','',{signal:AbortSignal.abort()}),/abgebrochen/);
 assert.equal((await createHermes({home:'/nonexistent-alfred-test'}).status()).ready,false);
});

test('Erinnerungsauswahl ergänzt ausschließlich ausdrücklich gewählte aktive Fakten im sichtbaren Entwurf',async()=>{
 const {selectedMemoryDraft}=await import('../public/hermes-memory.js');
 const memories=[{id:'a',enabled:1,content:'Ich bevorzuge Pausen.'},{id:'b',enabled:1,content:'Privater anderer Fakt'},{id:'c',enabled:0,content:'Pausierter Fakt'},{id:'d',enabled:true,content:'Text mit "Anführungszeichen" und\nZeilenumbruch'}];
 const before=JSON.stringify(memories);const draft=selectedMemoryDraft('Bitte meinen Tag planen.',memories,['a','d','a']);
 assert.match(draft,/Bitte meinen Tag planen/);assert.match(draft,/Ich bevorzuge Pausen/);assert.doesNotMatch(draft,/Privater anderer Fakt|Pausierter Fakt/);
 const facts=JSON.parse(draft.slice(draft.indexOf('[\n')));assert.deepEqual(facts,[memories[0].content,memories[3].content]);assert.equal(JSON.stringify(memories),before);
 assert.throws(()=>selectedMemoryDraft('Frage',memories,['c']),/nicht aktiv/);assert.throws(()=>selectedMemoryDraft('Frage',memories,['fehlt']),/nicht aktiv/);assert.throws(()=>selectedMemoryDraft('Frage',memories,[]),/mindestens/);
 assert.throws(()=>selectedMemoryDraft('x'.repeat(3999),memories,['a']),/4000/);assert.throws(()=>selectedMemoryDraft('',memories,['a']),/zuerst eine Frage/);
});
