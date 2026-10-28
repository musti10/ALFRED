import {DatabaseSync,backup} from 'node:sqlite';
import {chmodSync} from 'node:fs';
const db=new DatabaseSync(process.argv[2],{readOnly:true});
try{await backup(db,process.argv[3]);chmodSync(process.argv[3],0o600);}finally{db.close();}
