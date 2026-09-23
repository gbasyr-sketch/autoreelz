import test from 'node:test';import assert from 'node:assert/strict';
import {releaseInfo} from '../src/server/release.ts';
test('health revision exposes only a complete Git SHA, never arbitrary environment content',()=>{
 const previous=process.env.APP_REVISION;
 try{for(const value of ['','development','secret-value','a'.repeat(39),'<script>']){process.env.APP_REVISION=value;assert.equal(releaseInfo().revision,'development');}process.env.APP_REVISION='a'.repeat(40);assert.deepEqual(releaseInfo(),{revision:'a'.repeat(40)});}
 finally{if(previous===undefined)delete process.env.APP_REVISION;else process.env.APP_REVISION=previous;}
});
