import {requireLocalTest} from '../config.ts';
/** Explicit fact whitelist. Customer data and manual SEO title never enter the adapter. */
export interface DescriptionFacts {
 name:string;kind:'single'|'bundle';isDemo:boolean;category:string;
 variants:{name:string;article:string}[];
 components:{name:string;article:string;quantity:number}[];
 attributes:{name:string;value:string}[];
}
export interface DescriptionResult {description:string;metaDescription:string}
export function generateLocalDescription(data:DescriptionFacts):DescriptionResult{
 requireLocalTest();const paragraphs=[data.name+'.'];
 if(data.isDemo)paragraphs.push('Демонстрационный образец каталога AUTO REELZ. Сведения требуют проверки перед продажей.');
 if(data.category)paragraphs.push('Категория: '+data.category+'.');
 if(data.variants.length)paragraphs.push('Исполнения: '+data.variants.map(v=>v.name+' ('+v.article+')').join('; ')+'.');
 if(data.components.length)paragraphs.push('Фиксированный состав: '+data.components.map(x=>x.name+' — '+x.quantity+' шт. ('+x.article+')').join('; ')+'.');
 if(data.attributes.length)paragraphs.push('Характеристики: '+data.attributes.map(a=>a.name+': '+a.value).join('; ')+'.');
 paragraphs.push('Перед заказом проверьте совместимость конкретного исполнения с автомобилем в карточке товара.');
 return{description:paragraphs.join('\n\n').slice(0,10000),metaDescription:(data.name+'. '+data.category+'. '+(data.kind==='bundle'?'Фиксированный состав комплекта.':'Выбор исполнения в карточке товара.')).slice(0,180)};
}
