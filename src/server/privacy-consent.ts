import {randomUUID} from 'node:crypto';
import type {APIContext} from 'astro';
import {PRIVACY_VERSION,PRIVACY_COOKIE,PRIVACY_DAYS,analyticsConsentText,validCounterId,type PrivacyState,type PrivacyChoice} from '../lib/privacy-consent.ts';
import {appConfig,setting} from './config.ts';
import {sign,equal,idempotent} from './security.ts';
import {transaction} from './db.ts';
import {StoreError} from './errors.ts';
import type {ShopSession} from '../lib/commerce-types.ts';
type ChoiceRecord={choice:PrivacyChoice;version:string;expiresAt:number;id:string};
export function encodePrivacy(value:ChoiceRecord){const payload=Buffer.from(JSON.stringify(value)).toString('base64url');return payload+'.'+sign('privacy:'+payload);}
export function decodePrivacy(cookie:string|undefined,now=Date.now()):ChoiceRecord|null{
 try{if(!cookie||cookie.length>1024)return null;const parts=cookie.split('.');if(parts.length!==2||!equal(sign('privacy:'+parts[0]),parts[1]!))return null;
  const value=JSON.parse(Buffer.from(parts[0]!,'base64url').toString('utf8'));
  if(!['accepted','rejected'].includes(value.choice)||value.version!==PRIVACY_VERSION||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+PRIVACY_DAYS*86400000+60000||typeof value.id!=='string'||!/^[a-f0-9-]{36}$/.test(value.id))return null;return value;
 }catch{return null;}
}
export function privacySettings(url:URL,cookie?:string):PrivacyState{
 const config=appConfig(),id=setting('METRIKA_COUNTER_ID'),choice=decodePrivacy(cookie);
 const originOK=url.origin===config.origin&&(url.origin==='https://autoreelz.ru'||config.mode==='local-test'&&['127.0.0.1','localhost'].includes(url.hostname));
 const enabled=originOK&&setting('METRIKA_ENABLED','false')==='true'&&validCounterId(id);
 return{choice:choice?.choice??null,expiresAt:choice?.expiresAt??null,version:PRIVACY_VERSION,enabled,counterId:enabled?id:null};
}
export async function savePrivacy(session:ShopSession,body:Record<string,unknown>){
 if(!['accepted','rejected'].includes(String(body.choice))||body.version!==PRIVACY_VERSION)throw new StoreError('PRIVACY_VERSION','Обновите страницу и прочитайте действующие условия аналитики.',409);
 const choice=body.choice as PrivacyChoice;
 if(choice==='accepted'&&(!validCounterId(setting('METRIKA_COUNTER_ID'))||setting('METRIKA_ENABLED','false')!=='true'))throw new StoreError('ANALYTICS_DISABLED','Аналитика пока не подключена.',409);
 return transaction(c=>idempotent(c,`privacy:${session.id}`,body.idempotencyKey,{choice,version:PRIVACY_VERSION},async()=>{
  const rate=await c.query(`INSERT INTO ar_rate_limits(key,count,reset_at) VALUES($1,1,now()+interval '1 hour')
   ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ar_rate_limits.reset_at<=now() THEN 1 ELSE ar_rate_limits.count+1 END,
   reset_at=CASE WHEN ar_rate_limits.reset_at<=now() THEN now()+interval '1 hour' ELSE ar_rate_limits.reset_at END
   WHERE ar_rate_limits.reset_at<=now() OR ar_rate_limits.count<30 RETURNING id`,['privacy-choice:'+session.id]);
  if(!rate.rowCount)throw new StoreError('PRIVACY_RATE_LIMIT','Слишком частые изменения настроек. Повторите позже.',429);
  const id=randomUUID(),expiresAt=Date.now()+PRIVACY_DAYS*86400000;
  await c.query('INSERT INTO ar_privacy_events(id,session_id,choice,version,consent_text,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,session.id,choice,PRIVACY_VERSION,analyticsConsentText,new Date(expiresAt)]);
  return{id,choice,version:PRIVACY_VERSION,expiresAt};
 }));
}
export function setPrivacyCookie(ctx:Pick<APIContext,'cookies'>,choice:ChoiceRecord){ctx.cookies.set(PRIVACY_COOKIE,encodePrivacy(choice),{path:'/',httpOnly:true,secure:new URL(appConfig().origin).protocol==='https:',sameSite:'lax',expires:new Date(choice.expiresAt)});}
