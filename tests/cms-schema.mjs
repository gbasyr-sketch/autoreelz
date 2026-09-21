// Integration checks run only in an ephemeral clone of the new store database.
// No CMS requests or writes to the live local catalog are made by this script.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {env, root} from '../scripts/cms-client.mjs';

const source = 'autoreelz2026_new';
const project = 'autoreelz2026-new';
assert.equal(env.POSTGRES_DB, source);
assert.equal(env.COMPOSE_PROJECT_NAME, project);
const database = `ar_qa_${process.pid}_${Date.now()}`;
assert.match(database, /^ar_qa_\d+_\d+$/);
const compose = ['compose', '-p', project, 'exec', '-T', 'db'];
const report = {database, source, startedAt: new Date().toISOString(), checks: [], cleanup: false};
let created = false;
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const qaId = number => `f1000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const psqlArgs = db => [...compose, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'ar_migrator', '-d', db];
function command(args, input) {
  const result = spawnSync('docker', args, {cwd: root, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000});
  if (result.error) throw result.error;
  return result;
}
function sql(statement, db = database) {
  assert.ok(db === database || db === source, 'Unexpected database');
  const result = command(psqlArgs(db), statement);
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'psql failed');
  return result.stdout.trim();
}
async function check(name, fn) {
  try {
    await fn();
    report.checks.push({name, passed: true});
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({name, passed: false, error: error.message});
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
const rejected = (name, statement, reason) => check(name, () => {
  const result = command(psqlArgs(database), `BEGIN;\n${statement}\nROLLBACK;`);
  assert.notEqual(result.status, 0, 'Invalid write unexpectedly succeeded');
  assert.match(result.stderr, reason);
});
const equal = (name, statement, expected) => check(name, () => {
  assert.equal(sql(`BEGIN;\n${statement}\nROLLBACK;`), String(expected));
});
const skuInsert = (productId, skuId = qaId(101)) => `INSERT INTO ar_skus(id,product_id,article,name,price_rubles) VALUES(${q(skuId)},${q(productId)},'QA-SKU','QA SKU',1.00);`;
const productInsert = (productId, slug, kind = 'single') => `INSERT INTO ar_products(id,name,slug,category_id,kind) VALUES(${q(productId)},'QA product',${q(slug)},${q(id(1))},${q(kind)});`;

// Keep an interactive transaction open until the competing connection is
// observed waiting on its lock. No timing-only assumption determines the race.
async function race(name, firstStatement, secondStatement, expectedError, verify, allowEarlyRejection = false) {
  await check(name, async () => {
    const first = spawn('docker', psqlArgs(database), {cwd: root, stdio: ['pipe', 'pipe', 'pipe']});
    let firstOut = '', firstErr = '';
    first.stdout.on('data', data => { firstOut += data; });
    first.stderr.on('data', data => { firstErr += data; });
    const firstExit = new Promise(resolve => first.on('close', code => resolve(code)));
    let second;
    try {
      first.stdin.write(`BEGIN;\n${firstStatement}\n\\echo QA_LOCKED\n`);
      const waitUntil = async predicate => {
        const deadline = Date.now() + 10000;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error('Timed out waiting for the concurrency barrier');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      await waitUntil(() => firstOut.includes('QA_LOCKED') || firstErr.includes('ERROR'));
      assert.equal(firstErr, '');
      const application = `${database}_race`;
      second = spawn('docker', psqlArgs(database), {cwd: root, stdio: ['pipe', 'pipe', 'pipe']});
      let secondErr = '';
      second.stderr.on('data', data => { secondErr += data; });
      second.stdout.resume();
      let secondCode;
      const secondExit = new Promise(resolve => second.on('close', code => {secondCode = code; resolve(code);}));
      second.stdin.end(`SET application_name=${q(application)};\n${secondStatement}\n`);
      await waitUntil(() => secondCode !== undefined || sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=${q(database)} AND application_name=${q(application)} AND wait_event_type='Lock');`) === 't');
      if (!allowEarlyRejection) assert.equal(secondCode, undefined, 'Competing writer did not wait for the parent row lock');
      first.stdin.end('COMMIT;\n');
      assert.equal(await firstExit, 0, firstErr);
      assert.notEqual(await secondExit, 0, 'Competing write unexpectedly succeeded');
      assert.match(secondErr, expectedError);
      assert.equal(sql(verify), 't');
    } finally {
      if (!first.stdin.destroyed && !first.stdin.writableEnded) first.stdin.end('ROLLBACK;\n');
      first.kill();
      second?.kill();
    }
  });
}

