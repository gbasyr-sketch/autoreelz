import test from 'node:test';
import assert from 'node:assert/strict';
import {demoProductReviews,homeSelection} from '../src/lib/home.ts';
import {articleBlocks,textLinks,type ContentSnapshot} from '../src/lib/content.ts';
import type {CatalogSnapshot,CatalogProduct} from '../src/lib/catalog-types.ts';
const content={pages:[],articles:[],categories:[],tags:[],slugs:[]} as ContentSnapshot;
const product=(slug:string,category:string,isDemo=false)=>({slug,category,isDemo,name:slug} as CatalogProduct);
const catalog=(products:CatalogProduct[])=>({products,categories:[],offerFor:(p:CatalogProduct)=>p.slug==='unavailable'?null:{priceRubles:'1800.00',available:1}} as CatalogSnapshot);
test('fictional reviews remain linked to available public products and never appear in production',()=>{
 const c=catalog([product('demo','heaters',true),product('unavailable','heaters'),product('heater','heaters'),product('console','consoles')]);
 assert.deepEqual(demoProductReviews(c,'production'),[]);
 const reviews=demoProductReviews(c,'staging');assert.deepEqual(reviews.map(r=>r.productSlug),['heater','console']);assert.ok(reviews.every(r=>r.isDemo&&!r.createdAt));assert.deepEqual(demoProductReviews(catalog([]),'staging'),[]);
});
test('home selection favors real products and handles an empty catalog',()=>{
 const c=catalog([product('demo','heaters',true),product('one','heaters'),product('two','heaters'),product('three','consoles')]);
 assert.deepEqual(homeSelection(c,content).featured.map(i=>i.product.slug),['one','three','two']);assert.equal(homeSelection(catalog([]),content).heroItem,undefined);
});
test('article formatting keeps HTML inert, distinguishes headings and only links HTTPS without credentials',()=>{
 assert.deepEqual(articleBlocks('## Heading\n\n<script>bad</script>'),[{heading:true,text:'Heading'},{heading:false,text:'<script>bad</script>'}]);
 assert.deepEqual(textLinks('Source https://auto.ru/path/.'),[{text:'Source '},{text:'Auto.ru',href:'https://auto.ru/path/'},{text:'.'}]);
 assert.ok(textLinks('javascript:alert(1) https://user:pass@example.com/').every(p=>!p.href));
});
