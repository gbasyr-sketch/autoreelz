import {createCatalogSnapshot,type CatalogProduct} from '../src/lib/catalog-types.ts';
import type {ContentSnapshot,Article} from '../src/lib/content.ts';
export const id=(n:number)=>`a6000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function fixtureCatalog(count=13){
 const category={id:id(1),feedId:'17',parentId:null,slug:'parts',name:'Детали',shortName:'Детали',icon:'box',attributes:['illumination'],depth:0,ancestorSlugs:[],seoTitle:'Ручной заголовок категории',metaDescription:'Проверенное описание категории'};
 const products:CatalogProduct[]=Array.from({length:count},(_,n)=>({id:id(100+n),slug:'qa-product-'+n,name:'QA Товар '+n,category:'parts',categorySlugs:['parts'],kind:'single',description:'Проверенное описание товара '+n,image:'/media/'+id(9),media:[{id:id(9),src:'/media/'+id(9),alt:'QA фотография'}],attributes:{},fitment:[],discountBps:0,isDemo:false,seoTitle:'Ручной title '+n,variants:[{id:id(1000+n),article:'QA-'+n,label:'Красная подсветка',priceRubles:'7200.50',stock:3,attributes:{illumination:'red'},image:'/media/'+id(9),media:[{id:id(9),src:'/media/'+id(9),alt:'QA фотография'}],fitment:[]}]}));
 products[0]!.variants.push({...products[0]!.variants[0]!,id:id(2000),article:'QA-WHITE',label:'Белая подсветка',priceRubles:'5300.01',stock:0,attributes:{illumination:'white'}});
 return createCatalogSnapshot({products,categories:[category],vehicles:[],attributeDefinitions:{illumination:{id:id(8),label:'Подсветка',type:'select',unit:null,filterable:true,values:[{value:'red',label:'Красная'},{value:'white',label:'Белая'}]}}});
}
export function fixtureContent():ContentSnapshot{
 const category={id:id(3),slug:'guides',name:'Инструкции'},tag={id:id(4),slug:'selection',name:'Подбор'};
 const articles:Article[]=Array.from({length:13},(_,n)=>({id:id(300+n),slug:'qa-article-'+n,title:'QA Статья '+n,excerpt:'Краткое проверенное описание '+n,body:'Содержательный тестовый материал '+n,category,tags:[tag],video:null,invalidVideo:false,coverUrl:null,seoTitle:null,metaDescription:null,isDemo:false,publishedAt:'2026-09-20T12:00:00.000Z'}));
 return{pages:[{id:id(2),slug:'about',title:'О нас',body:'Факты магазина',summary:'Описание компании',seoTitle:null,metaDescription:null,isLegal:false,isDraftText:false},{id:id(5),slug:'privacy',title:'Политика',body:'Проект документа',summary:'Черновик',seoTitle:null,metaDescription:null,isLegal:true,isDraftText:true}],articles,categories:[category],tags:[tag],slugs:[]};
}
