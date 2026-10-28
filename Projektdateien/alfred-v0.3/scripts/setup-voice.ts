// Explicit one-time setup. Runtime recognition never downloads or calls a cloud API.
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const model='onnx-community/whisper-base';
const response=await fetch('https://huggingface.co/api/models/'+model,{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Modellinformationen konnten nicht geladen werden.');
const metadata=await response.json() as any;
if(!/^[a-f0-9]{40}$/.test(metadata.sha))throw Error('Ungültige Modellrevision.');
const files=metadata.siblings.map((f:any)=>f.rfilename).filter((name:string)=>/^[\w.-]+\.(json|txt)$/.test(name)||['onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx'].includes(name));
for(const required of ['config.json','tokenizer.json','preprocessor_config.json','onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx'])if(!files.includes(required))throw Error('Modellpaket unvollständig: '+required);
const destination=join(root,'models',model);await mkdir(destination,{recursive:true});await rm(join(destination,'alfred-model.json'),{force:true});
for(const file of files){
 console.log('Lade '+file+' …');
 const target=join(destination,file);await mkdir(dirname(target),{recursive:true});
 const download=await fetch(`https://huggingface.co/${model}/resolve/${metadata.sha}/${file}`,{signal:AbortSignal.timeout(300000)});
 if(!download.ok)throw Error('Download fehlgeschlagen: '+file+' ('+download.status+')');
 const bytes=new Uint8Array(await download.arrayBuffer());if(bytes.length>250000000)throw Error('Modelldatei unerwartet groß.');
 await writeFile(target+'.partial',bytes);await rename(target+'.partial',target);
}
await writeFile(join(destination,'alfred-model.json'),JSON.stringify({model,revision:metadata.sha,downloadedAt:new Date().toISOString()},null,2));
console.log('Modell lokal gespeichert. Prüfe mit npm run test:voice.');
