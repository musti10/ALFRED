import {existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
const root=dirname(fileURLToPath(import.meta.url));
export function voiceStatus(){
 const ready=['node_modules/@huggingface/transformers/package.json','models/onnx-community/whisper-base/onnx/encoder_model_quantized.onnx','models/onnx-community/whisper-base/onnx/decoder_model_merged_quantized.onnx','models/onnx-community/whisper-base/alfred-model.json'].every(file=>existsSync(join(root,file)));
 return {ready,model:'Whisper base · lokal',maxSeconds:60,message:ready?'Lokale Spracheingabe bereit.':'Spracheingabe noch nicht eingerichtet. Siehe README: npm run setup:voice.'};
}
export function decodeWav(buffer:Buffer){
 // Accept only the canonical format produced by our own recorder, no external codecs.
 if(buffer.length<44||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE'||buffer.toString('ascii',12,16)!=='fmt '||buffer.readUInt32LE(16)!==16||buffer.readUInt16LE(20)!==1||buffer.readUInt16LE(22)!==1||buffer.readUInt32LE(24)!==16000||buffer.readUInt32LE(28)!==32000||buffer.readUInt16LE(32)!==2||buffer.readUInt16LE(34)!==16||buffer.toString('ascii',36,40)!=='data'||buffer.readUInt32LE(40)!==buffer.length-44||buffer.readUInt32LE(4)!==buffer.length-8||(buffer.length-44)%2)throw Error('Ungültige Aufnahme. Erwartet wird Mono-WAV mit 16 kHz.');
 const count=(buffer.length-44)/2;
 if(count<4000||count>960000)throw Error('Bitte zwischen 1 und 60 Sekunden aufnehmen.');
 const audio=new Float32Array(count);let energy=0;
 for(let i=0;i<count;i++){audio[i]=buffer.readInt16LE(44+i*2)/32768;energy+=audio[i]*audio[i];}
 if(Math.sqrt(energy/count)<0.001)throw Error('Die Aufnahme ist zu leise. Bitte näher am Mikrofon sprechen.');
 return audio;
}
export function transcribe(audio:Float32Array,signal:AbortSignal):Promise<string>{
 return new Promise((resolve,reject)=>{
 if(signal.aborted)return reject(Error('Abgebrochen.'));
 const worker=new Worker(new URL('./voice-worker.ts',import.meta.url),{workerData:{audio,modelPath:join(root,'models')},transferList:[audio.buffer]});
 let settled=false;
 const finish=(error:Error|null,text?:string)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(text!);};
 const abort=()=>finish(Error('Spracherkennung abgebrochen.'));
 signal.addEventListener('abort',abort,{once:true});
 worker.on('message',message=>message.error?finish(Error(message.error)):finish(null,message.text));
 worker.on('error',()=>finish(Error('Spracherkennung konnte nicht gestartet werden. Bitte Einrichtung prüfen.')));
 worker.on('exit',code=>{if(!settled)finish(Error('Spracherkennung unerwartet beendet ('+code+').'));});
 });
}
