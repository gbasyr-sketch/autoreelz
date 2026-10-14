export const PRIVACY_VERSION='analytics-2026-10-14-v1';
export const PRIVACY_DAYS=180;
export const PRIVACY_COOKIE='autoreelz_privacy';
export const PRIVACY_VETO='autoreelz.analytics-off';
export const analyticsConsentText='Я разрешаю ИП Гурбанову Абдулбасыру Кямильевичу (ИНН 057102311218, ОГРНИП 323050000008776) обрабатывать технические данные моего посещения autoreelz.ru с помощью Яндекс.Метрики для анализа посещаемости и улучшения сайта: IP-адрес, cookie-идентификаторы, сведения о браузере и устройстве, просмотренных публичных страницах, источнике перехода и времени посещения. Получатель данных сервиса — ООО «ЯНДЕКС». Обработка автоматизированная: сбор, запись, систематизация, накопление, хранение, использование, передача сервису, обезличивание и удаление. Согласие добровольное, действует 180 дней или до отзыва через «Настройки cookies» внизу сайта либо обращения на in@autoreelz.ru. Отказ не ограничивает покупку. Контакты и содержимое заказов в аналитику не передаются. Согласие не распространяется на рекламные рассылки и публикацию отзывов.';
export type PrivacyChoice='accepted'|'rejected';
export interface PrivacyState {choice:PrivacyChoice|null;expiresAt:number|null;version:string;enabled:boolean;counterId:string|null}
export function analyticsPage(url:URL){
 // Never load the provider on private routes, search results, or URLs containing arbitrary data.
 if(url.search||url.hash)return false;
 return url.pathname==='/'||url.pathname==='/catalog'||url.pathname==='/blog'||/^\/(?:product|info|blog)\/[a-z0-9-]+\/?$/.test(url.pathname);
}
export function validCounterId(value:string){return /^[1-9]\d{0,11}$/.test(value);}
export function analyticsReferrer(referrer:string,origin:string){try{const url=new URL(referrer);return ['http:','https:'].includes(url.protocol)?url.origin+'/':origin+'/';}catch{return origin+'/';}}
