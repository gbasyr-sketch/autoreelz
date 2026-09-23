import {setting} from './config.ts';
export function releaseInfo(){
 const revision=setting('APP_REVISION','development');
 return{revision:/^[a-f0-9]{40}$/.test(revision)?revision:'development'};
}
