import {testOrderTerms} from '../src/lib/checkout-confirmations.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import sharp from 'sharp';
import type {ShopSession} from '../src/lib/commerce-types.ts';
import {qaDatabase} from './helpers/qa-db.mjs';

test('social functions use only an isolated PostgreSQL clone',{skip:process.env.AR_SOCIAL_TESTS!=='1',timeout:120000},async t=>{
 const qa=await qaDatabase('social');const report={database:qa.database,checks:[] as {name:string;passed:boolean;error?:string}[],cleanup:false,passed:false};
 const db=await import('../src/server/db.ts'),security=await import('../src/server/security.ts'),social=await import('../src/server/social.ts');
 const cart=await import('../src/server/cart.ts'),orders=await import('../src/server/orders.ts'),payments=await import('../src/server/payments.ts');
 const {processReviewPhoto}=await import('../src/server/social-photos.ts');
 const query=qa.query;
 const check=async(name:string,fn:()=>Promise<void>)=>t.test(name,async()=>{try{await fn();report.checks.push({name,passed:true});}catch(error){report.checks.push({name,passed:false,error:error instanceof Error?error.message:String(error)});throw error;}});
 const rejects=(code:string)=>(error:unknown)=>{assert.equal((error as {code:string}).code,code);return true;};
 const productId=randomUUID(),skuId=randomUUID(),otherProductId=randomUUID(),otherSkuId=randomUUID(),actor={id:randomUUID()};
 async function session(email?:string){const values=new Map<string,string>();const context={cookies:{get:(key:string)=>values.has(key)?{value:values.get(key)}:undefined,set:(key:string,value:string)=>values.set(key,value),delete:(key:string)=>values.delete(key)}};let session=await security.getSession(context as never);if(email){const owner=(await query('INSERT INTO ar_customers(email) VALUES($1) ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id',[email])).rows[0];await query('UPDATE ar_web_sessions SET customer_id=$2 WHERE id=$1',[session.id,owner.id]);session=await security.getSession(context as never);}return session;}
 const change=(s:ShopSession,action:string,ids:string[],key=randomUUID())=>social.changeFavorites(s,{action,...(action==='merge'?{productIds:ids}:{productId:ids[0]}),idempotencyKey:key});
 async function orderFor(s:ShopSession,p=productId,sku:string|null=skuId){await cart.changeCart(s,{productId:p,skuId:sku,quantity:1,mode:'add',cartVersion:(await cart.getCart(s)).version,idempotencyKey:randomUUID()});const preview=await cart.createQuote(s,{cartVersion:(await cart.getCart(s)).version,customer:{name:'QA покупатель',phone:'+79990000000',email:s.email!},delivery:{method:'pickup_point',city:'QA Москва',address:'QA ПВЗ 1'}});const result=await orders.checkout(s,{confirmation:{accepted:true,version:testOrderTerms.version},quoteId:preview.id,cartVersion:preview.cartVersion,idempotencyKey:randomUUID()});return orders.quoteShipping(actor,{orderId:result.orderIds[0],costRubles:'0.00',note:'QA ручной расчёт',idempotencyKey:randomUUID()});}
 async function payAndDeliver(s:ShopSession,order:Awaited<ReturnType<typeof orderFor>>){await payments.payOrder(s,{orderId:order.id,shippingVersion:order.shippingVersion,method:'card',idempotencyKey:randomUUID()});await query("UPDATE ar_orders SET delivery_status='delivered',delivered_at=now() WHERE id=$1",[order.id]);}
 try{
  for(const [p,sku]of [[productId,skuId],[otherProductId,otherSkuId]]){await query("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo) VALUES($1,'QA социальный товар',$2,'00000000-0000-4000-8000-000000000001','published',true)",[p,`qa-social-${p}`]);await query("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA исполнение',12.34,'published')",[sku,p,`QA-SOCIAL-${sku}`]);await query('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,20,0)',[sku]);}
  const guest=await session(),a=await session('qa-social-a@example.invalid'),a2=await session(a.email!),b=await session('qa-social-b@example.invalid');
  await check('guest writes denied and favorites isolated by confirmed customer',async()=>{await assert.rejects(change(guest,'add',[productId]),rejects('AUTH_REQUIRED'));await change(a,'add',[productId]);assert.deepEqual((await social.getFavorites(a2)).productIds,[productId]);assert.deepEqual((await social.getFavorites(b)).productIds,[]);assert.deepEqual(await social.getFavorites(guest),{authenticated:false,productIds:[]});});
  await check('concurrent merges preserve union and replay cannot resurrect a removed favorite',async()=>{
   const key=randomUUID();await Promise.all([change(a,'merge',[productId,otherProductId],key),change(a2,'add',[otherProductId])]);
   assert.deepEqual(new Set((await social.getFavorites(a)).productIds),new Set([productId,otherProductId]));
   await change(a2,'remove',[productId]);assert.deepEqual((await change(a,'merge',[productId,otherProductId],key)).productIds,[otherProductId]);
   await assert.rejects(change(a,'merge',[productId],key),rejects('KEY_REUSED'));
   await assert.rejects(change(a,'merge',Array.from({length:501},()=>randomUUID())),rejects('FAVORITE_LIMIT'));
  });
  await check('the 500-favorite limit applies to the stored union across devices',async()=>{
   const ids=Array.from({length:499},()=>randomUUID());
   await query("INSERT INTO ar_products(id,name,slug,category_id,status) SELECT id,'QA лимит избранного','qa-favorite-'||id,'00000000-0000-4000-8000-000000000001','published' FROM unnest($1::uuid[]) AS ids(id)",[ids]);
   await change(a,'merge',ids);assert.equal((await social.getFavorites(a2)).productIds.length,500);
   await assert.rejects(change(a2,'add',[productId]),rejects('FAVORITE_LIMIT'));
   assert.equal((await social.getFavorites(a)).productIds.length,500);
  });
  const order=await orderFor(a);
  const review={productId,orderId:order.id,authorName:'QA покупатель',body:'Проверочный отзыв о полученном товаре. Реального опыта установки здесь нет.',idempotencyKey:randomUUID()};
  await check('review requires verified email, the exact purchaser and paid delivered status',async()=>{
   await assert.rejects(social.createReview(guest,review,[]),rejects('AUTH_REQUIRED'));
   await assert.rejects(social.createReview(a,review,[]),rejects('REVIEW_PURCHASE'));
   await payments.payOrder(a,{orderId:order.id,shippingVersion:order.shippingVersion,method:'card',idempotencyKey:randomUUID()});
   await assert.rejects(social.createReview(a,review,[]),rejects('REVIEW_PURCHASE'));
   await query("UPDATE ar_orders SET delivery_status='delivered' WHERE id=$1",[order.id]);
   await assert.rejects(social.createReview(a,review,[]),rejects('REVIEW_PURCHASE'));
   await query('UPDATE ar_orders SET delivered_at=now() WHERE id=$1',[order.id]);
   await assert.rejects(social.createReview(b,review,[]),rejects('REVIEW_PURCHASE'));
   assert.equal((await social.getReviews(a,productId)).canReview,true);assert.equal((await social.getReviews(b,productId)).canReview,false);
  });
  const source=await sharp({create:{width:32,height:20,channels:3,background:'#CB181A'}}).png().toBuffer();
  const photo=await processReviewPhoto(new File([new Uint8Array(source)],'qa.png',{type:'image/png'}));
  let reviewId='',mediaId='';
  await check('review creates one pending record; retry and file digest protect idempotency',async()=>{
   const created=await social.createReview(a,review,[photo]);reviewId=created.id;assert.equal(created.status,'pending');assert.deepEqual(created.media,[]);
   assert.equal((await social.createReview(a2,review,[photo])).id,reviewId);
   await assert.rejects(social.createReview(a,{...review,idempotencyKey:randomUUID()},[]),rejects('REVIEW_EXISTS'));
   await assert.rejects(social.createReview(a,review,[{...photo,digest:'different'}]),rejects('KEY_REUSED'));
   assert.equal((await query('SELECT id FROM ar_reviews WHERE customer_id=(SELECT customer_id FROM ar_web_sessions WHERE id=$1) AND product_id=$2',[a.id,productId])).rowCount,1);
   const media=(await query('SELECT id FROM ar_review_media WHERE review_id=$1',[reviewId])).rows;assert.equal(media.length,1);mediaId=media[0].id;
   assert.equal((await social.getReviews(a,productId)).canReview,false);assert.equal((await social.getReviews(guest,productId)).reviews.length,0);
  });
  await check('pending/rejected photos stay private; moderation publishes only with a visible product',async()=>{
   await assert.rejects(social.getReviewPhoto(mediaId),rejects('NOT_FOUND'));assert.deepEqual((await social.getReviewPhoto(mediaId,true)).data,photo.data);
   await social.moderateReview(actor,{reviewId,status:'rejected',note:'QA причина для автора',idempotencyKey:randomUUID()});
   assert.equal((await social.getReviews(a,productId)).reviews[0]!.moderationNote,'QA причина для автора');assert.equal((await social.getReviews(b,productId)).reviews.length,0);
   await assert.rejects(social.getReviewPhoto(mediaId),rejects('NOT_FOUND'));
   const input={reviewId,status:'approved',note:'QA приватная заметка',idempotencyKey:randomUUID()};await social.moderateReview(actor,input);await social.moderateReview(actor,input);
   const publicView=(await social.getReviews(guest,productId)).reviews[0]!;assert.equal(publicView.status,'approved');assert.equal(publicView.moderationNote,undefined);assert.equal(publicView.media[0]!.url,`/review-media/${mediaId}`);assert.equal(JSON.stringify(publicView).includes('image_data'),false);
   assert.equal((await sharp((await social.getReviewPhoto(mediaId)).data).metadata()).format,'webp');
   await query("UPDATE ar_products SET status='draft' WHERE id=$1",[productId]);await assert.rejects(social.getReviewPhoto(mediaId),rejects('NOT_FOUND'));await assert.rejects(social.getReviews(guest,productId),rejects('PRODUCT_UNAVAILABLE'));await query("UPDATE ar_products SET status='published' WHERE id=$1",[productId]);
   await query("UPDATE ar_categories SET status='draft' WHERE id='00000000-0000-4000-8000-000000000001'");await assert.rejects(social.getReviewPhoto(mediaId),rejects('NOT_FOUND'));await query("UPDATE ar_categories SET status='published' WHERE id='00000000-0000-4000-8000-000000000001'");
  });
  await check('a bundle purchase does not authorize a review of its individual component',async()=>{
   const bundleId=randomUUID();await query("INSERT INTO ar_products(id,name,slug,category_id,kind,status) VALUES($1,'QA комплект',$2,'00000000-0000-4000-8000-000000000001','bundle','published')",[bundleId,`qa-social-${bundleId}`]);await query('INSERT INTO ar_bundle_components(bundle_id,sku_id,quantity) VALUES($1,$2,1)',[bundleId,otherSkuId]);
   const order=await orderFor(b,bundleId,null);await payAndDeliver(b,order);
   await assert.rejects(social.createReview(b,{...review,productId:otherProductId,orderId:order.id,idempotencyKey:randomUUID()},[]),rejects('REVIEW_PURCHASE'));
   const result=await social.createReview(b,{...review,productId:bundleId,orderId:order.id,idempotencyKey:randomUUID()},[]);assert.equal(result.status,'pending');
  });
  await check('empty review validation, persistent upload limit and revoked session',async()=>{
   await assert.rejects(social.createReview(b,{...review,body:'   '},[]),rejects('REVIEW_BODY'));
   for(let i=0;i<10;i++)await social.authorizeReviewUpload(b);await assert.rejects(social.authorizeReviewUpload(b),rejects('RATE_LIMIT'));
   await query('UPDATE ar_web_sessions SET expires_at=now() WHERE id=$1',[b.id]);await assert.rejects(social.getFavorites(b),rejects('SESSION_CHANGED'));await assert.rejects(change(b,'add',[productId]),rejects('SESSION_CHANGED'));
  });
  report.passed=report.checks.length>0&&report.checks.every(check=>check.passed);
 }finally{await db.getPool().end();await qa.close();report.cleanup=true;mkdirSync('artifacts/stage-5',{recursive:true});writeFileSync('artifacts/stage-5/social-check.json',JSON.stringify(report,null,2)+'\n');}
});
