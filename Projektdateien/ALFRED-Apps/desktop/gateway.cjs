const https=require('node:https');
const http=require('node:http');
const {readFileSync,mkdirSync,chmodSync,writeFileSync,renameSync,unlinkSync}=require('node:fs');
const {join}=require('node:path');
const {execFileSync}=require('node:child_process');
const {randomBytes,timingSafeEqual,X509Certificate}=require('node:crypto');
const {networkInterfaces}=require('node:os');
function lanAddresses(){return Object.entries(networkInterfaces()).flatMap(([name,entries])=>(entries||[]).filter(e=>e.family==='IPv4'&&!e.internal&&(isPrivate(e.address)||isTailnet(e.address))).map(e=>({name,address:e.address}))).sort((a,b)=>Number(isTailnet(b.address))-Number(isTailnet(a.address))||Number(b.name==='en0')-Number(a.name==='en0'));}
function isPrivate(ip){const p=ip.split('.').map(Number);return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(p[0]===10||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168));}
function isTailnet(ip){const p=ip.split('.').map(Number);return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&p[0]===100&&p[1]>=64&&p[1]<=127;}
function savedConnection(directory){try{const value=JSON.parse(readFileSync(join(directory,'connection.json'),'utf8'));if((isPrivate(value.host)||isTailnet(value.host)||value.host==='127.0.0.1')&&/^[a-f0-9]{64}$/.test(value.token))return value;}catch{}return null;}
function revokeConnection(directory){try{unlinkSync(join(directory,'connection.json'));}catch(e){if(e.code!=='ENOENT')throw e;}}
function allowed(method,path){return (method==='GET'&&['/api/voice/status','/api/voice/output/status'].includes(path))||(method==='POST'&&['/api/voice/transcribe','/api/voice/synthesize'].includes(path))||(method==='GET'&&['/api/info','/api/state','/api/status','/api/tasks'].includes(path))||(['GET','POST','PATCH','DELETE'].includes(method)&&/^\/api\/(?:chats(?:\/[a-f0-9-]+(?:\/messages)?)?|memories(?:\/[a-f0-9-]+)?|tasks(?:\/[a-f0-9-]+)?)$/.test(path));}
async function createGateway({directory,host,port=3212,backendPort=3210,persistent=false}){
 if(host!=='127.0.0.1'&&!isPrivate(host)&&!isTailnet(host))throw Error('Bitte eine private WLAN- oder Tailscale-Adresse verwenden.');
 mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const key=join(directory,'key.pem'),certificate=join(directory,'certificate.pem');
 try{readFileSync(key);readFileSync(certificate);}catch{execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',certificate,'-days','365','-subj','/CN=ALFRED Local'],{stdio:'ignore'});}
 chmodSync(key,0o600);chmodSync(certificate,0o600);
 const cert=readFileSync(certificate);const pin=new X509Certificate(cert).fingerprint256.replaceAll(':','').toLowerCase();
 const saved=persistent?savedConnection(directory):null;const token=saved?.host===host?saved.token:randomBytes(32).toString('hex');
 const server=https.createServer({key:readFileSync(key),cert,minVersion:'TLSv1.2'},(req,res)=>{
 const fail=status=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:status===401?'Kopplung erforderlich.':'Anfrage abgewiesen.'}));};
 const supplied=(req.headers.authorization||'').replace(/^Bearer /,'');
 if(! /^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return fail(401);
 const url=new URL(req.url,'https://localhost');if(!allowed(req.method,url.pathname))return fail(403);
 if(req.headers.origin)return fail(403); // Native app only; no cross-origin browser access.
 const upstream=http.request({hostname:'127.0.0.1',port:backendPort,path:url.pathname+url.search,method:req.method,headers:{host:`127.0.0.1:${backendPort}`,...(req.headers['content-type']?{'content-type':req.headers['content-type']}:{})}},response=>{
 res.writeHead(response.statusCode||502,{'Content-Type':response.headers['content-type']||'application/json','Cache-Control':'no-store'});response.pipe(res);
 });
 let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>2097152){upstream.destroy();if(!res.headersSent)fail(413);else res.destroy();}});
 req.pipe(upstream);req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
 upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'ALFRED auf dem Mac ist nicht erreichbar.'}));}else res.destroy();});
 });
 server.requestTimeout=200000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 if(persistent){const file=join(directory,'connection.json'),pending=file+'.tmp';try{writeFileSync(pending,JSON.stringify({host,token}),{mode:0o600});chmodSync(pending,0o600);renameSync(pending,file);}catch(e){await new Promise(r=>server.close(r));throw e;}}
 return {server,pairing:{format:'alfred-pairing',version:1,host,port:server.address().port,token,pin},close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
module.exports={createGateway,lanAddresses,isPrivate,isTailnet,savedConnection,revokeConnection,allowed};
