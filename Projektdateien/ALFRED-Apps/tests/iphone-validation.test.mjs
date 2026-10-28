import {fileURLToPath} from 'node:url';
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
test('iPhone prüft echte Swift-Kopplung und Audio-URLs für WLAN und Tailscale',()=>{
 const source=readFileSync(new URL('../iphone/ALFRED/ALFREDApp.swift',import.meta.url),'utf8');const model=source.slice(source.indexOf('struct Pairing:'),source.indexOf('enum Keychain'));
 const urls=[...source.matchAll(/URL\(string:"(https:[^"]+)"\)/g)].map(m=>m[1]);assert.equal(urls.length,2);
 const directory=mkdtempSync(join(tmpdir(),'alfred-swift-pair-'));
 try{const program='import Foundation\n'+model+String.raw`
func make(_ host:String)->Pairing{Pairing(format:"alfred-pairing",version:1,host:host,port:3212,token:String(repeating:"a",count:64),pin:String(repeating:"b",count:64))}
for host in ["192.168.0.2","10.1.2.3","100.64.0.1","100.127.255.254"]{try make(host).validate()}
for host in ["","8.8.8.8","100.63.255.255","100.128.0.1","100.100.999.1","example.com","100.1"]{do{try make(host).validate();fatalError("Host accepted: \(host)")}catch{}}
let pairing=make("100.100.1.2"),path="/api/voice/transcribe"
`+urls.map(u=>`do{let url=URL(string:"${u}")!;assert(url.scheme=="https");assert(url.host==pairing.host);assert(url.port==3212);assert(url.path==path)}`).join('\n')+'\nprint("Swift validation passed")\n';
 const file=join(directory,'check.swift');writeFileSync(file,program);assert.match(execFileSync('/usr/bin/swift',[file],{encoding:'utf8'}),/validation passed/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('TLS-Ausnahme ist auf den gekoppelten Mac beschränkt; HTTPS und Fingerabdruck bleiben Pflicht',()=>{
 const plist=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',fileURLToPath(new URL('../iphone/ALFRED/Info.plist',import.meta.url))],{encoding:'utf8'}));const ats=plist.NSAppTransportSecurity;
 assert.notEqual(ats.NSAllowsArbitraryLoads,true);const entries=Object.entries(ats.NSExceptionDomains||{});assert.equal(entries.length,1);
 for(const [host,settings] of entries){assert.match(host,/^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d+\.\d+$/);assert.equal(settings.NSExceptionAllowsInsecureHTTPLoads,true);assert.equal(settings.NSExceptionMinimumTLSVersion,'TLSv1.2');assert.equal(settings.NSExceptionRequiresForwardSecrecy,true);}
 const code=readFileSync(new URL('../iphone/ALFRED/ALFREDApp.swift',import.meta.url),'utf8');assert.match(code,/actual==pairing.pin/);assert.match(code,/challenge.protectionSpace.host==pairing.host/);assert.match(code,/cancelAuthenticationChallenge/);
});
