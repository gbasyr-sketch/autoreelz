import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {imageWidth,responsiveImage,cardImageSizes} from '../src/lib/responsive-image.ts';
import {mediaRendition} from '../src/server/media-renditions.ts';
const src='/media/a6000000-0000-4000-8000-000000000009';
test('only bounded public renditions are advertised; private and foreign sources stay unchanged',()=>{
 assert.equal(imageWidth('320'),320);
 for(const value of ['0','321','320.0','0320','-160','20000',''])assert.equal(imageWidth(value),null);
 for(const value of ['https://example.com/a.jpg','/api/manager/product-image?id=x','/images/a.svg',src+'?draft=1'])assert.deepEqual(responsiveImage(value,'100vw'),{});
 const attrs=responsiveImage(src,cardImageSizes);assert.match(attrs.srcset!,/\?w=320 320w/);assert.ok(!attrs.srcset!.includes('undefined'));
});
test('rendition keeps aspect ratio, transparency and original bytes; concurrent consumers share the result',async()=>{
 const original=await sharp({create:{width:1536,height:1024,channels:4,background:{r:200,g:0,b:0,alpha:0.5}}}).png().toBuffer(),before=Buffer.from(original);
 const [a,b]=await Promise.all([mediaRendition('qa:large:320',original,320),mediaRendition('qa:large:320',original,320)]);
 assert.equal(a,b);assert.deepEqual(original,before);const meta=await sharp(a).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,320);assert.equal(meta.height,213);assert.equal(meta.hasAlpha,true);
});
test('small originals are never upscaled and source fingerprints invalidate cached results',async()=>{
 const a=await sharp({create:{width:80,height:40,channels:3,background:'red'}}).png().toBuffer();
 const b=await sharp({create:{width:80,height:40,channels:3,background:'blue'}}).png().toBuffer();
 const red=await mediaRendition('qa:small:mtime1:320',a,320),blue=await mediaRendition('qa:small:mtime2:320',b,320);
 assert.equal((await sharp(red).metadata()).width,80);assert.notDeepEqual(red,blue);
});
test('invalid input does not poison the pending cache',async()=>{
 await assert.rejects(mediaRendition('qa:retry',Buffer.from('invalid'),160));
 const input=await sharp({create:{width:320,height:160,channels:3,background:'white'}}).png().toBuffer();
 assert.equal((await sharp(await mediaRendition('qa:retry',input,160)).metadata()).width,160);
});
test('public rich text adds only server-generated renditions while editor HTML remains unchanged',async()=>{
 const {contentHtml,safeRichHtml,previewContentHtml}=await import('../src/server/rich-content.ts');
 const body=`<p><img src="${src}" alt="Фото" width="75%" srcset="https://evil.test/leak 320w" onerror="alert(1)"></p>`;
 const html=contentHtml(body,'html');assert.match(html,/srcset="\/media\/[^\"]+\?w=160/);assert.match(html,/width="75%"/);assert.doesNotMatch(html,/evil\.test|onerror/);
 assert.doesNotMatch(safeRichHtml(body),/srcset/);assert.doesNotMatch(previewContentHtml(body),/srcset/);assert.match(previewContentHtml(body),/api\/manager\/product-image/);
});
