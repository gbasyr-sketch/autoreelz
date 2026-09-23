import test from 'node:test';import assert from 'node:assert/strict';
import {isTestEnvironment} from '../src/server/config.ts';
test('simulation is permitted locally or on the explicitly selected HTTPS staging origin',()=>{
 for(const origin of ['http://127.0.0.1:14323','http://localhost:14322','http://[::1]:14323'])assert.equal(isTestEnvironment('local-test',origin),true);
 assert.equal(isTestEnvironment('staging','https://autoreelz.ru'),true);
});
test('production, non-HTTPS staging, unknown hosts and origin tricks never enable simulations',()=>{
 for(const [mode,origin]of [['production','https://autoreelz.ru'],['local-test','https://autoreelz.ru'],['staging','http://autoreelz.ru'],['staging','https://autoreelz.ru.evil.test'],['staging','https://user:pass@autoreelz.ru'],['staging','https://autoreelz.ru:444'],['staging','https://autoreelz.ru/path'],['staging','https://autoreelz.ru?x=1'],['staging','not-a-url'],['staging','http://127.0.0.1:14323']])assert.equal(isTestEnvironment(mode!,origin!),false,mode+' '+origin);
});
