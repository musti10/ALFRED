// Generates a non-personal German test sentence using macOS; never accesses the mic.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {transcribe,voiceStatus} from '../voice.ts';
import {encodeWav} from '../public/pcm.js';
const run=promisify(execFile);
if(!voiceStatus().ready)throw Error('Bitte zuerst npm install und npm run setup:voice ausführen.');
const directory=await mkdtemp(join(tmpdir(),'alfred-sprachtest-'));
try{
 const aiff=join(directory,'probe.aiff'),wav=join(directory,'probe.wav');
 await run('/usr/bin/say',['-v','Anna','-o',aiff,'Guten Morgen Alfred. Bitte plane einen ruhigen Tag mit vielen Pausen.']);
 await run('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',aiff,wav]);
 const bytes=await readFile(wav);let pcm:Buffer|undefined;
 for(let offset=12;offset+8<=bytes.length;){const size=bytes.readUInt32LE(offset+4);if(bytes.toString('ascii',offset,offset+4)==='data'){pcm=bytes.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
 if(!pcm)throw Error('Testdatei konnte nicht gelesen werden.');
 const audio=new Float32Array(pcm.length/2);for(let i=0;i<audio.length;i++)audio[i]=pcm.readInt16LE(i*2)/32768;
 const started=Date.now();let text:string;
 if(process.argv.includes('--http')){const response=await fetch('http://127.0.0.1:3210/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:encodeWav(audio,16000),signal:AbortSignal.timeout(120000)});const result=await response.json() as any;if(!response.ok)throw Error(result.error);text=result.text;}else text=await transcribe(audio,AbortSignal.timeout(120000));
 console.log('Erkannt:',text);console.log('Dauer:',((Date.now()-started)/1000).toFixed(1),'Sekunden');
 if(!/ruhigen|pausen/i.test(text))throw Error('Testtext nicht ausreichend erkannt.');
 console.log('Lokale deutsche Spracherkennung: OK. Mikrofon wurde nicht verwendet.');
}finally{await rm(directory,{recursive:true,force:true});}
