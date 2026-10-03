import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {newInfographic,normalizeInfographic,infographicFileIds} from '../src/lib/product-infographic.ts';
import {normalizeProduct} from '../src/server/product-editor.ts';
import {emptyProduct} from '../src/lib/product-editor.ts';
import {boundedImage} from '../src/server/product-background.ts';
import {infographicText} from '../src/lib/infographic-text.ts';
test('recipes persist source separately from cutout without permitting arbitrary paths',()=>{const recipe={...newInfographic('Товар'),photos:[{sourceId:randomUUID(),cutoutId:randomUUID(),scale:100,x:0,y:0}]};assert.deepEqual(normalizeInfographic(recipe),recipe);assert.deepEqual(normalizeProduct({...emptyProduct(),infographic:recipe}).infographic,recipe);assert.equal(infographicFileIds(recipe).length,2);for(const sourceId of ['https://example.org/a.png','../../secret',''])assert.throws(()=>normalizeInfographic({...recipe,photos:[{...recipe.photos[0],sourceId}]}));});
test('malformed or oversized layouts fail rather than silently clipping settings',()=>{for(const update of [{title:'а'.repeat(71)},{accent:'url(x)'},{version:2},{style:'anything'},{photos:Array(3).fill({})},{photos:[{sourceId:randomUUID(),cutoutId:'',scale:Infinity,x:0,y:0}]}])assert.throws(()=>normalizeInfographic({...newInfographic(),...update}));assert.equal(normalizeInfographic(undefined),null);assert.equal(normalizeInfographic(null),null);});
test('image response bound aborts oversized bodies, including missing Content-Length',async()=>{let cancelled=false;const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(20));},cancel(){cancelled=true;}});await assert.rejects(()=>boundedImage(new Response(body),30),/большая/);assert.equal(cancelled,true);assert.deepEqual(await boundedImage(new Response(new Uint8Array([1,2])),3),Buffer.from([1,2]));});
test('background choices survive recipe normalization and legacy recipes remain valid',()=>{for(const shape of ['panel','diagonal','arch','wave','circle','duo']){const recipe={...newInfographic('Товар'),shape};assert.equal(normalizeInfographic(recipe)?.shape,shape);}const legacy=newInfographic('Товар');assert.deepEqual(normalizeInfographic(legacy),legacy);assert.throws(()=>normalizeInfographic({...legacy,shape:'external-url'}));});
test('explicit text sizes and wide photo placement survive the editor contract without changing old recipes',()=>{
 const recipe={...newInfographic('Товар'),titleSize:96,subtitleSize:48,detailSize:36,photos:[{sourceId:randomUUID(),cutoutId:'',scale:250,x:-180,y:90}]};
 assert.deepEqual(normalizeInfographic(recipe),recipe);assert.deepEqual(normalizeProduct({...emptyProduct(),infographic:recipe}).infographic,recipe);
 for(const value of [NaN,Infinity,0,121,12.5,'50'])assert.throws(()=>normalizeInfographic({...recipe,titleSize:value}));
 assert.throws(()=>normalizeInfographic({...recipe,photos:[{...recipe.photos[0],scale:301}]}));assert.throws(()=>normalizeInfographic({...recipe,photos:[{...recipe.photos[0],x:501}]}));
 const legacy={...newInfographic('Товар'),photos:[{sourceId:randomUUID(),cutoutId:'',scale:130,x:-15,y:15}]};assert.deepEqual(normalizeInfographic(legacy),legacy);
});
test('manual font size is respected, later text moves down, and overflow is reported for export',()=>{
 const measure=(text,size)=>text.length*size*.6,base={...newInfographic('Деталь салона'),subtitle:'Подпись',detail:'Деталь'};
 const small=infographicText({...base,titleSize:40},measure),large=infographicText({...base,titleSize:110},measure);assert.equal(large.title.size,110);assert.ok(large.subtitle.y>=small.subtitle.y);assert.equal(large.overflow,false);
 const long={...base,title:'Слово '.repeat(10).trim()};assert.ok(infographicText(long,measure).title.size<64);assert.equal(infographicText({...long,titleSize:120},measure).title.size,120);assert.equal(infographicText({...long,titleSize:120},measure).overflow,true);
});
