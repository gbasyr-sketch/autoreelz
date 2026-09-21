import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
function run(command,args){const r=spawnSync(command,args,{stdio:'inherit'});if(r.status!==0)throw new Error(`${command} failed (${r.status})`);}
const docker=args=>run('docker',['compose','-p','autoreelz2026-new',...args]);
const node=file=>run(process.execPath,[`scripts/${file}`]);
run('python3',['scripts/init-env.py']);
await import('./cms-client.mjs'); // Verify the independent project/database identity.
docker(['config','--quiet']); // Never print the resolved configuration with secrets.
docker(['up','-d','--wait','--wait-timeout','120','db','cms']);
node('migrate.mjs');
docker(['restart','cms']);node('wait-cms.mjs');
node('configure-cms.mjs');
node('configure-commerce.mjs');
docker(['restart','cms']);node('wait-cms.mjs');
if(process.argv.includes('--seed-demo'))node('seed-cms.mjs');
node('export-cms.mjs');
docker(['up','-d','--build','--wait','--wait-timeout','120','web']);
docker(['up','-d','--wait','--wait-timeout','120','worker']);
console.log('New local stack ready. CMS: http://127.0.0.1:28055 · Docker storefront: http://127.0.0.1:14323');
