import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.ts';
import {decodeWav} from '../voice.ts';
import {encodeWav} from '../public/pcm.js';
const tone=(seconds=1,rate=48000)=>Float32Array.from({length:seconds*rate},(_,i)=>Math.sin(i*2*Math.PI*440/rate)*0.2);
const listen=(app:any)=>new Promise<string>(resolve=>app.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${app.address().port}`)));
const close=(app:any)=>new Promise<void>(resolve=>{app.close(()=>resolve());app.closeAllConnections();});
test('WAV-Konvertierung und geschützter lokaler Transkriptionsendpunkt',async()=>{
 const wav=Buffer.from(encodeWav(tone(),48000));const decoded=decodeWav(wav);assert.equal(decoded.length,16000);assert.ok(Math.max(...decoded.subarray(0,1000))>0.1);
 assert.throws(()=>decodeWav(Buffer.from(encodeWav(new Float32Array(48000),48000))),/leise/);
 assert.throws(()=>decodeWav(Buffer.from('invalid')),/Ungültige/);
 const dataDir=mkdtempSync(join(tmpdir(),'alfred-mic-'));let called=0;
 const app=createApp({dataDir,speech:{status:()=>({ready:true,model:'test',maxSeconds:60,message:'test'}),transcribe:async(audio:Float32Array)=>{called++;assert.equal(audio.length,16000);return 'Plane einen ruhigen Tag.';}}});const base=await listen(app);
 try{
 const send=(headers:any,body:any=wav)=>fetch(base+'/api/voice/transcribe',{method:'POST',headers,body});
 assert.equal((await send({'Content-Type':'audio/wav',Origin:'https://evil.example'})).status,403);
 assert.equal((await send({'Content-Type':'application/json'},'{}')).status,415);
 assert.equal((await send({'Content-Type':'audio/wav'},Buffer.from('invalid'))).status,400);
 const result=await send({'Content-Type':'audio/wav'});assert.equal(result.status,200);assert.equal((await result.json()).text,'Plane einen ruhigen Tag.');assert.equal(called,1);
 assert.equal((await fetch(base+'/api/state').then(r=>r.json())).chats.length,0);
 assert.equal((await send({'Content-Type':'audio/wav'},Buffer.alloc(1920046))).status,413);
 }finally{await close(app);rmSync(dataDir,{recursive:true,force:true});}
});
test('Abbruch beendet die lokale Spracherkennung und gibt den Server wieder frei',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'alfred-mic-stop-'));let began:()=>void=()=>{},cancelled:()=>void=()=>{};
 const started=new Promise<void>(r=>began=r),stopped=new Promise<void>(r=>cancelled=r);
 const app=createApp({dataDir,speech:{status:()=>({ready:true,model:'test',maxSeconds:60,message:'test'}),transcribe:(_audio:Float32Array,signal:AbortSignal)=>new Promise<string>((_resolve,reject)=>{began();signal.addEventListener('abort',()=>{cancelled();reject(Error('Abbruch'));},{once:true});})}});const base=await listen(app);
 try{
 const controller=new AbortController();const response=fetch(base+'/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:encodeWav(tone(),48000),signal:controller.signal}).catch(()=>null);
 await started;controller.abort();await stopped;await response;
 const state=await fetch(base+'/api/state').then(r=>r.json());assert.equal(state.busy,false);assert.equal(state.chats.length,0);
 }finally{await close(app);rmSync(dataDir,{recursive:true,force:true});}
});
