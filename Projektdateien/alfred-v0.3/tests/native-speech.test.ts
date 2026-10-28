import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createApp} from '../server.ts';import {createAudioReader} from '../public/audio-reader.js';
const listen=(app:any)=>new Promise<string>(resolve=>app.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${app.address().port}`)));
const close=(app:any)=>new Promise<void>(resolve=>{app.close(()=>resolve());app.closeAllConnections();});
test('Sprachmodus nutzt begrenzten Verlauf und aktive Fakten; bestätigte TTS verändert keine Daten und Abbruch speichert nichts',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'alfred-spoken-'));const calls:any[]=[];let mode='success',entered:()=>void=()=>{},cancelled:()=>void=()=>{};
 const spoken={status:async()=>({ready:true,voice:'Thorsten',wakeWord:false}),answer:async(payload:any,signal:AbortSignal)=>{calls.push(payload);if(mode==='fail')throw Error('Testfehler');if(mode==='wait'){entered();await new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>{cancelled();reject(Error('Abgebrochen'));},{once:true}));}return 'Bereit, Sir.';},synthesize:async(text:string,_signal:AbortSignal)=>{calls.push({spoken:text});return Buffer.from('RIFFfakeaudioWAVE');}};
 const app=createApp({dataDir,spoken});const base=await listen(app);
 const req=(p:string,method='GET',body?:any,signal?:AbortSignal,headers={})=>fetch(base+'/api'+p,{method,signal,headers:{...(method==='GET'?{}:{'Content-Type':'application/json'}),...headers},body:method==='GET'?undefined:JSON.stringify(body||{})});
 try{
 assert.equal((await req('/voice/output/status').then(r=>r.json())).wakeWord,false);
 const chat=await req('/chats','POST').then(r=>r.json());await req('/memories','POST',{content:'Ich mag kurze Antworten.'});const paused=await req('/memories','POST',{content:'Pausierter Fakt.'}).then(r=>r.json());await req('/memories/'+paused.id,'PATCH',{content:'Pausierter Fakt.',enabled:false});
 assert.equal((await req('/chats/'+chat.id+'/messages','POST',{content:'Frage',engine:'cloud'})).status,400);
 const response=await req('/chats/'+chat.id+'/messages','POST',{content:'Erste Frage',engine:'pipecat',stream:true});const stream=await response.text();assert.match(stream,/"done"/);assert.match(stream,/Bereit, Sir/);
 assert.deepEqual(calls[0].history,[]);assert.deepEqual(calls[0].memories.map((m:any)=>m.content),['Ich mag kurze Antworten.']);
 await req('/chats/'+chat.id+'/messages','POST',{content:'Zweite Frage',engine:'pipecat'});assert.equal(calls[1].history.length,2);assert.equal(calls[1].history[0].content,'Erste Frage');
 const before=await req('/export').then(r=>r.json());
 for(const payload of [{text:'Test'},{text:'x'.repeat(4001),confirmed:true},{text:'Test',confirmed:true,command:'say'}])assert.equal((await req('/voice/synthesize','POST',payload)).status,400);
 assert.equal((await req('/voice/synthesize','POST',{text:'Test',confirmed:true},undefined,{Origin:'https://evil.example'})).status,403);
 const audio=await req('/voice/synthesize','POST',{text:'  Bereit, Sir.  ',confirmed:true});assert.equal(audio.headers.get('content-type'),'audio/wav');assert.equal(await audio.text(),'RIFFfakeaudioWAVE');assert.deepEqual(calls.at(-1),{spoken:'Bereit, Sir.'});
 const after=await req('/export').then(r=>r.json());for(const key of ['chats','messages','memories','tasks'])assert.deepEqual(after[key],before[key]);
 mode='fail';assert.equal((await req('/chats/'+chat.id+'/messages','POST',{content:'Fehler',engine:'pipecat'})).status,502);assert.equal((await req('/chats/'+chat.id).then(r=>r.json())).length,4);
 mode='wait';const controller=new AbortController();const started=new Promise<void>(resolve=>entered=resolve),stopped=new Promise<void>(resolve=>cancelled=resolve);
 const pending=req('/chats/'+chat.id+'/messages','POST',{content:'Abbruch',engine:'pipecat'},controller.signal).catch(()=>null);await started;controller.abort();await stopped;await pending;
 while((await req('/state').then(r=>r.json())).busy)await new Promise(r=>setTimeout(r,5));assert.equal((await req('/chats/'+chat.id).then(r=>r.json())).length,4);
 }finally{await close(app);rmSync(dataDir,{recursive:true,force:true});}
});
test('Lokale Audiowiedergabe stoppt laufende Ausgabe und verwirft späte Antworten',async()=>{
 const audio:any[]=[];const revoked:string[]=[];let sent:any=null,resolveFetch:any,signal:any;
 const reader=createAudioReader({fetcher:async(_url:any,options:any)=>{sent=JSON.parse(options.body);signal=options.signal;return new Promise(resolve=>resolveFetch=resolve);},makeAudio:url=>{const a={src:url,play:async()=>{},pause(){this.paused=true;},paused:false,onended:null,onerror:null};audio.push(a);return a;},urls:{createObjectURL:()=> 'blob:local',revokeObjectURL:url=>revoked.push(url)} as any});
 const first=reader.read(' Geprüfter Text ');assert.deepEqual(sent,{text:'Geprüfter Text',confirmed:true});reader.stop();assert.equal(signal.aborted,true);
 resolveFetch({ok:true,headers:{get:()=> 'audio/wav'},blob:async()=>new Blob(['audio'])});await first;assert.equal(audio.length,0);
 const second=reader.read('Zweiter Text');resolveFetch({ok:true,headers:{get:()=> 'audio/wav'},blob:async()=>new Blob(['audio'])});await second;assert.equal(audio.length,1);const ended=audio[0].onended;reader.stop();assert.equal(audio[0].paused,true);assert.deepEqual(revoked,['blob:local']);ended();assert.equal(revoked.length,1);
 await assert.rejects(reader.read('x'.repeat(4001)),/4000/);
});
test('Satzweise Ausgabe startet mit dem ersten Satz; Stopp verwirft weitere Sätze',async()=>{
 const sent:string[]=[],audio:any[]=[],revoked:string[]=[];let completed=0;
 const reader=createAudioReader({completed:()=>completed++,fetcher:async(_url:any,options:any)=>{sent.push(JSON.parse(options.body).text);return {ok:true,headers:{get:()=> 'audio/wav'},blob:async()=>new Blob(['audio'])} as any;},makeAudio:url=>{const a={src:url,play:async()=>{},pause(){},onended:null,onerror:null};audio.push(a);return a;},urls:{createObjectURL:()=> 'blob:'+audio.length,revokeObjectURL:url=>revoked.push(url)} as any});
 await reader.read('Erster Satz. Zweiter Satz. Dritter Satz.');assert.deepEqual(sent,['Erster Satz.']);audio[0].onended();
 await new Promise(r=>setTimeout(r,0));assert.deepEqual(sent,['Erster Satz.','Zweiter Satz.']);const ended=audio[1].onended;reader.stop();ended();assert.equal(sent.length,2);assert.equal(revoked.length,2);assert.equal(completed,0);await reader.read('Fertig.');audio.at(-1).onended();assert.equal(completed,1);
});
test('Active synthesis blocks transcription and chat; cancellation releases the shared busy state',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'alfred-inference-lock-'));let entered:()=>void=()=>{},transcriptions=0;const started=new Promise<void>(r=>entered=r);
 const spoken={status:async()=>({ready:true}),answer:async()=> 'Bereit.',synthesize:async(_text:string,signal:AbortSignal)=>{entered();return await new Promise<Buffer>((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}};
 const app=createApp({dataDir,spoken,speech:{status:()=>({ready:true}),transcribe:async()=>{transcriptions++;return 'Test';}} as any});const base=await listen(app);
 const req=(path:string,body:any)=>fetch(base+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{const chat=await req('/chats',{}).then(r=>r.json());const controller=new AbortController();const audio=fetch(base+'/api/voice/synthesize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Test',confirmed:true}),signal:controller.signal}).catch(()=>null);await started;
 assert.equal((await fetch(base+'/api/state').then(r=>r.json())).busy,true);
 assert.equal((await fetch(base+'/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:'not launched'})).status,409);
 assert.equal((await req('/chats/'+chat.id+'/messages',{content:'Test',engine:'pipecat'})).status,409);assert.equal(transcriptions,0);
 controller.abort();await audio;for(let i=0;i<100;i++){if(!(await fetch(base+'/api/state').then(r=>r.json())).busy)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal((await fetch(base+'/api/state').then(r=>r.json())).busy,false);
 assert.equal((await req('/chats/'+chat.id+'/messages',{content:'Now available',engine:'pipecat'})).status,200);
 }finally{await close(app);rmSync(dataDir,{recursive:true,force:true});}
});
