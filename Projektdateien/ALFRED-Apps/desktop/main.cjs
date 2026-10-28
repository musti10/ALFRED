const {app,BrowserWindow,Menu,dialog,clipboard,systemPreferences}=require('electron');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {existsSync,mkdirSync,readFileSync}=require('node:fs');
const {join}=require('node:path');
const QRCode=require('qrcode');
const {createGateway,lanAddresses,isTailnet,savedConnection,revokeConnection}=require('./gateway.cjs');
const run=promisify(execFile),origin='http://127.0.0.1:3210';let mainWindow,child,gateway,pairWindow,quitting=false,resumeTimer=null;
app.setName('ALFRED');
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{mainWindow?.show();mainWindow?.focus();});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function health(){try{const r=await fetch(origin+'/api/info',{signal:AbortSignal.timeout(1000)});const data=await r.json();return data.app==='alfred-local';}catch{return false;}}
async function backend(){
 if(await health())return;
 const resources=app.isPackaged?process.resourcesPath:join(__dirname,'..','staging');
 const executable=join(resources,'runtime','node'),server=join(resources,'backend','server.ts');
 if(!existsSync(server))throw Error('Backend fehlt. Bitte zuerst npm run build:mac ausführen und ALFRED.app öffnen.');
 const data=join(app.getPath('userData'),'data');mkdirSync(data,{recursive:true,mode:0o700});
 const config=JSON.parse(readFileSync(join(resources,'installation.json'),'utf8'));
 child=spawn(executable,[server],{env:{...process.env,PORT:'3210',ALFRED_DATA_DIR:data,ALFRED_PROJECT_DIR:config.projectRoot},stdio:['ignore','ignore','pipe']});
 child.on('error',()=>{});child.stderr.on('data',()=>{});
 for(let attempt=0;attempt<80;attempt++){if(await health())return;if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,250));}
 throw Error('ALFRED konnte nicht gestartet werden. Prüfe, ob Port 3210 von einer anderen Anwendung belegt ist.');
}
function permissions(session){
 const trusted=url=>{try{return new URL(url).origin===origin;}catch{return false;}};
 session.setPermissionCheckHandler((_web,permission,url,details)=>trusted(url)&&((permission==='media'&&details.mediaType==='audio')||permission==='clipboard-sanitized-write'));
 session.setPermissionRequestHandler(async(web,permission,callback,details)=>{
 if(!trusted(web.getURL()))return callback(false);
 if(permission==='media'&&details.mediaTypes?.every(type=>type==='audio')&&details.mediaTypes?.length){try{return callback(await systemPreferences.askForMediaAccess('microphone'));}catch{return callback(false);}}
 callback(permission==='clipboard-sanitized-write');
 });
}
async function stopSharing(revoke=false){if(revoke)revokeConnection(join(app.getPath('userData'),'pairing'));if(gateway){await gateway.close();gateway=null;}if(pairWindow&&!pairWindow.isDestroyed())pairWindow.close();pairWindow=null;menu();}
async function pair(){
 try{
 if(!gateway){const addresses=lanAddresses();if(!addresses.length)throw Error('Keine WLAN- oder Tailscale-Adresse gefunden. Bitte Tailscale auf dem Mac verbinden.');
 let selected=0;if(addresses.length>1){const choice=await dialog.showMessageBox(mainWindow,{type:'question',title:'iPhone verbinden',message:'Welche Verbindung soll verwendet werden?',detail:'Für mobile Daten die Tailscale-Adresse (100.64–100.127) auswählen. Die Kopplung bleibt bis zum Widerruf gespeichert.',buttons:[...addresses.map(a=>(isTailnet(a.address)?'Tailscale':'WLAN')+' · '+a.address),'Abbrechen'],cancelId:addresses.length});if(choice.response===addresses.length)return;selected=choice.response;}
 gateway=await createGateway({directory:join(app.getPath('userData'),'pairing'),host:addresses[selected].address,persistent:true});menu();}
 const connection=JSON.stringify(gateway.pairing);const qr=await QRCode.toDataURL(connection,{margin:2,width:300,errorCorrectionLevel:'M'});
 if(pairWindow&&!pairWindow.isDestroyed())pairWindow.close();pairWindow=new BrowserWindow({title:'ALFRED · iPhone koppeln',width:470,height:670,resizable:false,parent:mainWindow,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 const html=`<!doctype html><html lang="de"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>body{background:#15191a;color:#e5e7df;font:15px -apple-system;padding:24px;text-align:center}img{width:270px;border-radius:10px}p{line-height:1.5}textarea{width:100%;height:85px;background:#252c26;color:#d6dfd0;font-size:10px;border:1px solid #59694e}small{color:#aeb9aa}</style><h1>Mit deinem iPhone verbinden</h1><p>In der ALFRED-iPhone-App „QR-Code scannen“ wählen. Für unterwegs Tailscale auf beiden Geräten mit demselben Konto aktivieren.</p><img src="${qr}" alt="Privater Kopplungscode"><p>${escape(gateway.pairing.host)} · verschlüsselte Verbindung</p><textarea readonly aria-label="Verbindungsdaten">${escape(connection)}</textarea><p><small>Diesen Code privat halten. Kopplung widerrufen: Menü ALFRED → iPhone-Kopplung widerrufen. Die Verbindung kehrt beim nächsten App-Start zurück; Mac und ALFRED müssen erreichbar bleiben.</small></p></html>`;
 const window=pairWindow;window.on('closed',()=>{if(pairWindow===window)pairWindow=null;});await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));if(!window.isDestroyed())window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 }catch(e){dialog.showErrorBox('iPhone-Verbindung',e.message);}
}
async function resumeSharing(){if(gateway||quitting)return;const directory=join(app.getPath('userData'),'pairing'),saved=savedConnection(directory);if(!saved)return;try{gateway=await createGateway({directory,host:saved.host,persistent:true});menu();}catch{/* VPN may not yet be connected. Retry while ALFRED remains open. */}}
function menu(){Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'ALFRED',submenu:[{role:'about'},{label:'iPhone verbinden …',click:pair},{label:'Verbindungsdaten kopieren',enabled:!!gateway,click:()=>clipboard.writeText(JSON.stringify(gateway.pairing))},{label:'iPhone-Kopplung widerrufen',enabled:!!gateway||!!savedConnection(join(app.getPath('userData'),'pairing')),click:()=>{void stopSharing(true);}},{type:'separator'},{role:'hide'},{role:'unhide'},{role:'quit'}]},{label:'Bearbeiten',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'Ansicht',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}]));}
app.whenReady().then(async()=>{
 menu();mainWindow=new BrowserWindow({title:'ALFRED',width:1320,height:880,minWidth:780,minHeight:650,backgroundColor:'#080808',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,autoplayPolicy:'no-user-gesture-required'}});
 permissions(mainWindow.webContents.session);mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));mainWindow.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/'))event.preventDefault();});
 mainWindow.on('closed',()=>mainWindow=null);
 try{await backend();await mainWindow.loadURL(origin);await resumeSharing();resumeTimer=setInterval(()=>{void resumeSharing();},30000);}catch(e){dialog.showErrorBox('ALFRED konnte nicht starten',e.message);app.quit();}
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(quitting)return;quitting=true;clearInterval(resumeTimer);event.preventDefault();void (async()=>{await stopSharing();if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);if(child.exitCode===null)child.kill('SIGKILL');}app.quit();})();});
