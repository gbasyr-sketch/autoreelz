// Read-only proof that the native CMS button points to the correct owner workflow.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {env,base} from '../scripts/cms-client.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),report={checkedAt:new Date().toISOString(),passed:false};
try{
 await page.goto(base+'/admin/login',{waitUntil:'networkidle'});await page.locator('input[type=email]').fill(env.ADMIN_EMAIL);await page.locator('input[type=password]').fill(env.ADMIN_PASSWORD);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('/login'));await page.waitForLoadState('networkidle');
 for(const name of ['Пропустить','Remind Later']){const b=page.getByRole('button',{name,exact:true});if(await b.isVisible())await b.click();}
 const product='00000000-0000-4000-8000-000000000100';await page.goto(base+'/admin/content/ar_products/'+product,{waitUntil:'networkidle'});
 const link=page.locator('[data-field="description_tools"]').getByRole('link',{name:'Сгенерировать описание'});await link.waitFor();const href=await link.getAttribute('href');assert.equal(href,`http://127.0.0.1:14323/manager/content?product=${product}`);report.generatorLinkVerified=true;
 mkdirSync('artifacts/stage-5',{recursive:true});await page.screenshot({path:'artifacts/stage-5/cms-generator-button.png',fullPage:true});report.passed=true;
}finally{await browser.close();writeFileSync('artifacts/stage-5/cms-owner-links.json',JSON.stringify(report,null,2)+'\n');console.log(report);}
