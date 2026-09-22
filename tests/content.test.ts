import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVideoUrl,textParagraphs,resolveContent,articlePage,type ContentSnapshot,type Article} from '../src/lib/content.ts';
const videoId='7716bd3e665725c3c008ae7ab4ff02e2';
test('Rutube public video, shorts and embed normalize to the documented HTTPS player',()=>{
 for(const path of ['video','shorts','play/embed']){const result=normalizeVideoUrl(`https://rutube.ru/${path}/${videoId}/?autoplay=true&redirect=https://example.invalid`);assert.equal(result?.embedUrl,`https://rutube.ru/play/embed/${videoId}?autoplay=false`);assert.equal(result?.watchUrl,`https://rutube.ru/video/${videoId}/`);}
});
test('VK accepts export URLs on exact provider hosts and removes unexpected parameters',()=>{
 for(const host of ['vk.com','vk.ru','vkvideo.ru']){const result=normalizeVideoUrl(`https://${host}/video_ext.php?oid=-123&id=456&hash=abcd1234&autoplay=1&redirect=https://example.invalid`);assert.equal(result?.embedUrl,`https://${host}/video_ext.php?oid=-123&id=456&hash=abcd1234&autoplay=0`);assert.equal(result?.watchUrl,`https://${host}/video-123_456`);}
});
test('video rejects executable schemes, pasted HTML, credentials, ports and lookalike hosts',()=>{
 for(const value of ['javascript:alert(1)','data:text/html,hello','file:///etc/passwd',`http://rutube.ru/video/${videoId}`,`https://rutube.ru.evil.invalid/video/${videoId}`,`https://user:pass@rutube.ru/video/${videoId}`,`https://rutube.ru:8080/video/${videoId}`,`https://rutube.ru/video/${videoId}#payload`,`<iframe src="https://rutube.ru/play/embed/${videoId}"></iframe>`,'https://127.0.0.1/video/1','https://vk.com\\@evil.invalid/video_ext.php?oid=1&id=2&hash=abcd1234'])assert.equal(normalizeVideoUrl(value),null,value);
});
test('VK requires a full player URL and unique identifiers; invalid provider paths stay closed',()=>{
 for(const value of ['https://vk.com/video-123_456','https://vk.com/video_ext.php?oid=-123&id=456','https://vk.com/video_ext.php?oid=-123&id=456&id=789&hash=abcd1234','https://vk.com/video_ext.php?oid=0&id=456&hash=abcd1234','https://vk.com/video_ext.php?oid=-123&id=%0A456&hash=abcd1234',`https://rutube.ru/api/play/options/${videoId}`])assert.equal(normalizeVideoUrl(value),null,value);
});
test('plain text paragraph conversion never treats markup as HTML or executable data',()=>{
 assert.deepEqual(textParagraphs('Первый абзац\r\nПродолжение\r\n\r\n<script>alert(1)</script>\n\n  '),['Первый абзац\nПродолжение','<script>alert(1)</script>']);
});
const snapshot=():ContentSnapshot=>({pages:[{id:'p1',slug:'new-page',title:'Page',body:'',summary:'',seoTitle:null,metaDescription:null,isLegal:false,isDraftText:false}],articles:[],categories:[{id:'c1',slug:'new-category',name:'Category'}],tags:[],slugs:[{entity_type:'page',entity_id:'p1',slug:'old-page'},{entity_type:'page',entity_id:'hidden',slug:'hidden-page'},{entity_type:'blog_category',entity_id:'c1',slug:'old-category'}]});
test('slug aliases redirect only to currently published entities of the same kind',()=>{
 const content=snapshot();assert.deepEqual(resolveContent(content,'page','old-page'),{id:'p1',slug:'new-page',redirect:true});assert.deepEqual(resolveContent(content,'page','new-page'),{id:'p1',slug:'new-page',redirect:false});assert.equal(resolveContent(content,'page','hidden-page'),null);assert.equal(resolveContent(content,'article','old-page'),null);assert.deepEqual(resolveContent(content,'blog_category','old-category'),{id:'c1',slug:'new-category',redirect:true});
});
test('article pagination has stable slices and rejects invalid or absent pages',()=>{
 const rows=Array.from({length:25},(_,i)=>({id:String(i)} as Article));assert.equal(articlePage(rows,null).items.length,12);assert.deepEqual(articlePage(rows,'3').items.map(a=>a.id),['24']);
 for(const page of ['0','-1','1.1','4','1000000','x'])assert.equal(articlePage(rows,page).error,true,page);assert.equal(articlePage([],'1').error,false);
});
