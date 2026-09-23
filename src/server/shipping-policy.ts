import {setting,requireTestEnvironment} from './config.ts';
import {StoreError} from './errors.ts';
import {createCdekClient} from './adapters/cdek.ts';
export function shippingProvider(){const p=setting('SHIPPING_PROVIDER','simulation');if(p!=='simulation'&&p!=='cdek')throw new StoreError('SHIPPING_CONFIG','Расчёт доставки временно недоступен.',503);return p;}
export function shippingContext(){return{provider:shippingProvider(),originPoint:setting('CDEK_FROM_PVZ'),originCity:setting('CDEK_FROM_CITY_CODE'),policy:'parcel-v1'};}
export function cdekConfig(){requireTestEnvironment();const clientId=setting('CDEK_CLIENT_ID'),clientSecret=setting('CDEK_CLIENT_SECRET'),fromPoint=setting('CDEK_FROM_PVZ'),fromCity=Number(setting('CDEK_FROM_CITY_CODE'));if(!clientId||!clientSecret||!Number.isSafeInteger(fromCity)||fromCity<=0||!/^[A-Za-z0-9_-]{1,64}$/.test(fromPoint))throw new StoreError('SHIPPING_SETUP','СДЭК ещё не настроен. Укажите адрес для ручного расчёта.',503);return{clientId,clientSecret,fromPoint,fromCity};}
let client:ReturnType<typeof createCdekClient>|undefined,key='';
export function cdekClient(){const config=cdekConfig(),next=JSON.stringify([config.clientId,config.clientSecret]);if(!client||next!==key){client=createCdekClient(config);key=next;}return client;}
