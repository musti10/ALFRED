import {fileURLToPath} from 'node:url';
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {createHash} from 'node:crypto';
const revision='5041a7a49ae5b3a0f30e6837769eb03fdbb231bd',folder='de/de_DE/thorsten/high',destination=fileURLToPath(new URL('.',import.meta.url));await mkdir(destination,{recursive:true});
const tree=await fetch(`https://huggingface.co/api/models/rhasspy/piper-voices/tree/${revision}/${folder}`).then(r=>r.json());
const records=[];
for(const name of ['MODEL_CARD','de_DE-thorsten-high.onnx.json','de_DE-thorsten-high.onnx']){
 const item=tree.find(x=>x.path===folder+'/'+name);if(!item)throw Error('Missing metadata');
 const url=`https://huggingface.co/rhasspy/piper-voices/resolve/${revision}/${folder}/${name}`;const response=await fetch(url);if(!response.ok)throw Error('Download '+response.status);
 await pipeline(Readable.fromWeb(response.body),createWriteStream(destination+'/'+name+'.download'));
 const data=await readFile(destination+'/'+name+'.download');const digest=createHash('sha256').update(data).digest('hex');
 if(item.size!==data.length||(item.lfs?.oid&&item.lfs.oid!==digest))throw Error('Checksum mismatch');await rename(destination+'/'+name+'.download',destination+'/'+name);
 records.push({file:name,bytes:data.length,sha256:digest});console.log(name+': '+data.length+' Bytes, geprüft');
}
await writeFile(destination+'/HERKUNFT.json',JSON.stringify({repository:'rhasspy/piper-voices',revision,path:folder,datasetLicense:'CC0 according to MODEL_CARD',records},null,2));
