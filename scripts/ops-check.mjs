// Private operator command, no public metrics endpoint and no customer/order identifiers.
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,localEnvironment,compose,sql} from './ops-common.mjs';
localEnvironment();
const services=compose(['ps','--format','json']).split('\n').filter(Boolean).map(s=>JSON.parse(s)).map(s=>({service:s.Service,state:s.State,health:s.Health}));
const counters=JSON.parse(sql(`SELECT json_build_object(
 'workerAgeSeconds',(SELECT extract(epoch FROM now()-last_run_at)::int FROM ar_worker_heartbeat WHERE name='commerce'),
 'expiredAllocations',(SELECT count(*) FROM ar_orders WHERE status IN('open','awaiting_payment') AND expires_at<now()-interval '60 seconds' AND allocation_state IN('reserved','debited')),
 'paymentReviews',(SELECT count(*) FROM ar_orders WHERE status='manual_review'),
 'oldPendingMail',(SELECT count(*) FROM ar_mail_outbox WHERE status='pending' AND created_at<now()-interval '5 minutes'),
 'failedNotifications',(SELECT count(*) FROM ar_owner_notifications WHERE status='failed'),
 'oldPendingNotifications',(SELECT count(*) FROM ar_owner_notifications WHERE status='pending' AND created_at<now()-interval '5 minutes'))`));
const backupsDir=join(root,'private/backups');
const backups=existsSync(backupsDir)?readdirSync(backupsDir).flatMap(name=>{try{const m=JSON.parse(readFileSync(join(backupsDir,name,'manifest.json'),'utf8'));return m.complete?[m]:[];}catch{return[];}}):[];
const latest=backups.sort((a,b)=>Date.parse(b.finishedAt)-Date.parse(a.finishedAt))[0];
const backupAgeHours=latest?(Date.now()-Date.parse(latest.finishedAt))/3600000:null;
const issues=[];
for(const name of ['db','cms','web','worker'])if(!services.some(s=>s.service===name&&s.health==='healthy'))issues.push(`${name}: unhealthy or missing`);
if(counters.workerAgeSeconds===null||counters.workerAgeSeconds>60)issues.push('worker: stale heartbeat');
for(const name of ['expiredAllocations','paymentReviews','oldPendingMail','failedNotifications','oldPendingNotifications'])if(counters[name]>0)issues.push(`${name}: ${counters[name]}`);
if(backupAgeHours===null||backupAgeHours>24)issues.push('backup: no completed copy in the last 24h');
console.log(JSON.stringify({checkedAt:new Date().toISOString(),ok:issues.length===0,services,counters,backupAgeHours,issues},null,2));if(issues.length)process.exitCode=1;
