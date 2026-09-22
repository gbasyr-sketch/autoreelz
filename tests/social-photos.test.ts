import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {processReviewPhoto,readReviewMultipart,withReviewUpload,MAX_PHOTO_BYTES,MAX_UPLOAD_BYTES} from '../src/server/social-photos.ts';
import type {ShopSession} from '../src/lib/commerce-types.ts';
const origin='http://127.0.0.1:14323';process.env.APP_ORIGIN=origin;process.env.APP_SECRET='review-photo-unit-test-only-secret-value';
const session:ShopSession={id:'00000000-0000-4000-8000-000000000001',csrfToken:'photo-test-csrf',email:'qa@example.invalid',expiresAt:new Date(Date.now()+10000).toISOString()};
const fails=(code:string)=>(error:unknown)=>{assert.equal((error as {code:string}).code,code);return true;};
const file=(data:Buffer,type='image/png',name='photo.png')=>new File([new Uint8Array(data)],name,{type});

test('review photos are resized, oriented, re-encoded as WebP and stripped of EXIF/ICC',async()=>{
 const jpeg=await sharp({create:{width:2400,height:1200,channels:3,background:'#CB181A'}}).withMetadata({orientation:6}).jpeg().toBuffer();
 const before=await sharp(jpeg).metadata();assert.ok(before.exif);
 const result=await processReviewPhoto(file(jpeg,'image/jpeg','image.jpg'));
 assert.equal(result.width,800);assert.equal(result.height,1600);assert.ok(result.data.length<=2097152);
 const after=await sharp(result.data).metadata();assert.equal(after.format,'webp');
 assert.equal(after.exif,undefined);assert.equal(after.icc,undefined);assert.equal(after.xmp,undefined);assert.equal(after.orientation,undefined);
 assert.match(result.digest,/^[a-f0-9]{64}$/);assert.notDeepEqual(result.data,jpeg);
});
test('real PNG and WebP accepted; declared MIME cannot disguise another format',async()=>{
 const png=await sharp({create:{width:20,height:20,channels:4,background:'transparent'}}).png().toBuffer();
 const webp=await sharp(png).webp().toBuffer();
 assert.equal((await processReviewPhoto(file(png))).width,20);
 assert.equal((await processReviewPhoto(file(webp,'image/webp'))).width,20);
 await assert.rejects(processReviewPhoto(file(png,'image/jpeg')),fails('PHOTO_TYPE'));
 await assert.rejects(processReviewPhoto(file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))),fails('PHOTO_TYPE'));
 await assert.rejects(processReviewPhoto(file(png,'image/svg+xml')),fails('PHOTO_TYPE'));
 await assert.rejects(processReviewPhoto(file(png.subarray(0,40))),fails('PHOTO_INVALID'));
});
test('oversized, empty, animated and excessive-resolution images are rejected',async()=>{
 await assert.rejects(processReviewPhoto(file(Buffer.alloc(0))),fails('PHOTO_SIZE'));
 await assert.rejects(processReviewPhoto(file(Buffer.alloc(MAX_PHOTO_BYTES+1))),fails('PHOTO_SIZE'));
 const huge=await sharp({create:{width:6000,height:4001,channels:3,background:'#eee'}}).png().toBuffer();
 await assert.rejects(processReviewPhoto(file(huge)),error=>['PHOTO_INVALID','PHOTO_PIXELS'].includes((error as {code:string}).code));
 const frames=Buffer.alloc(10*20*3);frames.fill(255,0,10*10*3);
 const animation=await sharp(frames,{raw:{width:10,height:20,pageHeight:10,channels:3}}).webp({loop:0,delay:[100,100]}).toBuffer();
 assert.equal((await sharp(animation,{animated:true}).metadata()).pages,2);
 await assert.rejects(processReviewPhoto(file(animation,'image/webp')),fails('PHOTO_ANIMATION'));
});
test('multipart requires same origin and CSRF before accepting bytes',async()=>{
 const form=new FormData();for(const[key,value]of Object.entries({productId:session.id,orderId:session.id,authorName:'Покупатель',body:'Достаточно длинный текст отзыва.',idempotencyKey:session.id}))form.set(key,value);
 const request=(headers:Record<string,string>)=>new Request(origin+'/api/social/reviews',{method:'POST',headers,body:form});
 await assert.rejects(readReviewMultipart(request({Origin:'https://other.invalid','X-CSRF-Token':session.csrfToken}),session),fails('ORIGIN'));
 await assert.rejects(readReviewMultipart(request({Origin:origin,'X-CSRF-Token':'wrong'}),session),fails('CSRF'));
 const accepted=await readReviewMultipart(request({Origin:origin,'X-CSRF-Token':session.csrfToken}),session);assert.equal(accepted.files.length,0);assert.equal(accepted.fields.authorName,'Покупатель');
 form.append('files',file(Buffer.from('x')));for(let i=0;i<5;i++)form.append('files',file(Buffer.from('x')));
 await assert.rejects(readReviewMultipart(request({Origin:origin,'X-CSRF-Token':session.csrfToken}),session),fails('PHOTO_COUNT'));
});
test('multipart enforces total byte limit even without a Content-Length header',async()=>{
 let cancelled=false;const chunk=new Uint8Array(1024*1024);
 const request=new Request(origin+'/api/social/reviews',{method:'POST',headers:{Origin:origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'multipart/form-data; boundary=qa'},body:new ReadableStream({pull(controller){controller.enqueue(chunk);},cancel(){cancelled=true;}}),duplex:'half'} as RequestInit);
 await assert.rejects(readReviewMultipart(request,session),fails('UPLOAD_SIZE'));assert.equal(cancelled,true);
 const declared=new Request(origin+'/api/social/reviews',{method:'POST',headers:{Origin:origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'multipart/form-data; boundary=qa','Content-Length':String(MAX_UPLOAD_BYTES+1)},body:'x'});
 await assert.rejects(readReviewMultipart(declared,session),fails('UPLOAD_SIZE'));
});
test('only two review uploads can process concurrently and slots release after failure',async()=>{
 let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
 const first=withReviewUpload(()=>barrier),second=withReviewUpload(()=>barrier);
 await assert.rejects(withReviewUpload(async()=>{}),fails('UPLOAD_BUSY'));
 release();await Promise.all([first,second]);
 await assert.rejects(withReviewUpload(async()=>{throw new Error('decode failure');}),/decode failure/);
 assert.equal(await withReviewUpload(async()=>true),true);
});
