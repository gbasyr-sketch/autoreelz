import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
function sql(input){
 const r=spawnSync('docker',['compose','-p','autoreelz2026-new','exec','-T','db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d','autoreelz2026_new','-At'],{input,encoding:'utf8'});
 if(r.status!==0)throw new Error(r.stderr||'Migration failed');
 return r.stdout.trim();
}
sql('CREATE TABLE IF NOT EXISTS ar_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());');
for(const name of readdirSync('migrations').filter(n=>/^\d+_.*\.sql$/.test(n)).sort()){
 const body=readFileSync(`migrations/${name}`,'utf8');const hash=createHash('sha256').update(body).digest('hex');
 const existing=sql(`SELECT sha256 FROM ar_migrations WHERE name='${name}';`);
 if(existing){if(existing!==hash)throw new Error(`Applied migration ${name} was changed. Add a new migration.`);console.log(`Unchanged: ${name}`);continue;}
 sql(`BEGIN; SELECT pg_advisory_xact_lock(320260900);\n${body}\nINSERT INTO ar_migrations(name,sha256) VALUES('${name}','${hash}'); COMMIT;`);
 console.log(`Applied: ${name}`);
}
