import retailOffer from './retail-offer.json' with {type:'json'};
export interface ConfirmationLabelPart {text:string;href?:'/info/offer'|'/info/personal-data'}
const agreementLabelParts:ConfirmationLabelPart[]=[
 {text:'Принимаю условия '},
 {text:'публичной оферты',href:'/info/offer'},
 {text:'. С '},
 {text:'политикой обработки персональных данных',href:'/info/personal-data'},
 {text:' ознакомлен.'},
];
// These are test-service conditions, not an approved retail public offer.
export const testOrderTerms = {
 version: 'test-order-2026-10-15-v2-'+retailOffer.sha256.slice(0,12),
 title: 'Условия тестового заказа',
 label: agreementLabelParts.map(part=>part.text).join(''),
 labelParts:agreementLabelParts,
 body: 'AUTO REELZ работает в тестовом режиме. Используйте вымышленные контактные данные. Реальные деньги не списываются, товары не отправляются. Товары в наличии и предзаказ оформляются отдельно. Если количества не хватает, вся строка становится предзаказом. Неизвестная стоимость доставки уточняется до оплаты; предзаказ требует согласования с менеджером. Срок оплаты составляет 30 минут после согласования суммы и даты получения. Пока условия уточняются, товары не резервируются. Вложенная редакция оферты сохраняется для тестовой проверки будущего оформления; реальные продажи не включены. Подтверждение оформления и ознакомление с политикой не являются согласием на рекламу, аналитику или публикацию отзывов.',
 offer:retailOffer,
};
export interface CheckoutConfirmation {version:string;title:string;label:string;labelParts?:ConfirmationLabelPart[];body:string;offer?:{version:string;sha256:string;title:string;body:string}}
