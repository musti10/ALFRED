import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.ts';
const listen=(s:any)=>new Promise<string>(resolve=>s.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${s.address().port}`)));
const close=(s:any)=>new Promise<void>(resolve=>{s.close(()=>resolve());s.closeAllConnections();});
test('Chat, explizites Gedächtnis, Persistenz, Löschung und Zugriffsgrenzen',async()=>{
 let received:any;let fail=false;
 const mock=createServer(async(req,res)=>{if(req.url==='/api/tags'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({models:[{name:'alfred:latest'}]}));}let raw='';for await(const c of req)raw+=c;received=JSON.parse(raw);res.setHeader('Content-Type','application/json');res.statusCode=fail?500:200;res.end(JSON.stringify({message:{content:'Interner Denktext</think>Guten Abend, Sir.'}}));});
 const ollama=await listen(mock);const dataDir=mkdtempSync(join(tmpdir(),'alfred-test-'));let app=createApp({dataDir,ollama});let base=await listen(app);
 async function request(path:string,method='GET',body?:any,headers={}){return fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json'}),...headers},body:method==='GET'?undefined:JSON.stringify(body||{})});}
 try{
 assert.equal((await request('/status').then(r=>r.json())).ready,true);
 assert.equal((await request('/chats','POST',{}, {Origin:'https://evil.example'})).status,403);
 assert.equal(await new Promise(resolve=>{const r=httpRequest(base+'/api/state',{headers:{Host:'evil.example:3210'}},response=>{response.resume();resolve(response.statusCode);});r.end();}),403);
 const chat=await request('/chats','POST').then(r=>r.json());
 const memory=await request('/memories','POST',{content:'Ich heiße Max.'}).then(r=>r.json());
 assert.equal((await request('/chats/'+chat.id+'/messages','POST',{content:'Hallo'})).status,200);
 assert.equal((await request('/chats/'+chat.id).then(r=>r.json()))[1].content,'Guten Abend, Sir.');
 assert.match(received.messages[0].content,/Ich heiße Max/);assert.equal(received.think,false);
 assert.equal((await request('/memories','PATCH',{})).status,404);
 await request('/memories/'+memory.id,'PATCH',{content:'Ich heiße Max.',enabled:false});
 await request('/chats/'+chat.id+'/messages','POST',{content:'Weiter'});
 assert.doesNotMatch(received.messages[0].content,/Ich heiße Max/);
 assert.equal((await request('/chats/'+chat.id).then(r=>r.json())).length,4);
 const greeting=await request('/chats','POST').then(r=>r.json());
 const seed=new DatabaseSync(join(dataDir,'alfred.sqlite'));
 seed.prepare('INSERT INTO messages(id,chat,role,content) VALUES(?,?,?,?)').run('old-joke',greeting.id,'assistant','Wenn du zu laut bist, könnte ich einen Schatten werfen.');seed.close();
 await request('/chats/'+greeting.id+'/messages','POST',{content:'wie geht es dir'});
 const greetingMessages=await request('/chats/'+greeting.id).then(r=>r.json());
 assert.equal(greetingMessages.at(-1).content,'Alles in bester Ordnung, Sir. Wie geht es Ihnen?');
 await request('/chats/'+greeting.id,'DELETE');
 fail=true;assert.equal((await request('/chats/'+chat.id+'/messages','POST',{content:'Fehler'})).status,502);
 assert.equal((await request('/chats/'+chat.id).then(r=>r.json())).length,4);fail=false;
 await close(app);app=createApp({dataDir,ollama});base=await listen(app);
 assert.equal((await request('/chats/'+chat.id).then(r=>r.json())).length,4);
 await request('/chats/'+chat.id,'DELETE');let state=await request('/state').then(r=>r.json());assert.equal(state.chats.length,0);assert.equal(state.memories.length,1);
 await request('/data','DELETE');state=await request('/state').then(r=>r.json());assert.equal(state.memories.length,0);
 assert.equal((await request('/memories','POST',{content:'x'.repeat(501)})).status,400);
 const page=await fetch(base);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);assert.match(await page.text(),/Langzeitgedächtnis/);
 }finally{await close(app);await close(mock);rmSync(dataDir,{recursive:true,force:true});}
});

test('Live-Text vor Abschluss, Denktextfilter und Abbruch ohne Speicherung',async()=>{
 let finish:()=>void=()=>{};let aborted:()=>void=()=>{};let mode='complete';
 const mock=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'alfred:latest'}]}));
 for await(const _ of req){}
 if(mode==='error'){res.write(JSON.stringify({message:{content:'Denktext</think>Eine ausreichend lange vorläufige Antwort.'}})+'\n');return res.end(JSON.stringify({error:'Testfehler'})+'\n');}
 res.on('close',()=>aborted());
 res.write(JSON.stringify({message:{content:'Privater Denktext</thi'}})+'\n');
 res.write(JSON.stringify({message:{content:'nk>Eine ausreichend lange sichtbare Antwort für den Live-Test. '}})+'\n');
 await new Promise<void>(resolve=>{finish=resolve;});
 if(!res.destroyed)res.end(JSON.stringify({message:{content:'Fertig.'},done:true,done_reason:'stop'})+'\n');
 });
 const ollama=await listen(mock);const dataDir=mkdtempSync(join(tmpdir(),'alfred-stream-'));const app=createApp({dataDir,ollama});const base=await listen(app);
 const post=async(p:string,b:any,signal?:AbortSignal)=>fetch(base+'/api'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b),signal});
 try{
 const chat=await post('/chats',{}).then(r=>r.json());
 const response=await post('/chats/'+chat.id+'/messages',{content:'Test',stream:true});
 assert.match(response.headers.get('content-type')!,/ndjson/);
 const reader=response.body!.getReader();const decoder=new TextDecoder();let preview='';
 while(!preview.includes('"delta"')){const part=await reader.read();assert.equal(part.done,false);preview+=decoder.decode(part.value);}
 assert.doesNotMatch(preview,/Privater Denktext/);
 assert.match(preview,/Eine ausreichend/);
 assert.equal((await fetch(base+'/api/chats/'+chat.id).then(r=>r.json())).length,0);
 finish();let tail='';while(true){const part=await reader.read();if(part.done)break;tail+=decoder.decode(part.value);}
 assert.match(tail,/"done"/);assert.equal((await fetch(base+'/api/chats/'+chat.id).then(r=>r.json())).length,2);
 const controller=new AbortController();
 const cancelled=await post('/chats/'+chat.id+'/messages',{content:'Abbrechen',stream:true},controller.signal);
 const stopReader=cancelled.body!.getReader();let started='';while(!started.includes('"delta"')){const part=await stopReader.read();started+=decoder.decode(part.value);}
 const closed=new Promise<void>(resolve=>{aborted=resolve;});controller.abort();
 await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Abbruch erreicht Ollama nicht')),2000))]);finish();
 for(let i=0;i<100;i++){const state=await fetch(base+'/api/state').then(r=>r.json());if(!state.busy)break;if(i===99)throw Error('Server bleibt gesperrt');}
 assert.equal((await fetch(base+'/api/chats/'+chat.id).then(r=>r.json())).length,2);
 mode='error';const failure=await post('/chats/'+chat.id+'/messages',{content:'Fehler',stream:true});assert.match(await failure.text(),/"type":"error"/);
 assert.equal((await fetch(base+'/api/chats/'+chat.id).then(r=>r.json())).length,2);
 }finally{finish();await close(app);await close(mock);rmSync(dataDir,{recursive:true,force:true});}
});

test('Sicherung vollständig exportieren, kontrolliert einlesen und Titel ändern',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'alfred-backup-'));const app=createApp({dataDir});const base=await listen(app);
 const request=(path:string,method='GET',body?:any)=>fetch(base+'/api'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)});
 try{
 const chat=await request('/chats','POST',{}).then(r=>r.json());
 assert.equal((await request('/chats/'+chat.id,'PATCH',{title:'Mein ruhiger Tag'})).status,200);
 const memory=await request('/memories','POST',{content:'Pausen sind wichtig.'}).then(r=>r.json());
 const db=new DatabaseSync(join(dataDir,'alfred.sqlite'));db.prepare('INSERT INTO messages(id,chat,role,content) VALUES(?,?,?,?)').run('seed',chat.id,'user','Grüße & <script>alert(1)</script>');db.close();
 const response=await request('/export');assert.match(response.headers.get('content-disposition')!,/attachment/);const backup=await response.json();
 assert.equal(backup.chats[0].title,'Mein ruhiger Tag');assert.equal(backup.messages[0].content,'Grüße & <script>alert(1)</script>');assert.equal(backup.memories[0].enabled,1);
 const txt=await request('/chats/'+chat.id+'/export');assert.match(txt.headers.get('content-type')!,/text\/plain/);assert.match(await txt.text(),/Mein ruhiger Tag/);
 assert.equal((await request('/import','POST',{...backup,messages:[{chat:'unknown',role:'user',content:'x'}]})).status,400);
 assert.equal((await request('/state').then(r=>r.json())).chats.length,1);
 assert.equal((await request('/import','POST',{...backup,chats:[backup.chats[0],backup.chats[0]]})).status,400);
 assert.equal((await request('/chats/'+chat.id,'PATCH',{title:''})).status,400);
 assert.equal((await request('/chats','POST',null)).status,400);
 await request('/memories/'+memory.id,'DELETE',{});
 const restored=await request('/import','POST',backup);assert.equal(restored.status,201);assert.equal((await restored.json()).memories,1);
 const state=await request('/state').then(r=>r.json());assert.equal(state.chats.length,2);assert.equal(state.memories[0].enabled,0);
 const duplicate=state.chats.find((c:any)=>c.id!==chat.id);assert.equal((await request('/chats/'+duplicate.id).then(r=>r.json()))[0].content,backup.messages[0].content);
 const again=await request('/import','POST',backup).then(r=>r.json());assert.equal(again.memories,0);
 assert.equal((await request('/chats/0000/export')).status,404);
 assert.equal((await request('/export','GET',undefined)).status,200);
 }finally{await close(app);rmSync(dataDir,{recursive:true,force:true});}
});
