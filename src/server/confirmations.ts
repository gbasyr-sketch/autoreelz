import {testOrderTerms,productionOrderTerms} from '../lib/checkout-confirmations.ts';
import {StoreError} from './errors.ts';
import {requireCommerceEnvironment,appConfig} from './config.ts';
export function checkoutTerms(){requireCommerceEnvironment();return {...(appConfig().mode==='production'?productionOrderTerms:testOrderTerms)};}
export function verifyCheckoutConfirmation(value:unknown){
 const input=value as {accepted?:unknown;version?:unknown}|null;
 if(input?.accepted!==true)throw new StoreError('CONFIRMATION_REQUIRED','Подтвердите условия оформления заказа.');
 const terms=checkoutTerms();
 if(input.version!==terms.version)throw new StoreError('CONFIRMATION_CHANGED','Условия оформления изменились. Повторите проверку заказа.',409);
 return terms;
}
