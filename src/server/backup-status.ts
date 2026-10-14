import {lstat,readFile} from 'node:fs/promises';
import {setting} from './config.ts';
import {backupStatus} from '../lib/backup-status.ts';
export async function readBackupStatus(path=setting('BACKUP_STATUS_PATH')){
 if(!path)return backupStatus(null);
 try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)return backupStatus({});return backupStatus(JSON.parse(await readFile(path,'utf8')));}
 catch(error){return backupStatus((error as {code?:string}).code==='ENOENT'?null:{});}
}
