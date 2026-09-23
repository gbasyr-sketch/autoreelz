// Anonymous public-route test of the owner-provided Pano2VR export. No shop credentials.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base='https://autoreelz.ru',report={startedAt:new Date().toISOString(),url:base+'/muzey/',anonymous:true,checks:[],errors:[],missingAssets:[],passed:false};let browser;
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);};
mkdirSync('artifacts/muzey',{recursive:true});
try{
 await check('museum is public with trailing-slash redirect; shop and manager keep their password gate',async()=>{for(const [path,status]of [['/muzey',301],['/muzey/',200],['/',401],['/manager',401],['/muzey/.DS_Store',404]]){const r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,status,path);if(path==='/muzey')assert.equal(r.headers.get('location'),'/muzey/');await r.body?.cancel();}});
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU'}),page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base+'/muzey/')&&r.status()>=400)report.missingAssets.push({url:r.url(),status:r.status()});});
 await check('panorama player, configuration and image tiles load without authentication',async()=>{
  await page.goto(base+'/muzey/',{waitUntil:'networkidle',timeout:60000});
  await page.waitForFunction(()=>window.pano&&typeof window.pano.getNodeIds==='function'&&window.pano.getNodeIds().length===9,{timeout:30000});
  await page.waitForFunction(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/muzey/tiles/')).length>=6);
  assert.match(await page.title(),/Музей Верховного Суда РД/);report.nodeIds=await page.evaluate(()=>window.pano.getNodeIds());report.initialNode=await page.evaluate(()=>window.pano.getCurrentNode());assert.equal(report.initialNode,'node2');
  assert.ok(await page.locator('canvas').count());await page.screenshot({path:'artifacts/muzey/desktop.png',fullPage:true});
 });
 await check('another museum scene opens and the viewer adapts to mobile width',async()=>{
  await page.evaluate(()=>window.pano.openNext('{node1}',''));await page.waitForFunction(()=>window.pano.getCurrentNode()==='node1');await page.waitForLoadState('networkidle');
  await page.setViewportSize({width:375,height:812});await page.waitForFunction(()=>document.querySelector('#container').clientWidth===375);await page.waitForLoadState('networkidle');await page.screenshot({path:'artifacts/muzey/mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 });
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missingAssets,[]);report.passed=true;
}finally{await browser?.close();report.finishedAt=new Date().toISOString();writeFileSync('artifacts/muzey/browser-check.json',JSON.stringify(report,null,2)+'\n');}
