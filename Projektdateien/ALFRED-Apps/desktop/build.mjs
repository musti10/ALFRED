import {packager} from '@electron/packager';
import {mkdir,cp,writeFile,readFile,chmod,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));const parent=dirname(root);
const source=join(parent,'alfred-v0.3');const previous=join(parent,'outputs','alfred-v0.3','data');const staging=await mkdtemp(join(tmpdir(),'alfred-staging-'));
await mkdir(join(staging,'backend'),{recursive:true,verbatimSymlinks:true});await mkdir(join(staging,'runtime'),{recursive:true,verbatimSymlinks:true});
for(const file of ['server.ts','personality.json','task-store.ts','voice.ts','voice-worker.ts','hermes.ts','speech-bridge.ts','THIRD-PARTY.md'])await cp(join(source,file),join(staging,'backend',file));
await cp(join(root,'desktop','migrate.mjs'),join(staging,'backend','migrate.mjs'));
let server=await readFile(join(staging,'backend','server.ts'),'utf8');server=server.replace("dataDir=join(root,'data')","dataDir=process.env.ALFRED_DATA_DIR||join(root,'data')");await writeFile(join(staging,'backend','server.ts'),server);
await writeFile(join(staging,'backend','package.json'),'{"type":"module"}');
// Reuse the already installed, matching offline runtime when available. Temporary
// staging avoids cloud-managed Desktop placeholders in repeated builds.
const installed=join(process.env.HOME,'Applications','ALFRED.app','Contents','Resources','backend');
for(const directory of ['public','node_modules','models','integrations','third-party']){
 let from=join(source,directory);
 if(directory==='node_modules' && existsSync(join(installed,directory,'@huggingface/transformers/package.json'))){
 const expected=JSON.parse(await readFile(join(source,'package.json'),'utf8')).optionalDependencies['@huggingface/transformers'];
 const actual=JSON.parse(await readFile(join(installed,directory,'@huggingface/transformers/package.json'),'utf8')).version;
 if(expected===actual)from=join(installed,directory);
 }
 if(directory==='models' && existsSync(join(installed,directory)))from=join(installed,directory);
 execFileSync('/usr/bin/ditto',[from,join(staging,'backend',directory)]);
}
await cp(process.execPath,join(staging,'runtime','node'));await chmod(join(staging,'runtime','node'),0o755);
await writeFile(join(staging,'installation.json'),JSON.stringify({projectRoot:dirname(parent)}));
const output=await mkdtemp(join(tmpdir(),'alfred-native-build-'));
const paths=await packager({dir:root,out:output,name:'ALFRED',platform:'darwin',arch:'arm64',overwrite:true,appBundleId:'de.local.alfred.mac',appVersion:'0.16.0',asar:false,ignore:[/^\/staging/,/^\/iphone/,/^\/tests/,/^\/README/,/^\/Mac-App/],icon:existsSync(join(root,'desktop','ALFRED.icns'))?join(root,'desktop','ALFRED.icns'):undefined,extendInfo:{NSMicrophoneUsageDescription:'ALFRED nimmt nur nach Klick auf Sprechen Audio für die lokale Spracherkennung auf.',NSLocalNetworkUsageDescription:'ALFRED kann nach Ihrer Freigabe eine verschlüsselte Verbindung mit Ihrer iPhone-App im selben WLAN herstellen.'}});
const resources=join(paths[0],'ALFRED.app','Contents','Resources');
for(const name of ['backend','runtime','installation.json'])await cp(join(staging,name),join(resources,name),{recursive:true,verbatimSymlinks:true});
const app=join(paths[0],'ALFRED.app');
execFileSync('/usr/bin/codesign',['--force','--deep','--options','runtime','--entitlements',join(root,'desktop','entitlements.plist'),'--sign','-',app]);
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app]);
const archive=join(parent,'ALFRED-Mac-v0.16.0.zip');
execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);
console.log('Mac-App erstellt: '+app+'\nZIP: '+archive);
