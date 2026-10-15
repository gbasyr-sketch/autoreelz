import {appConfig,requireTestEnvironment,requireCommerceEnvironment,setting} from './config.ts';
import {StoreError} from './errors.ts';
import {createYooKassa} from './adapters/yookassa-sandbox.ts';
export type PaymentProvider='simulation'|'yookassa-sandbox'|'yookassa-live';
export function paymentProvider():PaymentProvider {
 const selected=setting('PAYMENT_PROVIDER','simulation');
 if(!['simulation','yookassa-sandbox','yookassa-live'].includes(selected))throw new StoreError('PAYMENT_CONFIG','Оплата временно недоступна.',503);
 return selected as PaymentProvider;
}
export const isYooKassa=()=>paymentProvider()!=='simulation';
export const liveOperationsPaused=()=>paymentProvider()==='yookassa-live'&&setting('YOOKASSA_LIVE_OPERATIONS_ENABLED','false')!=='true';
export function receiptMode(){
 const mode=setting('YOOKASSA_RECEIPTS_MODE','disabled');
 if(!['disabled','yookassa'].includes(mode))throw new StoreError('RECEIPT_CONFIG','Неверная настройка чеков.',503);
 return mode as 'disabled'|'yookassa';
}
export function requirePaymentEnvironment(){
 requireCommerceEnvironment();
 if(paymentProvider()==='yookassa-live'){
  if(appConfig().mode!=='production'||appConfig().origin!=='https://autoreelz.ru'||setting('YOOKASSA_LIVE_OPERATIONS_ENABLED','false')!=='true'||receiptMode()!=='yookassa')throw new StoreError('LIVE_PAYMENT_DISABLED','Приём реальных платежей пока не включён.',503);
 }else requireTestEnvironment();
}
export function sandboxConfig(){
 requirePaymentEnvironment();const live=paymentProvider()==='yookassa-live';
 const shopId=setting(live?'YOOKASSA_LIVE_SHOP_ID':'YOOKASSA_SHOP_ID'),secretKey=setting(live?'YOOKASSA_LIVE_SECRET_KEY':'YOOKASSA_SECRET_KEY'),returnOrigin=appConfig().origin;
 if(!/^\d{1,20}$/.test(shopId)||secretKey.length<16||/[\r\n]/.test(secretKey)||live&&secretKey.startsWith('test_'))throw new StoreError('PAYMENT_SETUP','ЮKassa ещё не настроена.',503);
 return{shopId,secretKey,returnOrigin,test:!live};
}
// Compatibility names keep existing sandbox integrations and fixtures unchanged.
export const sandboxClient=()=>createYooKassa(sandboxConfig());
