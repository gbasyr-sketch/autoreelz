import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProduct,emptyVariant} from '../src/lib/product-editor.ts';
import {setProductMainPhoto} from '../src/lib/product-main-photo.ts';
const photo=(id:string)=>({id,alt:id});
function fixture(){return {...emptyProduct(),photos:[photo('common'),photo('cover')],variants:[{...emptyVariant('red'),name:'Красный',mediaMode:'replace' as const,photos:[photo('red-a'),photo('red-b')]},{...emptyVariant('blue'),name:'Синий'}]};}

test('all variants: preserve inheritance, originals, captions and unrelated fields; repeat creates no duplicates',()=>{
 const data=fixture();data.variants[0]!.price='123.45';setProductMainPhoto(data,photo('cover'),'all');
 assert.deepEqual(data.photos.map(p=>p.id),['cover','common']);
 assert.deepEqual(data.variants[0]!.photos.map(p=>p.id),['cover','red-a','red-b']);
 assert.equal(data.variants[1]!.mediaMode,'inherit');assert.deepEqual(data.variants[1]!.photos,[]);
 assert.equal(data.variants[0]!.price,'123.45');const once=structuredClone(data);setProductMainPhoto(data,photo('cover'),'all');assert.deepEqual(data,once);
 data.photos[0]!.alt='Shared caption';assert.equal(data.variants[0]!.photos[0]!.alt,'cover');
});
test('one inherited variant: detach with common and dormant photos, leaving other variants and common gallery alone',()=>{
 const data=fixture(),before=structuredClone(data);data.variants[1]!.photos=[photo('dormant')];
 setProductMainPhoto(data,photo('cover'),{variantId:'blue'});
 assert.deepEqual(data.photos,before.photos);assert.deepEqual(data.variants[0],before.variants[0]);
 assert.equal(data.variants[1]!.mediaMode,'replace');assert.deepEqual(data.variants[1]!.photos.map(p=>p.id),['cover','common','dormant']);
});
test('one private variant: moves existing photo, preserves its own caption',()=>{
 const data=fixture();setProductMainPhoto(data,{id:'red-b',alt:'Other caption'},{variantId:'red'});
 assert.deepEqual(data.variants[0]!.photos,[photo('red-b'),photo('red-a')]);assert.deepEqual(data.photos,fixture().photos);
});
test('all variants capacity failure is atomic, even when preceding galleries have room',()=>{
 const data=fixture();data.variants.push({...emptyVariant('full'),name:'Полный',mediaMode:'replace',photos:Array.from({length:12},(_,i)=>photo('full-'+i))});
 const before=structuredClone(data);assert.throws(()=>setProductMainPhoto(data,photo('cover'),'all'),/Полный.*12 фото/);assert.deepEqual(data,before);
});
test('full common gallery rejects an extra cover without changing the form',()=>{
 const data=fixture();data.photos=Array.from({length:12},(_,i)=>photo('common-'+i));const before=structuredClone(data);
 assert.throws(()=>setProductMainPhoto(data,photo('new'),'all'),/Общие фотографии.*12 фото/);assert.deepEqual(data,before);
 setProductMainPhoto(data,photo('common-11'),'all');assert.equal(data.photos.length,12);assert.equal(data.photos[0]!.id,'common-11');
});
test('inherited variant capacity failure does not detach it',()=>{
 const data=fixture();data.photos=Array.from({length:12},(_,i)=>photo('common-'+i));const before=structuredClone(data);
 assert.throws(()=>setProductMainPhoto(data,photo('new'),{variantId:'blue'}),/12 фото/);assert.deepEqual(data,before);
});
test('bundles and products without variants use the common gallery',()=>{
 const data={...emptyProduct(),kind:'bundle' as const,photos:[photo('one'),photo('two')]};setProductMainPhoto(data,photo('two'),'all');
 assert.deepEqual(data.photos,[photo('two'),photo('one')]);assert.throws(()=>setProductMainPhoto(data,photo('one'),{variantId:'missing'}),/недоступен/);
});
