import test from 'node:test';import assert from 'node:assert/strict';
import {productVideo} from '../src/lib/product-video.ts';
import {emptyProduct,publicationIssues} from '../src/lib/product-editor.ts';
import {normalizeProduct} from '../src/server/product-editor.ts';
const id='3ec4422ba87176934bc52c201e113d0d';
test('RUTUBE user link, embed and shorts normalize without tracking or autoplay',()=>{
 for(const route of ['video','shorts','play/embed']){const v=productVideo(`https://rutube.ru/${route}/${id}/?r=wd&autoplay=true`)!;assert.equal(v.sourceUrl,`https://rutube.ru/video/${id}/`);assert.equal(v.embedUrl,`https://rutube.ru/play/embed/${id}?autoplay=false`);}
});
test('VK direct and export links normalize identifiers, preserve export hash and disable autoplay',()=>{
 for(const host of ['vk.com','m.vk.com','vk.ru','vkvideo.ru'])assert.equal(productVideo(`https://${host}/video-123_456?ref=share`)?.embedUrl,'https://vkvideo.ru/video_ext.php?oid=-123&id=456&autoplay=0');
 const v=productVideo('https://vk.com/video_ext.php?oid=-123&id=456&hash=abcd1234&autoplay=1&redirect=https://example.invalid')!;
 assert.equal(v.sourceUrl,'https://vkvideo.ru/video_ext.php?oid=-123&id=456&hash=abcd1234&autoplay=0');assert.equal(v.watchUrl,'https://vkvideo.ru/video-123_456');
});
test('arbitrary URLs, malformed identifiers, HTML and unsupported private links never produce a frame',()=>{
 for(const url of [`http://rutube.ru/video/${id}`,`https://rutube.ru.evil.test/video/${id}`,`https://user:pass@rutube.ru/video/${id}`,`https://rutube.ru:8443/video/${id}`,`https://rutube.ru/video/${id}#x`,`https://rutube.ru/video/${id}?p=private`,`<iframe src="https://rutube.ru/play/embed/${id}"></iframe>`,'javascript:alert(1)','https://127.0.0.1/video/1','https://vk.com\\@evil.test/video-1_2','https://vk.com/video_ext.php?oid=-1&id=2&id=3','https://vk.com/video_ext.php?oid=0&id=2','https://vkvideo.ru/video-1_0','https://vkvideo.ru/video-1_2/extra','https://vkvideo.ru/playlist/1','https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=bad','https://vkvideo.ru/video_ext.php?oid=%0A-1&id=2'])assert.equal(productVideo(url),null,url);
});
test('old client payloads keep the video field absent; malformed draft is retained but cannot publish',()=>{
 const d=emptyProduct();delete d.videoUrl;assert.equal(Object.hasOwn(normalizeProduct(d),'videoUrl'),false);
 d.videoUrl='https://example.invalid/video';assert.equal(normalizeProduct(d).videoUrl,d.videoUrl);assert.ok(publicationIssues(d).some(i=>i.path==='videoUrl'));
 d.videoUrl='';assert.equal(publicationIssues(d).some(i=>i.path==='videoUrl'),false);
 assert.throws(()=>normalizeProduct({...d,videoUrl:'x'.repeat(2049)}));
});
