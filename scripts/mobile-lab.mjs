// Dependencies intentionally installed only in ignored tmp/stage-6-tools.
// PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH" npm install --prefix tmp/stage-6-tools --save-exact lighthouse@13.5.0
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import lighthouse from '../tmp/stage-6-tools/node_modules/lighthouse/core/index.js';
import {launch} from '../tmp/stage-6-tools/node_modules/chrome-launcher/dist/index.js';
const base=process.env.AR_MOBILE_BASE||'http://127.0.0.1:14323';
assert.equal(new URL(base).hostname,'127.0.0.1');assert.ok(['14323','14325'].includes(new URL(base).port));
const runs=Number(process.env.AR_LAB_RUNS||3);assert.ok(Number.isInteger(runs)&&runs>0&&runs<=5);
const name=process.env.AR_LAB_LABEL||'final';assert.match(name,/^[a-z0-9-]+$/);
const paths=process.env.AR_LAB_CATALOG_ONLY?['/catalog']:process.env.AR_LAB_HOME_ONLY?['/']:['/','/catalog','/product/heater-control?sku=00000000-0000-4000-8000-000000001001'];
const report={timestamp:new Date().toISOString(),baselineCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),label:name,base,runs,lighthouse:JSON.parse(readFileSync('tmp/stage-6-tools/node_modules/lighthouse/package.json')).version,platform:os.platform()+' '+os.arch()+' '+os.release(),cpu:os.cpus()[0].model,settings:{formFactor:'mobile',throttlingMethod:'simulate',throttling:{rttMs:150,throughputKbps:1638.4,cpuSlowdownMultiplier:4},screenEmulation:{mobile:true,width:375,height:812,deviceScaleFactor:2,disabled:false},disableStorageReset:false,onlyCategories:['performance','accessibility','best-practices']},cache:'Fresh Chrome process/profile for every run; storage reset; cold browser cache; server/DB may be warm.',limitations:['localhost lab, not real-user measurements','TBT is a lab metric, not field INP','No public CDN/TLS/network route or production content load','CPU slowdown relative to this host; not physical-device calibration'],pages:[]};
try{report.runningWebImage=execFileSync('docker',['inspect','autoreelz2026-new-web-1','--format','{{.Image}}'],{encoding:'utf8'}).trim();}catch{report.runningWebImage='unavailable';}
mkdirSync('artifacts/stage-6',{recursive:true});mkdirSync('tmp/stage-6-lighthouse',{recursive:true});
const metricIds=['first-contentful-paint','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','speed-index'];
for(const path of paths){const page={path,runs:[]};report.pages.push(page);
 for(let i=1;i<=runs;i++){
  const chrome=await launch({chromePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromeFlags:['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check']});
  try{
   const result=await lighthouse(base+path,{port:chrome.port,logLevel:'error',output:'json',...report.settings});
   assert.ok(result&&!result.lhr.runtimeError,JSON.stringify(result?.lhr.runtimeError));const lhr=result.lhr;
   // Full diagnostics remain ignored: they may contain page/request metadata.
   writeFileSync(`tmp/stage-6-lighthouse/${name}-${report.pages.length}-${i}.json`,JSON.stringify(lhr));
   const run={run:i,browser:lhr.environment.hostUserAgent,networkUserAgent:lhr.environment.networkUserAgent,actualThrottling:lhr.configSettings.throttling,actualViewport:lhr.configSettings.screenEmulation,benchmarkIndex:lhr.environment.benchmarkIndex,metrics:Object.fromEntries(metricIds.map(id=>[id,lhr.audits[id].numericValue])),scores:Object.fromEntries(Object.entries(lhr.categories).map(([key,value])=>[key,value.score])),transfer:lhr.audits['total-byte-weight']?.numericValue,warnings:lhr.runWarnings,failedAudits:Object.values(lhr.audits).filter(a=>a.score!==null&&a.score<1).map(a=>({id:a.id,title:a.title,score:a.score,display:a.displayValue})),resources:lhr.audits['resource-summary']?.details?.items};
   page.runs.push(run);console.log(JSON.stringify({path,run:i,metrics:run.metrics,scores:run.scores}));
  }finally{await chrome.kill();}
 }
 const median=values=>{const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};page.median={metrics:Object.fromEntries(metricIds.map(id=>[id,median(page.runs.map(r=>r.metrics[id]))])),scores:Object.fromEntries(Object.keys(page.runs[0].scores).map(id=>[id,median(page.runs.map(r=>r.scores[id]))]))};
 writeFileSync(`artifacts/stage-6/mobile-lab-${name}.json`,JSON.stringify(report,null,2));
}
