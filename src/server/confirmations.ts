import {testOrderTerms,yandexMapConsent} from '../lib/checkout-confirmations.ts';
import type {ShopSession} from '../lib/commerce-types.ts';
import {StoreError} from './errors.ts';
import {requireTestEnvironment} from './config.ts';
import {transaction} from './db.ts';
import {idempotent} from './security.ts';
export function checkoutTerms(){requireTestEnvironment();return {...testOrderTerms};}
export function verifyCheckoutConfirmation(value:unknown){
 const input=value as {accepted?:unknown;version?:unknown}|null;
 if(input?.accepted!==true)throw new StoreError('CONFIRMATION_REQUIRED','Подтвердите условия оформления заказа.');
 const terms=checkoutTerms();
 if(input.version!==terms.version)throw new StoreError('CONFIRMATION_CHANGED','Условия оформления изменились. Повторите проверку заказа.',409);
 return terms;
}
export async function acceptMapConsent(session:ShopSession,body:Record<string,unknown>){
 if(body.accepted!==true||body.version!==yandexMapConsent.version)throw new StoreError('CONSENT_REQUIRED','Прочитайте и подтвердите согласие на подключение Яндекс.Карт.');
 return transaction(c=>idempotent(c,`map-consent:${session.id}`,body.idempotencyKey,{version:body.version,accepted:true},async()=>{
  const row=(await c.query("INSERT INTO ar_service_consents(session_id,service,version,snapshot) VALUES($1,'yandex-pickup-map',$2,$3) RETURNING id,accepted_at",[session.id,yandexMapConsent.version,yandexMapConsent])).rows[0];
  return{id:row.id,acceptedAt:row.accepted_at.toISOString()};
 }));
}
