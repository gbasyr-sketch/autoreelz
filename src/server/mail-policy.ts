import {readFileSync} from 'node:fs';
import {setting,requireTestEnvironment} from './config.ts';
import {email,StoreError} from './errors.ts';
export const MAIL_SENDER='sales@autoreelz.ru';
export function mailProvider(){
 const value=setting('MAIL_PROVIDER','simulation');
 if(value!=='simulation'&&value!=='timeweb-smtp')throw new StoreError('MAIL_CONFIG','Неверная настройка почты.',503);
 return value;
}
export function mailRecipientPolicy(){
 const policy=setting('MAIL_RECIPIENT_POLICY','allowlist');
 if(!['allowlist','all-new'].includes(policy))throw new StoreError('MAIL_CONFIG','Неверная политика адресатов.',503);
 return policy;
}
function mailCutoff(){
 const raw=setting('MAIL_NEW_MESSAGES_FROM');
 if(!raw){if(mailRecipientPolicy()==='all-new')throw new StoreError('MAIL_CONFIG','Не указано начало отправки новых писем.',503);return null;}
 const at=Date.parse(raw);
 if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)||!Number.isFinite(at))throw new StoreError('MAIL_CONFIG','Неверное начало отправки новых писем.',503);
 return at;
}
export function mailMessageIsNew(createdAt:string|Date){
 const cutoff=mailCutoff(),at=new Date(createdAt).getTime();
 return Number.isFinite(at)&&(cutoff===null||at>=cutoff);
}
export function mailRecipientAllowed(recipient:string){
 requireTestEnvironment();const address=email(recipient);
 if(mailRecipientPolicy()==='all-new'){mailCutoff();return true;}
 const allowed=setting('MAIL_ALLOWED_RECIPIENTS').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 return allowed.includes(address);
}
export function requireMailRecipient(recipient:string){
 if(mailProvider()==='timeweb-smtp'&&!mailRecipientAllowed(recipient))throw new StoreError('MAIL_TEST_RECIPIENT','В тестовом магазине письма доступны только на согласованные адреса.',403);
}
export function ownerMailRecipient(){const value=setting('MAIL_OWNER_RECIPIENT').trim();return value?email(value):null;}
export function smtpPassword(){
 let value=setting('SMTP_PASSWORD');
 if(!value){try{value=readFileSync(setting('SMTP_PASSWORD_FILE','private/sales-smtp-password.txt'),'utf8').replace(/\r?\n$/,'');}catch{throw new StoreError('SMTP_SETUP','SMTP-доступ не настроен.',503);}}
 if(!value||value.length>512||/[\r\n\0]/.test(value))throw new StoreError('SMTP_SETUP','Проверьте приватный файл SMTP-доступа.',503);
 return value;
}
