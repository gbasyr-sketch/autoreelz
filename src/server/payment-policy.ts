import {appConfig,requireTestEnvironment,setting} from './config.ts';
import {StoreError} from './errors.ts';
import {createYooKassaSandbox} from './adapters/yookassa-sandbox.ts';
export type PaymentProvider='simulation'|'yookassa-sandbox';
export function paymentProvider():PaymentProvider {
 const selected=setting('PAYMENT_PROVIDER','simulation');
 if(selected!=='simulation'&&selected!=='yookassa-sandbox')throw new StoreError('PAYMENT_CONFIG','Оплата временно недоступна.',503);
 return selected;
}
export function sandboxConfig(){
 requireTestEnvironment();
 const shopId=setting('YOOKASSA_SHOP_ID'),secretKey=setting('YOOKASSA_SECRET_KEY'),returnOrigin=appConfig().origin;
 if(!/^\d{1,20}$/.test(shopId)||secretKey.length<16)throw new StoreError('PAYMENT_SETUP','Тестовая оплата ещё не настроена.',503);
 return{shopId,secretKey,returnOrigin};
}
export const sandboxClient=()=>createYooKassaSandbox(sandboxConfig());
