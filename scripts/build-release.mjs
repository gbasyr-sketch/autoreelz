// Build an exact, clean local commit. Does not push an image or deploy it.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname,delimiter} from 'node:path';
import {root,run,docker} from './ops-common.mjs';
if(run('git',['status','--porcelain']))throw Error('Commit all intended changes before building a release');
const sha=run('git',['rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Invalid Git revision');
run('npm',['run','check'],{env:{...process.env,PATH:dirname(process.execPath)+delimiter+(process.env.PATH??'')}});
run(process.execPath,['--test','tests/release.test.ts']);
const tag=`autoreelz2026-new-web:${sha}`;
docker(['build','--build-arg',`VCS_REF=${sha}`,'--tag',tag,'.']);
const image=docker(['image','inspect',tag,'--format','{{.Id}}']);
mkdirSync(join(root,'private/releases'),{recursive:true,mode:0o700});
writeFileSync(join(root,`private/releases/${sha}.json`),JSON.stringify({sha,tag,image,builtAt:new Date().toISOString(),deployed:false},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({sha,tag,image,deployed:false}));
