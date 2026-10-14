import {readFileSync} from 'node:fs';
import {setting,requireTestEnvironment} from './config.ts';
import {email,StoreError} from './errors.ts';
export const MAIL_SENDER='sales@autoreelz.ru';
export function mailProvider(){
 const value=setting('MAIL_PROVIDER','simulation');
 if(value!=='simulation'&&value!=='timeweb-smtp')throw new StoreError('MAIL_CONFIG','Неверная настройка почты.',503);
 return value;
}
export function mailRecipientAllowed(recipient:string){
 // This store is still staging; an empty allowlist never enables unrestricted delivery.
 requireTestEnvironment();
 const allowed=setting('MAIL_ALLOWED_RECIPIENTS').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 return allowed.includes(email(recipient));
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
