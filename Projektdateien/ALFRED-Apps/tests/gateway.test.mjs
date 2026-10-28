import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {request} from 'node:https';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const require=createRequire(import.meta.url);const {createGateway,isPrivate,allowed}=require('../desktop/gateway.cjs');
test('Nur private Adressen und erlaubte ALFRED-Endpunkte',()=>{
 assert.equal(isPrivate('192.168.1.20'),true);assert.equal(isPrivate('10.0.0.4'),true);assert.equal(isPrivate('8.8.8.8'),false);assert.equal(isPrivate('172.33.0.1'),false);assert.equal(isPrivate('192.168.300.1'),false);
 assert.equal(allowed('POST','/api/chats/abcd/messages'),true);assert.equal(allowed('DELETE','/api/data'),false);assert.equal(allowed('POST','/api/import'),false);assert.equal(allowed('GET','/'),false);
});
test('TLS, Kopplung, feste lokale Weiterleitung und Widerruf',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'alfred-pair-test-'));let seen;
 const backend=createServer((req,res)=>{seen={host:req.headers.host,authorization:req.headers.authorization,path:req.url};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'alfred-local'}));});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));let gateway;
 try{
 gateway=await createGateway({directory,host:'127.0.0.1',port:0,backendPort:backend.address().port});
 const call=(path,token=gateway.pairing.token,headers={})=>new Promise((resolve,reject)=>{
 const req=request({hostname:'127.0.0.1',port:gateway.pairing.port,path,ca:readFileSync(join(directory,'certificate.pem')),checkServerIdentity:(_host,cert)=>cert.fingerprint256.replaceAll(':','').toLowerCase()===gateway.pairing.pin?undefined:Error('Pin mismatch'),headers:{Authorization:'Bearer '+token,...headers}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();
 });
 assert.equal((await call('/api/info','')).status,401);assert.equal((await call('/api/info','a'.repeat(63))).status,401);
 assert.equal((await call('/api/data')).status,403);assert.equal((await call('/api/info',undefined,{Origin:'https://example.org'})).status,403);
 assert.equal((await call('/api/info')).status,200);assert.equal(seen.host,'127.0.0.1:'+backend.address().port);assert.equal(seen.authorization,undefined);
 const oldToken=gateway.pairing.token;await gateway.close();gateway=await createGateway({directory,host:'127.0.0.1',port:0,backendPort:backend.address().port});assert.notEqual(gateway.pairing.token,oldToken);assert.equal((await call('/api/info',oldToken)).status,401);
 }finally{if(gateway)await gateway.close();await new Promise(r=>{backend.close(r);backend.closeAllConnections();});rmSync(directory,{recursive:true,force:true});}
});
test('Sprachverbindung leitet nur erlaubte Audioanfragen authentifiziert weiter',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'alfred-voice-gateway-'));const payload=Buffer.from('RIFFfixtureWAVE');let seen=[];
 const backend=createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{seen.push({path:req.url,body:Buffer.concat(chunks),type:req.headers['content-type']});res.setHeader('Content-Type',req.url.endsWith('synthesize')?'audio/wav':'application/json');res.end(req.url.endsWith('synthesize')?payload:JSON.stringify({text:'Hallo Alfred'}));});});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));let gateway;
 try{
 gateway=await createGateway({directory,host:'127.0.0.1',port:0,backendPort:backend.address().port});
 const call=(path,body,token=gateway.pairing.token,method='POST')=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:gateway.pairing.port,path,method,ca:readFileSync(join(directory,'certificate.pem')),checkServerIdentity:(_h,c)=>c.fingerprint256.replaceAll(':','').toLowerCase()===gateway.pairing.pin?undefined:Error('Pin mismatch'),headers:{Authorization:'Bearer '+token,'Content-Type':path.endsWith('transcribe')?'audio/wav':'application/json'}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type'],body:Buffer.concat(chunks)}));});req.on('error',reject);req.end(body);});
 assert.equal((await call('/api/voice/transcribe',payload,'')).status,401);assert.equal(seen.length,0);
 const transcript=await call('/api/voice/transcribe',payload);assert.equal(transcript.status,200);assert.deepEqual(seen[0].body,payload);assert.equal(seen[0].type,'audio/wav');
 const body=JSON.stringify({text:'Hallo, Sir.',confirmed:true});const output=await call('/api/voice/synthesize',body);assert.equal(output.type,'audio/wav');assert.deepEqual(output.body,payload);assert.equal(seen[1].body.toString(),body);
 for(const [method,path] of [['DELETE','/api/voice/transcribe'],['GET','/api/voice/synthesize'],['POST','/api/voice/execute'],['POST','/api/import']])assert.equal((await call(path,'',undefined,method)).status,403);
 assert.equal(allowed('GET','/api/voice/status'),true);assert.equal(allowed('GET','/api/voice/output/status'),true);
 }finally{if(gateway)await gateway.close();await new Promise(r=>{backend.close(r);backend.closeAllConnections();});rmSync(directory,{recursive:true,force:true});}
});
test('Dauerhafte Kopplung übersteht Neustart und wird ausdrücklich widerrufen',async()=>{
 const {savedConnection,revokeConnection,isTailnet}=require('../desktop/gateway.cjs');
 for(const ip of ['100.64.0.1','100.100.1.2','100.127.255.254'])assert.equal(isTailnet(ip),true);
 for(const ip of ['100.63.255.255','100.128.0.1','8.8.8.8','100.100.999.2','100.100.1.2.example'])assert.equal(isTailnet(ip),false);
 const directory=mkdtempSync(join(tmpdir(),'alfred-persistent-'));let gateway;
 try{
 gateway=await createGateway({directory,host:'127.0.0.1',port:0,persistent:true});const first=gateway.pairing;await gateway.close();gateway=null;
 const {statSync}=await import('node:fs');assert.equal(statSync(join(directory,'connection.json')).mode&0o777,0o600);assert.equal(savedConnection(directory).token,first.token);
 gateway=await createGateway({directory,host:'127.0.0.1',port:0,persistent:true});assert.equal(gateway.pairing.token,first.token);assert.equal(gateway.pairing.pin,first.pin);await gateway.close();gateway=null;
 revokeConnection(directory);assert.equal(savedConnection(directory),null);
 gateway=await createGateway({directory,host:'127.0.0.1',port:0,persistent:true});assert.notEqual(gateway.pairing.token,first.token);
 await assert.rejects(createGateway({directory,host:'8.8.8.8',port:0,persistent:true}),/private/);
 }finally{if(gateway)await gateway.close();rmSync(directory,{recursive:true,force:true});}
});
