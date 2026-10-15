import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionNetwork,SessionCreationLimitError} from '../src/server/session-rate-limit.ts';
import {failure} from '../src/server/http.ts';
test('session quota normalizes mapped IPv4 and rotating IPv6 /64 addresses',()=>{
 assert.equal(sessionNetwork('192.0.2.1'),sessionNetwork('::ffff:192.0.2.1'));
 assert.equal(sessionNetwork('::ffff:c000:201'),'192.0.2.1');
 assert.equal(sessionNetwork('2001:db8:1:2::1'),sessionNetwork('2001:0db8:0001:0002:abcd::ffff'));
 assert.notEqual(sessionNetwork('2001:db8:1:2::1'),sessionNetwork('2001:db8:1:3::1'));
 for(const bad of ['', 'unknown','192.0.2.1, 192.0.2.2','x-forwarded-for','fe80::1%lo0'])assert.equal(sessionNetwork(bad),'unknown');
});
test('session quota API failure is retryable and not cached',async()=>{
 const response=failure(new SessionCreationLimitError(42));
 assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'42');
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal((await response.json()).error.code,'SESSION_RATE_LIMIT');
});
