import {fileURLToPath} from 'node:url';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,statSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('Vorhandene Daten werden konsistent kopiert, Quelle bleibt unverändert',()=>{
 const directory=mkdtempSync(join(tmpdir(),'alfred app migrate '));const source=join(directory,'old.sqlite'),target=join(directory,'new.sqlite');
 const original=new DatabaseSync(source);original.exec("CREATE TABLE sample(text TEXT); INSERT INTO sample VALUES('Bestehender Chat');");
 try{execFileSync(process.execPath,[fileURLToPath(new URL('../desktop/migrate.mjs',import.meta.url)),source,target]);const copy=new DatabaseSync(target);assert.equal(copy.prepare('SELECT text FROM sample').get().text,'Bestehender Chat');copy.prepare('INSERT INTO sample VALUES(?)').run('Neue Daten');assert.equal(original.prepare('SELECT count(*) AS n FROM sample').get().n,1);assert.equal(statSync(target).mode&0o777,0o600);copy.close();}finally{original.close();rmSync(directory,{recursive:true,force:true});}
});