try {
  // Dump remains in memory and is never logged or written to disk. This clone
  // preserves both the real constraints and representative demo fixtures.
  const dump = command([...compose, 'pg_dump', '-U', 'ar_migrator', '-d', source, '--no-password'], undefined);
  if (dump.status !== 0) throw new Error('Could not snapshot the new store database');
  sql(`CREATE DATABASE ${database};`, source);
  created = true;
  const restore = command(psqlArgs(database), dump.stdout);
  if (restore.status !== 0) throw new Error('Could not restore the isolated QA database');
  // The fixture assertions deliberately fail if the expected new-store seed is
  // absent, instead of silently testing a different dataset.
  await equal('seed: four marked demo products and seven SKUs', `SELECT (SELECT count(*) FROM ar_products WHERE is_demo)=4 AND (SELECT count(*) FROM ar_skus)=7;`, 't');
  await equal('money: price is a ruble decimal with two fractional digits', `SELECT data_type||':'||numeric_precision||':'||numeric_scale FROM information_schema.columns WHERE table_schema='public' AND table_name='ar_skus' AND column_name='price_rubles';`, 'numeric:16:2');
  await equal('money: one kopeck is stored as 0.01 ruble without scaling', `UPDATE ar_skus SET price_rubles=0.01 WHERE id=${q(id(1001))}; SELECT price_rubles FROM ar_skus WHERE id=${q(id(1001))};`, '0.01');
  await equal('money: 7200.50 rubles survives storage and the effective SKU projection', `UPDATE ar_skus SET price_rubles=7200.50 WHERE id=${q(id(1001))}; SELECT price_rubles=7200.50 AND ar_effective_sku(id)->>'price_rubles'='7200.50' FROM ar_skus WHERE id=${q(id(1001))};`, 't');
  await rejected('money: negative price remains forbidden', `UPDATE ar_skus SET price_rubles=-0.01 WHERE id=${q(id(1001))};`, /check constraint/);
  await rejected('money: price beyond the supported range remains forbidden', `UPDATE ar_skus SET price_rubles=90071992547409.92 WHERE id=${q(id(1001))};`, /check constraint/);
  await rejected('categories: maximum three levels', `INSERT INTO ar_categories(name,slug,parent_id) VALUES('QA','qa-level-four',${q(id(1))});`, /три уровня/);
  await rejected('categories: descendant cannot be parent', `UPDATE ar_categories SET parent_id=${q(id(1))} WHERE id=${q(id(20))};`, /Цикл/);
  await rejected('categories: self-parent forbidden', `UPDATE ar_categories SET parent_id=id WHERE id=${q(id(20))};`, /своим родителем/);
  await rejected('categories: moving a subtree preserves depth', `UPDATE ar_categories SET parent_id=${q(id(5))} WHERE id=${q(id(20))};`, /три уровня/);
  await rejected('SKU: article unique ignoring case', `INSERT INTO ar_skus(product_id,article,name,price_rubles) VALUES(${q(id(100))},'demo-heater-r','QA',1.00);`, /ar_skus_article_unique/);
  await rejected('SKU: a bundle cannot own physical stock', skuInsert(id(106)), /только отдельному товару/);
  await rejected('SKU: owning product immutable', `UPDATE ar_skus SET product_id=${q(id(101))} WHERE id=${q(id(1001))};`, /фиксируется при создании/);
  await rejected('product: cannot turn a product with SKUs into a bundle', `UPDATE ar_products SET kind='bundle' WHERE id=${q(id(100))};`, /с SKU/);
  await rejected('bundle: cannot turn a composed bundle into a single product', `UPDATE ar_products SET kind='single',discount_percent=0 WHERE id=${q(id(106))};`, /с составом/);
  await rejected('bundle: components only belong to bundles', `INSERT INTO ar_bundle_components(bundle_id,sku_id,quantity) VALUES(${q(id(100))},${q(id(1001))},1);`, /только комплекту/);
  await rejected('bundle: positive component quantity required', `UPDATE ar_bundle_components SET quantity=0 WHERE id=${q(id(600))};`, /check constraint/);
  await rejected('attributes: exactly one value', `UPDATE ar_product_attributes SET text_value='QA' WHERE id=${q(id(400))};`, /ровно одно/);
  await rejected('attributes: typed value required', `UPDATE ar_product_attributes SET value_id=NULL,text_value='QA' WHERE id=${q(id(400))};`, /типу характеристики/);
  await rejected('attributes: value must belong to chosen attribute', `UPDATE ar_product_attributes SET value_id=${q(id(210))} WHERE id=${q(id(400))};`, /другой характеристики/);
  await rejected('attributes: used type immutable', `UPDATE ar_attributes SET value_type='text' WHERE id=${q(id(201))};`, /тип используемой/);
  await rejected('attributes: used value parent immutable', `UPDATE ar_attribute_values SET attribute_id=${q(id(200))} WHERE id=${q(id(220))};`, /используемое значение/);
  await rejected('attributes: dictionary values only for select types', `INSERT INTO ar_attributes(id,code,name,value_type) VALUES(${q(qaId(1))},'qa_text','QA','text'); INSERT INTO ar_attribute_values(attribute_id,label,code) VALUES(${q(qaId(1))},'QA','qa');`, /Справочник значений/);
  await rejected('fitment: SKU must belong to selected product', `INSERT INTO ar_fitment(product_id,sku_id,vehicle_id) VALUES(${q(id(101))},${q(id(1001))},${q(id(52))});`, /другому товару/);
  const version = `INSERT INTO ar_vehicle_versions(id,vehicle_id,name) VALUES(${q(qaId(2))},${q(id(52))},'QA modification');`;
  await rejected('fitment: version must belong to selected vehicle', `${version} INSERT INTO ar_fitment(product_id,vehicle_id,version_id) VALUES(${q(id(100))},${q(id(53))},${q(qaId(2))});`, /другому автомобилю/);
  await rejected('fitment: version vehicle immutable', `${version} UPDATE ar_vehicle_versions SET vehicle_id=${q(id(53))} WHERE id=${q(qaId(2))};`, /фиксируется при создании/);
  await rejected('fitment: years ordered', `UPDATE ar_fitment SET year_from=2020,year_to=2010 WHERE id=${q(id(500))};`, /check constraint/);
  await equal('inheritance: SKU inherits product attribute', `SELECT ar_effective_sku(${q(id(1001))})->'attributes'->${q(id(201))}->>'value_id';`, id(220));
  await equal('inheritance: SKU overrides one attribute and preserves others', `SELECT (ar_effective_sku(${q(id(1003))})->'attributes'->${q(id(201))}->>'value_id'=${q(id(221))}) AND (ar_effective_sku(${q(id(1003))})->'attributes'->${q(id(202))}->>'value_id'=${q(id(230))});`, 't');
  await equal('inheritance: SKU uses product image', `SELECT ar_effective_sku(${q(id(1001))})->'media'->0->>'file_id'=(SELECT file_id::text FROM ar_product_media WHERE id=${q(id(700))});`, 't');
  await equal('inheritance: own image replaces product image', `SELECT jsonb_array_length(ar_effective_sku(${q(id(1003))})->'media')=1 AND ar_effective_sku(${q(id(1003))})->'media'->0->>'file_id'=(SELECT file_id::text FROM ar_sku_media WHERE id=${q(id(701))});`, 't');
  await equal('inheritance: unknown compatibility stays unknown', `SELECT jsonb_array_length(ar_effective_sku(${q(id(1001))})->'fitment')=2 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ar_effective_sku(${q(id(1001))})->'fitment') v WHERE v->>'state'<>'unknown');`, 't');
  await equal('inheritance: own compatibility replaces product rules', `UPDATE ar_skus SET fitment_mode='replace' WHERE id=${q(id(1001))}; INSERT INTO ar_fitment(product_id,sku_id,vehicle_id,state) VALUES(${q(id(100))},${q(id(1001))},${q(id(52))},'incompatible'); SELECT jsonb_array_length(ar_effective_sku(${q(id(1001))})->'fitment')=1 AND ar_effective_sku(${q(id(1001))})->'fitment'->0->>'state'='incompatible';`, 't');
  await equal('bundle: computed discount price and shared stock', `SELECT price_rubles||':'||available FROM ar_bundle_offer(${q(id(106))});`, '15770.00:4');
  await equal('bundle: absent component stock makes whole bundle unavailable', `DELETE FROM ar_stock WHERE sku_id=${q(id(1001))}; SELECT available FROM ar_bundle_offer(${q(id(106))});`, 0);
  await equal('bundle: insufficient component quantity makes whole bundle unavailable', `UPDATE ar_stock SET on_hand=1,reserved=0 WHERE sku_id=${q(id(1021))}; SELECT available FROM ar_bundle_offer(${q(id(106))});`, 0);
  await equal('bundle: reserved units reduce shared availability', `UPDATE ar_stock SET on_hand=4,reserved=3 WHERE sku_id=${q(id(1021))}; SELECT available FROM ar_bundle_offer(${q(id(106))});`, 0);
  await rejected('stock: reservations cannot exceed physical units', `UPDATE ar_stock SET reserved=on_hand+1 WHERE sku_id=${q(id(1001))};`, /check constraint/);
  await equal('slug: rename records history', `UPDATE ar_products SET slug='qa-renamed-heater' WHERE id=${q(id(100))}; SELECT EXISTS(SELECT 1 FROM ar_slug_history WHERE entity_type='product' AND entity_id=${q(id(100))} AND old_slug='heater-control');`, 't');
  await rejected('slug: historical address cannot be reassigned', `UPDATE ar_products SET slug='qa-renamed-heater' WHERE id=${q(id(100))}; ${productInsert(qaId(3), 'heater-control')}`, /Адрес занят/);
  await equal('slug: original owner can restore its old address', `UPDATE ar_products SET slug='qa-renamed-heater' WHERE id=${q(id(100))}; UPDATE ar_products SET slug='heater-control' WHERE id=${q(id(100))}; SELECT slug FROM ar_products WHERE id=${q(id(100))};`, 'heater-control');
  await rejected('CMS SQL role: stock update forbidden', `SET ROLE ar_cms; UPDATE ar_stock SET on_hand=on_hand+1 WHERE sku_id=${q(id(1001))};`, /permission denied for table ar_stock/);
  await rejected('CMS SQL role: catalog schema DDL forbidden', 'SET ROLE ar_cms; ALTER TABLE ar_products ADD COLUMN qa_illegal integer;', /must be owner of table ar_products/);

  sql(productInsert(qaId(10), 'qa-race-kind'));
  await race('concurrency: changing kind blocks creating a SKU', `UPDATE ar_products SET kind='bundle' WHERE id=${q(qaId(10))};`, skuInsert(qaId(10), qaId(110)), /только отдельному товару/, `SELECT NOT EXISTS(SELECT 1 FROM ar_skus WHERE product_id=${q(qaId(10))});`);
  sql(productInsert(qaId(11), 'qa-race-sku'));
  await race('concurrency: creating a SKU blocks changing kind', skuInsert(qaId(11), qaId(111)), `UPDATE ar_products SET kind='bundle' WHERE id=${q(qaId(11))};`, /с SKU/, `SELECT kind='single' FROM ar_products WHERE id=${q(qaId(11))};`);
  sql(productInsert(qaId(12), 'qa-race-slug-old'));
  await race('concurrency: renamed slug cannot be claimed by another product', `UPDATE ar_products SET slug='qa-race-slug-new' WHERE id=${q(qaId(12))};`, productInsert(qaId(13), 'qa-race-slug-old'), /Адрес занят/, `SELECT NOT EXISTS(SELECT 1 FROM ar_products WHERE id=${q(qaId(13))});`, true);
} catch (error) {
  report.setupError = error.message;
  console.error(`Schema check failed: ${error.message}`);
} finally {
  if (created) {
    assert.match(database, /^ar_qa_\d+_\d+$/);
    assert.notEqual(database, source);
    try {
      // FORCE terminates only sessions in this exact, newly created QA clone.
      sql(`DROP DATABASE ${database} WITH (FORCE);`, source);
      report.cleanup = true;
    } catch (error) {
      report.cleanupError = error.message;
      console.error(`QA cleanup failed: ${error.message}`);
    }
  }
  report.finishedAt = new Date().toISOString();
  report.passed = !report.setupError && report.cleanup && report.checks.length > 0 && report.checks.every(check => check.passed);
  mkdirSync(`${root}/artifacts/stage-3`, {recursive: true});
  writeFileSync(`${root}/artifacts/stage-3/schema-check.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.checks.filter(check => check.passed).length}/${report.checks.length} schema checks passed; temporary database removed: ${report.cleanup}`);
  if (!report.passed) process.exitCode = 1;
}
