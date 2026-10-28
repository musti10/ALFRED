import {createSpeechBridge} from './speech-bridge.ts';
import {createHermes,HERMES_MODEL} from './hermes.ts';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {initializeTasks,validDay,validTask,listTasks,addTasks} from './task-store.ts';
import {voiceStatus,decodeWav,transcribe} from './voice.ts';
const root=dirname(fileURLToPath(import.meta.url));
const personality=JSON.parse(readFileSync(join(root,'personality.json'),'utf8')).system;
export function createApp({dataDir=join(root,'data'),ollama='http://127.0.0.1:11434',model='alfred',speech={status:voiceStatus,transcribe},hermes=createHermes(),spoken=createSpeechBridge()}={}) {
 mkdirSync(dataDir,{recursive:true,mode:0o700}); chmodSync(dataDir,0o700);
 const db=new DatabaseSync(join(dataDir,'alfred.sqlite')); chmodSync(join(dataDir,'alfred.sqlite'),0o600);
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;
 CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY,title TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,chat TEXT REFERENCES chats(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,content TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created TEXT DEFAULT CURRENT_TIMESTAMP);`);
 if(!(db.prepare('PRAGMA table_info(messages)').all() as any[]).some(c=>c.name==='source'))db.exec("ALTER TABLE messages ADD COLUMN source TEXT NOT NULL DEFAULT 'alfred'");
 initializeTasks(db);
 let busy=false,outputBusy=false;
 const server=createServer(async(req,res)=>{
 const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 res.setHeader('Permissions-Policy','microphone=(self), camera=(), geolocation=()');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 const host=req.headers.host;
 if(!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host))return send(403,{error:'Unzulässiger Host.'});
 const origin=req.headers.origin;
 if((origin && origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'Fremder Ursprung abgewiesen.'});
 const path=new URL(req.url!,'http://localhost').pathname;
 try {
 if(req.method==='GET' && !path.startsWith('/api/')){
 const files:Record<string,string>={'/':'index.html','/alfred-mark.svg':'alfred-mark.svg','/app.js':'app.js','/hermes-ui.js':'hermes-ui.js','/hermes-memory.js':'hermes-memory.js','/tasks.js':'tasks.js','/task-parser.js':'task-parser.js','/audio-reader.js':'audio-reader.js','/speech.js':'speech.js','/speech-clauses.js':'speech-clauses.js','/pcm.js':'pcm.js','/microphone.js':'microphone.js','/recorder-worklet.js':'recorder-worklet.js','/style.css':'style.css'};
 const file=files[path];if(!file)return send(404,{error:'Nicht gefunden.'});
 res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');return res.end(readFileSync(join(root,'public',file)));
 }
 if(req.method==='GET'&&path==='/api/hermes/status'){
 const runtime=await hermes.status();let modelReady=false;
 try{const response=await fetch(`${ollama}/api/tags`,{signal:AbortSignal.timeout(3000)});if(response.ok){const catalog=await response.json() as any;modelReady=!!catalog.models?.some((m:any)=>m.name===HERMES_MODEL&&!m.remote_host);}}catch{}
 return send(200,{...runtime,runtimeReady:runtime.ready,ready:runtime.ready&&modelReady,modelReady,model:HERMES_MODEL,message:!runtime.ready?runtime.message:!modelReady?'Hermes-Modell fehlt oder Ollama ist nicht erreichbar.':'Hermes lokal bereit · ohne Werkzeuge'});
 }
 if(req.method==='GET'&&path==='/api/voice/output/status')return send(200,await spoken.status());
 if(req.method==='GET' && path==='/api/voice/status')return send(200,speech.status());
 if(req.method==='POST'&&path==='/api/voice/synthesize'){
 if(busy||outputBusy)return send(409,{error:'Bitte die laufende Anfrage beenden.'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON erforderlich.'});
 outputBusy=true;const controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(85000)]);
 const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
 try{
 const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768)return send(413,{error:'Anfrage zu groß.'});chunks.push(chunk);}
 let body:any;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'Ungültiges JSON.'});}
 if(!body||typeof body.text!=='string'||!body.text.trim()||body.text.length>4000||body.confirmed!==true||Object.keys(body).some(k=>!['text','confirmed'].includes(k)))return send(400,{error:'Bitte einen geprüften Vorlesetext mit 1–4000 Zeichen angeben.'});
 const info=await spoken.status();signal.throwIfAborted();if(!info.ready)return send(503,{error:info.message});
 const audio=await spoken.synthesize(body.text.trim(),signal);signal.throwIfAborted();if(res.destroyed)return;
 res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':audio.length});return res.end(audio);
 }catch(e){if(!res.destroyed)return send(502,{error:signal.aborted?'Sprachausgabe gestoppt oder Zeitlimit erreicht.':e instanceof Error?e.message:'Sprachausgabe fehlgeschlagen.'});}
 finally{res.off('close',disconnect);outputBusy=false;}
 }
 if(req.method==='POST' && path==='/api/voice/transcribe'){
 if(busy)return send(409,{error:'Bitte zuerst die laufende Antwort oder Aufnahme beenden.'});
 if(req.headers['content-type']!=='audio/wav')return send(415,{error:'WAV-Aufnahme erforderlich.'});
 if(!speech.status().ready)return send(503,{error:'Lokale Spracheingabe noch nicht eingerichtet.'});
 busy=true;const controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]);
 const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
 try{
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>1920044)return send(413,{error:'Aufnahme zu lang. Maximal 60 Sekunden.'});chunks.push(chunk);}
 let audio:Float32Array;try{audio=decodeWav(Buffer.concat(chunks));}catch(e){return send(400,{error:(e as Error).message});}
 signal.throwIfAborted();const text=await speech.transcribe(audio,signal);signal.throwIfAborted();
 if(typeof text!=='string'||!text.trim())return send(422,{error:'Keine Sprache erkannt.'});
 if(text.length>4000)return send(422,{error:'Erkannter Text zu lang. Bitte kürzer aufnehmen.'});
 if(!res.destroyed)return send(200,{text:text.trim()});
 }catch(e){if(!res.destroyed)return send(signal.aborted?408:500,{error:signal.aborted?'Spracherkennung abgebrochen oder Zeitlimit erreicht.':(e as Error).message});}
 finally{res.off('close',disconnect);busy=false;}
 return;
 }
 if(req.method==='GET' && path==='/api/info')return send(200,{app:'alfred-local',version:'0.15.0'});
 if(req.method==='GET' && path==='/api/state')return send(200,{chats:db.prepare('SELECT * FROM chats ORDER BY rowid DESC').all(),memories:db.prepare('SELECT * FROM memories ORDER BY rowid').all(),busy});
 if(req.method==='GET' && path==='/api/status'){
 try{const r=await fetch(`${ollama}/api/tags`,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error();const data=await r.json() as any;const found=data.models?.find((m:any)=>m.name===model||m.name===`${model}:latest`);return send(200,{ready:!!found && !found.remote_host,model,message:found?.remote_host?'Cloud-Modell wird nicht unterstützt.':found?'Ollama verbunden':'Modell alfred fehlt. Prüfe ollama list.'});}catch{return send(200,{ready:false,model,message:'Ollama nicht erreichbar. Öffne die Ollama-App.'});}
 }
 if(req.method==='GET' && path==='/api/tasks'){
 const day=new URL(req.url!,'http://localhost').searchParams.get('day');if(!validDay(day))return send(400,{error:'Gültiges Datum erforderlich.'});return send(200,listTasks(db,day));
 }
 if(req.method==='GET' && path==='/api/export'){
 res.setHeader('Content-Disposition','attachment; filename="ALFRED-Sicherung.json"');
 return send(200,{format:'alfred-backup',version:3,tasks:db.prepare('SELECT * FROM tasks ORDER BY day,time,rowid').all(),exportedAt:new Date().toISOString(),chats:db.prepare('SELECT * FROM chats ORDER BY rowid').all(),messages:db.prepare('SELECT * FROM messages ORDER BY rowid').all(),memories:db.prepare('SELECT * FROM memories ORDER BY rowid').all()});
 }
 const exportChat=path.match(/^\/api\/chats\/([a-f0-9-]+)\/export$/);
 if(req.method==='GET' && exportChat){
 const chat=db.prepare('SELECT * FROM chats WHERE id=?').get(exportChat[1]) as any;
 if(!chat)return send(404,{error:'Gespräch fehlt.'});
 const messages=db.prepare('SELECT role,content,source FROM messages WHERE chat=? ORDER BY rowid').all(exportChat[1]);
 res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="ALFRED-Gespraech.txt"'});
 return res.end(chat.title+'\n'+'='.repeat(40)+'\n\n'+messages.map(m=>(m.role==='user'?(m.source==='hermes'?'SIE → HERMES':'SIE'):(m.source==='hermes'?'HERMES':'ALFRED'))+'\n'+m.content).join('\n\n'));
 }
 const match=path.match(/^\/api\/chats\/([a-f0-9-]+)(\/messages)?$/);
 if(req.method==='GET'&&match){if(!db.prepare('SELECT id FROM chats WHERE id=?').get(match[1]))return send(404,{error:'Gespräch fehlt.'});return send(200,db.prepare('SELECT * FROM messages WHERE chat=? ORDER BY rowid').all(match[1]));}
 if(!['POST','PATCH','DELETE'].includes(req.method!))return send(404,{error:'Nicht gefunden.'});
 if(busy)return send(409,{error:'Bitte warte, bis die aktuelle Antwort abgeschlossen ist.'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON erforderlich.'});
 const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>(path==='/api/import'?5242880:32768))return send(413,{error:'Anfrage zu groß.'});chunks.push(chunk);}
 const raw=Buffer.concat(chunks).toString('utf8');
 let body:any;try{body=JSON.parse(raw||'{}');if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return send(400,{error:'Ungültiges JSON.'});}
 if(busy)return send(409,{error:'Bitte warte, bis die aktuelle Antwort abgeschlossen ist.'});
 const validText=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
 if(req.method==='POST'&&path==='/api/hermes/requests'){
 if(!validText(body.content,4000)||body.confirmed!==true||Object.keys(body).some(key=>!['content','confirmed','chatId'].includes(key)))return send(400,{error:'Bitte ausschließlich den geprüften Text bestätigen (1–4000 Zeichen).'});
 if(body.chatId!==null&&(typeof body.chatId!=='string'||!db.prepare('SELECT id FROM chats WHERE id=?').get(body.chatId)))return send(404,{error:'Zielgespräch fehlt.'});
 busy=true;const controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
 const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
 try{
 const status=await hermes.status();signal.throwIfAborted();if(!status.ready)throw Error(status.message);
 // Fixed endpoint and fixed local model. Never pass endpoint, profile, history or memories from a request.
 const catalogResponse=await fetch(`${ollama}/api/tags`,{signal:AbortSignal.any([signal,AbortSignal.timeout(4000)])});
 if(!catalogResponse.ok)throw Error('Ollama ist für Hermes nicht erreichbar.');
 const catalog=await catalogResponse.json() as any;
 if(!catalog.models?.some((m:any)=>m.name===HERMES_MODEL&&!m.remote_host))throw Error('Das lokale Hermes-Modell fehlt.');
 const result=await hermes.run(body.content.trim(),signal);signal.throwIfAborted();if(res.destroyed)return;
 if(typeof result.content!=='string'||!result.content.trim()||result.content.length>64000||result.model!==HERMES_MODEL)throw Error('Keine gültige vollständige Hermes-Antwort.');
 const chatId=body.chatId||randomUUID();
 db.exec('BEGIN');try{
 if(!body.chatId)db.prepare('INSERT INTO chats(id,title) VALUES(?,?)').run(chatId,'Hermes · '+body.content.trim().slice(0,45));
 const insert=db.prepare("INSERT INTO messages(id,chat,role,content,source) VALUES(?,?,?,?,'hermes')");
 insert.run(randomUUID(),chatId,'user',body.content.trim());insert.run(randomUUID(),chatId,'assistant',result.content.trim());
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return send(200,{chatId,model:HERMES_MODEL});
 }catch(e){if(!res.destroyed)return send(502,{error:signal.aborted?'Hermes-Anfrage abgebrochen oder Zeitlimit erreicht.':e instanceof Error?e.message:'Hermes nicht erreichbar.'});}
 finally{res.off('close',disconnect);busy=false;}
 }
 if(req.method==='POST'&&path==='/api/tasks'){
 if(!validDay(body.day)||!Array.isArray(body.tasks)||body.tasks.length<1||body.tasks.length>50||!body.tasks.every(validTask))return send(400,{error:'Bitte ein gültiges Datum und 1–50 Aufgaben mit gültigen Uhrzeiten angeben.'});
 const existing=listTasks(db,body.day);const distinct=new Set(existing.map((t:any)=>t.time+'\n'+t.text));for(const task of body.tasks)distinct.add(task.time+'\n'+task.text.trim());
 if(distinct.size>200)return send(400,{error:'Maximal 200 Aufgaben pro Tag.'});
 db.exec('BEGIN');try{const added=addTasks(db,body.day,body.tasks.map((t:any)=>({...t,done:false})));db.exec('COMMIT');return send(201,{added});}catch(e){db.exec('ROLLBACK');throw e;}
 }
 const task=path.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
 if(task&&req.method==='PATCH'){
 if(!validTask(body)||typeof body.done!=='boolean')return send(400,{error:'Aufgabentext, Uhrzeit und Erledigt-Status erforderlich.'});
 if(db.prepare('SELECT id FROM tasks WHERE day=(SELECT day FROM tasks WHERE id=?) AND text=? AND time=? AND id<>?').get(task[1],body.text.trim(),body.time,task[1]))return send(409,{error:'Diese Aufgabe ist für diesen Tag bereits vorhanden.'});
 const result=db.prepare('UPDATE tasks SET text=?,time=?,done=? WHERE id=?').run(body.text.trim(),body.time,body.done?1:0,task[1]);return send(result.changes?200:404,result.changes?{ok:true}:{error:'Aufgabe fehlt.'});
 }
 if(task&&req.method==='DELETE'){db.prepare('DELETE FROM tasks WHERE id=?').run(task[1]);return send(200,{ok:true});}
 if(req.method==='POST'&&path==='/api/import'){
 if(body.format!=='alfred-backup'||![1,2,3].includes(body.version)||!Array.isArray(body.chats)||!Array.isArray(body.messages)||!Array.isArray(body.memories))return send(400,{error:'Keine gültige ALFRED-Sicherung (Version 1, 2 oder 3).'});
 if(body.chats.length>200||body.messages.length>10000||body.memories.length>12)return send(400,{error:'Sicherung zu umfangreich (maximal 200 Chats, 10000 Nachrichten und 12 Erinnerungen).'});
 const importedTasks=body.version===1?[]:body.tasks;
 if(!Array.isArray(importedTasks)||importedTasks.length>10000||!importedTasks.every((t:any)=>validDay(t?.day)&&validTask(t)&&(t.done===0||t.done===1||typeof t.done==='boolean')))return send(400,{error:'Ungültige Aufgaben in der Sicherung.'});
 const perDay=new Map<string,Set<string>>();for(const t of importedTasks){if(!perDay.has(t.day))perDay.set(t.day,new Set(listTasks(db,t.day).map((x:any)=>x.time+'\n'+x.text)));perDay.get(t.day)!.add(t.time+'\n'+t.text.trim());}
 if([...perDay.values()].some(set=>set.size>200))return send(400,{error:'Mit dieser Sicherung wären mehr als 200 Aufgaben an einem Tag gespeichert.'});
 let importedTaskCount=0;
 const ids=new Set<string>();
 const timestamp=(value:unknown)=>typeof value==='string'&&value.length<=40&&!Number.isNaN(Date.parse(value))?value:new Date().toISOString();
 for(const chat of body.chats){if(!chat||typeof chat.id!=='string'||ids.has(chat.id)||!validText(chat.title,100))return send(400,{error:'Ungültige Gespräche in der Sicherung.'});ids.add(chat.id);}
 for(const m of body.messages){if(!m||!ids.has(m.chat)||!['user','assistant'].includes(m.role)||(body.version===3&&!['alfred','hermes'].includes(m.source))||!validText(m.content,m.role==='user'?4000:64000))return send(400,{error:'Ungültige Nachrichten in der Sicherung.'});}
 for(const m of body.memories){if(!m||!validText(m.content,500))return send(400,{error:'Ungültige Erinnerungen in der Sicherung.'});}
 const existing=db.prepare('SELECT content FROM memories').all();const known=new Set(existing.map(m=>String(m.content).trim()));const memories:any[]=[];
 for(const m of body.memories){if(!known.has(m.content.trim())){known.add(m.content.trim());memories.push(m);}}
 if(existing.length+memories.length>12)return send(400,{error:'Mit dieser Sicherung wären mehr als 12 Erinnerungen gespeichert. Bitte zuerst Platz schaffen.'});
 db.exec('BEGIN');
 try{
 const mapping=new Map<string,string>();const addChat=db.prepare('INSERT INTO chats(id,title,created) VALUES(?,?,?)');
 for(const chat of body.chats){const id=randomUUID();mapping.set(chat.id,id);addChat.run(id,chat.title.trim(),timestamp(chat.created));}
 const addMessage=db.prepare('INSERT INTO messages(id,chat,role,content,created,source) VALUES(?,?,?,?,?,?)');for(const m of body.messages)addMessage.run(randomUUID(),mapping.get(m.chat)!,m.role,m.content,timestamp(m.created),body.version===3?m.source:'alfred');
 const addMemory=db.prepare('INSERT INTO memories(id,content,enabled,created) VALUES(?,?,0,?)');for(const m of memories)addMemory.run(randomUUID(),m.content.trim(),timestamp(m.created));
 for(const day of perDay.keys())importedTaskCount+=addTasks(db,day,importedTasks.filter((t:any)=>t.day===day));
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return send(201,{tasks:importedTaskCount,chats:body.chats.length,messages:body.messages.length,memories:memories.length});
 }
 if(req.method==='PATCH'&&match&&!match[2]){
 if(!validText(body.title,100))return send(400,{error:'Titel muss 1–100 Zeichen enthalten.'});
 const changed=db.prepare('UPDATE chats SET title=? WHERE id=?').run(body.title.trim(),match[1]);if(!changed.changes)return send(404,{error:'Gespräch fehlt.'});return send(200,{ok:true});
 }
 if(req.method==='POST'&&path==='/api/chats'){const id=randomUUID();db.prepare('INSERT INTO chats(id,title) VALUES(?,?)').run(id,'Neues Gespräch');return send(201,{id});}
 if(req.method==='DELETE'&&match){db.prepare('DELETE FROM chats WHERE id=?').run(match[1]);return send(200,{ok:true});}
 if(req.method==='POST'&&match?.[2]){
 if(!validText(body.content,4000))return send(400,{error:'Nachricht muss 1–4000 Zeichen enthalten.'});
 if(body.engine!==undefined&&!['alfred','pipecat'].includes(body.engine))return send(400,{error:'Unzulässiger Antwortmodus.'});
 if(!db.prepare('SELECT id FROM chats WHERE id=?').get(match[1]))return send(404,{error:'Gespräch fehlt.'});
 busy=true;
 const controller=new AbortController();
 const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
 const disconnected=()=>{if(!res.writableEnded)controller.abort();};
 res.on('close',disconnected);
 const streaming=body.stream===true;
 const event=(value:unknown)=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n');};
 if(streaming){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});res.flushHeaders();event({type:'status',message:'ALFRED bereitet die Antwort vor …'});}
 try{
 const memories=db.prepare('SELECT content FROM memories WHERE enabled=1 ORDER BY rowid').all();
 const history=db.prepare('SELECT role,content FROM messages WHERE chat=? ORDER BY rowid DESC LIMIT 10').all(match[1]).reverse();
 // Bounded recent context; the complete history remains stored locally.
 let budget=6500;const recent:any[]=[];for(const item of history.reverse()){const c=String(item.content);if(c.length>budget)break;recent.unshift(item);budget-=c.length;}
 let result:any;
 if(body.engine==='pipecat'){
 const ready=await spoken.status();signal.throwIfAborted();if(!ready.ready)throw Error(ready.message);
 const content=await spoken.answer({content:body.content.trim(),history:recent,memories},signal);
 result={message:{content}};
 }else{
 const tags=await fetch(`${ollama}/api/tags`,{signal:AbortSignal.any([signal,AbortSignal.timeout(4000)])});if(!tags.ok)throw Error('Ollama antwortet nicht.');
 const catalog=await tags.json() as any;const local=catalog.models?.find((m:any)=>m.name===model||m.name===`${model}:latest`);
 if(!local||local.remote_host)throw Error('Lokales Modell alfred fehlt oder ist ein Cloud-Modell.');
 // A fixed, honest small-talk reply avoids unreliable model improvisation.
 const smallTalk=/^(?:(?:hallo|hey|hi)[,!. ]+)?wie geht(?: es)? (?:dir|ihnen)[?!. ]*$/i.test(body.content.trim());
 const r=smallTalk ? new Response(JSON.stringify({message:{content:'Alles in bester Ordnung, Sir. Wie geht es Ihnen?'}})) : await fetch(`${ollama}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({model,stream:streaming,think:false,keep_alive:'5m',options:{num_ctx:8192,num_predict:4096,temperature:0.35},messages:[{role:'system',content:personality+' Vom Nutzer aktivierte Fakten: '+JSON.stringify(memories)},...recent,{role:'user',content:body.content.trim()}]})});
 if(!r.ok)throw Error(`Ollama meldet Fehler ${r.status}.`);
 if(streaming && !smallTalk){
 let pending='',rawContent='',emitted=0,safe=false,done=false,reason='';
 const decode=new TextDecoder();
 const consume=(line:string)=>{
 if(!line.trim())return;
 const part=JSON.parse(line);
 if(part.error)throw Error(String(part.error));
 if(part.message?.thinking&&!safe){safe=true;event({type:'status',message:'ALFRED denkt nach …'});}
 rawContent+=part.message?.content||'';
 // Custom templates may put unmarked reasoning in content. Buffer it until
 // the closing think tag; never stream uncertain content to the browser.
 const end=rawContent.lastIndexOf('</think>');
 if(end>=0){if(!safe)emitted=end+8;safe=true;}
 if(safe){const limit=Math.max(emitted,rawContent.length-16);if(limit>emitted){event({type:'delta',content:rawContent.slice(emitted,limit)});emitted=limit;}}
 if(part.done){done=true;reason=part.done_reason||'';}
 };
 if(!r.body)throw Error('Kein Antwortstrom erhalten.');
 for await(const chunk of r.body){pending+=decode.decode(chunk,{stream:true});let newline;while((newline=pending.indexOf('\n'))>=0){consume(pending.slice(0,newline));pending=pending.slice(newline+1);}}
 pending+=decode.decode();consume(pending);
 if(!done)throw Error('Die Verbindung zu Ollama wurde vorzeitig beendet.');
 result={message:{content:rawContent},done_reason:reason};
 // Final cleaned answer is authoritative; the UI replaces its preview.
 }else result=await r.json();
 }
 if(typeof result.message?.content!=='string')throw Error('Ollama hat keine Antwort geliefert.');
 // Some custom Qwen templates emit reasoning without an opening tag.
 if(result.done_reason==='length')throw Error('Das Modell hat sein Antwortlimit im Denkmodus erreicht. Bitte kürzer fragen oder erneut versuchen.');
 let answer=result.message.content.replace(/<think>[\s\S]*?<\/think>/g,'');
 if(answer.includes('</think>'))answer=answer.slice(answer.lastIndexOf('</think>')+8);
 answer=answer.replace(/<think>[\s\S]*$/g,'').trim();
 if(!answer)throw Error('Keine sichtbare Antwort erhalten. Bitte erneut versuchen.');
 signal.throwIfAborted();if(res.destroyed)throw Error('Abgebrochen.');
 db.exec('BEGIN');try{const insert=db.prepare('INSERT INTO messages(id,chat,role,content) VALUES(?,?,?,?)');insert.run(randomUUID(),match[1],'user',body.content.trim());insert.run(randomUUID(),match[1],'assistant',answer);db.prepare("UPDATE chats SET title=? WHERE id=? AND title='Neues Gespräch'").run(body.content.trim().slice(0,55),match[1]);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 if(streaming){event({type:'done',content:answer});return res.end();}
 return send(200,{ok:true});
 }catch(e){
 if(res.destroyed)return;
 const message=signal.aborted?'Antwort abgebrochen oder Zeitlimit erreicht.':e instanceof Error?e.message:'Ollama nicht erreichbar.';
 if(streaming){event({type:'error',error:message});return res.end();}
 return send(502,{error:message});
 }finally{res.off('close',disconnected);busy=false;}
 }
 if(req.method==='POST'&&path==='/api/memories'){
 if(!validText(body.content,500))return send(400,{error:'Erinnerung muss 1–500 Zeichen enthalten.'});
 const count=db.prepare('SELECT count(*) AS n FROM memories').get() as any;if(count.n>=12)return send(400,{error:'Maximal 12 Erinnerungen. Bitte vorhandene bearbeiten oder löschen.'});
 const id=randomUUID();db.prepare('INSERT INTO memories(id,content) VALUES(?,?)').run(id,body.content.trim());return send(201,{id});
 }
 const memory=path.match(/^\/api\/memories\/([a-f0-9-]+)$/);
 if(memory&&req.method==='DELETE'){db.prepare('DELETE FROM memories WHERE id=?').run(memory[1]);return send(200,{ok:true});}
 if(memory&&req.method==='PATCH'){
 if(!validText(body.content,500)||typeof body.enabled!=='boolean')return send(400,{error:'Text und Aktivierung erforderlich.'});
 db.prepare('UPDATE memories SET content=?,enabled=? WHERE id=?').run(body.content.trim(),body.enabled?1:0,memory[1]);return send(200,{ok:true});
 }
 if(req.method==='DELETE'&&path==='/api/data'){db.exec('BEGIN; DELETE FROM messages; DELETE FROM chats; DELETE FROM memories; DELETE FROM tasks; COMMIT; VACUUM;');return send(200,{ok:true});}
 send(404,{error:'Nicht gefunden.'});
 }catch{send(500,{error:'Lokaler Fehler. Prüfe das Terminal; keine Inhalte wurden protokolliert.'});}
 });
 server.on('close',()=>db.close());return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3210);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT muss zwischen 1024 und 65535 liegen.');
 const server=createApp();server.on('error',(e:any)=>{console.error(e.code==='EADDRINUSE'?'Port belegt. Schließe die andere ALFRED-Instanz oder nutze PORT=3211 npm start.':e.message);process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>console.log(`ALFRED v0.12: http://127.0.0.1:${port} – Beenden mit Ctrl+C`));
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{server.close();server.closeAllConnections();});
}
