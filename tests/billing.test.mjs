import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {topupPrice,PLANS,LEGACY_PLANS,PACKS,periods,anniversary,marginCheck,product,upgradeQuote,usageUnits,verifyWebhook,roleAllows,decimalXaf,taxRule,quoteTax,validateQuoteTax} from '../lib/billing-core.mjs';
test('Only the three approved packs can be sold at exact integer XAF prices',()=>{
 assert.deepEqual(PACKS,[50,125,300]);assert.deepEqual(PACKS.map(topupPrice),[2500,5000,10000]);
 for(const value of [-1,0,49,50.5,100,150,250,1000,10000,10001,NaN,Infinity,'125'])assert.throws(()=>topupPrice(value));
 for(const [plan,amount,credits] of [['essential',4900,100],['pro',9900,250],['business',24900,600],['enterprise',79900,2500]]){
  assert.deepEqual([product({kind:'subscription',plan,cycle:'period'}).amount,PLANS[plan].credits],[amount,credits]);
  const annual=product({kind:'subscription',plan,cycle:'annual'});
  assert.equal(annual.amount,amount*10);assert.equal(annual.cycle,'annual');assert.equal(annual.credits,credits);
  assert.equal(periods(Date.parse('2026-01-31T12:00:00Z'),annual.cycle,annual.credits).reduce((total,row)=>total+row.units,0),credits*12*100);
 }
});
const taxConfig={mode:'exclusive',rateBps:1925,jurisdiction:'fixture:CM-applicable-rule',version:'fixture-tax-v1',validatedAt:'2026-10-22'};
test('Taxes require an explicit validated rule, round once in XAF, and bind the complete quote',()=>{
 for(const invalid of [null,{}, {...taxConfig,mode:'automatic'},{...taxConfig,rateBps:NaN},{...taxConfig,rateBps:19.25},{...taxConfig,jurisdiction:''},{...taxConfig,validatedAt:'unknown'}])assert.throws(()=>taxRule(invalid,true));
 assert.throws(()=>taxRule(taxConfig,false),error=>error.code==='tax_not_ready');
 const exclusive=quoteTax(4900,taxConfig);assert.deepEqual([exclusive.subtotal,exclusive.tax,exclusive.total],[4900,943,5843]);
 const inclusive=quoteTax(4900,{...taxConfig,mode:'inclusive'});assert.deepEqual([inclusive.subtotal,inclusive.tax,inclusive.total],[4109,791,4900]);
 assert.equal(quoteTax(1,{...taxConfig,rateBps:5000}).tax,1);
 assert.equal(quoteTax(4900,{...taxConfig,rateBps:0}).tax,0);
 assert.doesNotThrow(()=>validateQuoteTax(exclusive,taxConfig));
 for(const changed of [{...exclusive,amount:1},{...exclusive,total:1},{...exclusive,subtotal:1},{...exclusive,tax:0},{...exclusive,taxJurisdiction:'other'},{...exclusive,taxConfigVersion:'other'}])assert.throws(()=>validateQuoteTax(changed,taxConfig),error=>error.code==='quote_tax_changed');
 assert.throws(()=>validateQuoteTax(exclusive,{...taxConfig,rateBps:0}));
 assert.equal(marginCheck({...product({kind:'subscription',plan:'essential',cycle:'period'}),...exclusive},{taxBps:0,feeBps:0,feeFixed:0,unitCost:4,monthlyServiceCost:0,riskBps:0}).eligible,false);
});
test('Annual calendar anchors survive February, leap years and month-end',()=>{
 const start=Date.parse('2024-01-31T14:05:00Z'),p=periods(start,'annual',200);
 assert.equal(p.length,12);assert.equal(p.reduce((n,x)=>n+x.units,0),240000);
 assert.equal(new Date(p[1].start).toISOString(),'2024-02-29T14:05:00.000Z');
 assert.equal(new Date(p[2].start).toISOString(),'2024-03-31T14:05:00.000Z');
 assert.equal(new Date(p[11].end).toISOString(),'2025-01-31T14:05:00.000Z');
 assert.equal(new Date(anniversary(Date.parse('2023-01-31T00:00:00Z'),1)).getUTCDate(),28);
 assert.equal(periods(start,'period',200)[0].end-start,30*86400000);
});
test('Margin gate includes all annual credits, tax and payment fees',()=>{
 const p={kind:'subscription',plan:'pro',cycle:'annual',amount:LEGACY_PLANS.pro.annualPrice,credits:LEGACY_PLANS.pro.credits};
 assert.equal(marginCheck(p,{}).eligible,false);
 const e={taxBps:0,feeBps:500,feeFixed:100,unitCost:4,monthlyServiceCost:300,riskBps:100};
 const r=marginCheck(p,e);assert.equal(r.fullConsumptionCredits,2400);assert(r.margin>=.75);
 assert.equal(marginCheck(p,{...e,unitCost:15}).eligible,false);
 assert(marginCheck(p,{...e,taxBps:1925}).netRevenue<r.netRevenue);
});
test('Upgrade prorates price and credit difference, never grants a second full quota',()=>{
 const start=Date.parse('2026-01-01Z'),sub={plan:'pro',cycle:'period',start_at:start,end_at:start+30*86400000};
 const q=upgradeQuote(sub,start+15*86400000);assert.equal(q.amount,7500);assert.equal(q.units,20000);assert.equal(q.periodEnd,sub.end_at);
 const current=upgradeQuote(sub,start+15*86400000,PLANS.pro);assert.equal(current.units,17500);
 const essential=upgradeQuote({...sub,plan:'essential'},start+15*86400000,PLANS.essential,'pro');assert.equal(essential.amount,2500);assert.equal(essential.units,7500);
 assert.throws(()=>upgradeQuote({...sub,plan:'business'},start));
 const tiny={kind:'upgrade',...upgradeQuote(sub,sub.end_at-3600000)},e={taxBps:0,feeBps:500,feeFixed:100,unitCost:4,monthlyServiceCost:300,riskBps:100};
 assert.equal(tiny.amount,21);assert.equal(marginCheck(tiny,e).eligible,false);
});
test('New annual upgrades use current contracts while historical annual upgrades keep their catalogue',()=>{
 const start=Date.parse('2026-01-01T00:00:00Z'),now=anniversary(start,6),end=anniversary(start,12);
 const sub={plan:'essential',cycle:'annual',start_at:start,end_at:end,catalog_version:'2026-10-25.1'};
 const q=upgradeQuote(sub,now,PLANS.essential,'pro');
 assert.equal(q.amount,Math.ceil((99000-49000)*(end-now)/(end-start)));
 assert.equal(q.units,15000);assert.equal(q.remainingCredits,900);assert.equal(q.subscriptionEnd,end);
 const modern=upgradeQuote({...sub,plan:'pro'},now,PLANS.pro,'business');
 const historical=upgradeQuote({...sub,plan:'pro',catalog_version:'2026-10-16.1'},now,LEGACY_PLANS.pro,'business');
 assert.equal(modern.remainingCredits,2100);assert.equal(historical.remainingCredits,2400);
 assert.equal(historical.amount,Math.ceil(200000*(end-now)/(end-start)));
});

test('Usage includes cache; malformed or partial provider amounts are rejected',()=>{
 const r=usageUnits({input_tokens:1000,output_tokens:200,cache_creation_input_tokens:300,cache_read_input_tokens:400},{input:5,output:25,cacheWrite:6.25,cacheRead:.5,usdXaf:600,overheadXaf:1});
 assert(Math.abs(r.xaf-8.245)<.00001);assert.equal(r.units,207);
 assert.throws(()=>usageUnits({input_tokens:1000},{}));
 assert.equal(decimalXaf('9900.00'),9900);for(const n of ['9900.1','1e3','-5','Infinity'])assert.throws(()=>decimalXaf(n));
});
test('Webhook requires authentic raw body and fresh timestamp',async()=>{
 const now=Date.now(),stamp=String(Math.floor(now/1000)),body='{"event":"transaction.success"}',secret='test-only-secret';
 const signature=createHmac('sha256',secret).update(stamp+'.'+body).digest('hex');const h=new Headers({'x-webhook-timestamp':stamp,'x-webhook-signature':signature});
 assert(await verifyWebhook(body,h,secret,now));assert.equal(await verifyWebhook(body+' ',h,secret,now),false);assert.equal(await verifyWebhook(body,h,secret,now+301000),false);
});
test('Roles separate approval, spending and financial ownership',()=>{
 assert(roleAllows('owner','billing'));assert(!roleAllows('admin','billing'));assert(!roleAllows('reader','write'));assert(roleAllows('approver','approve'));assert(!roleAllows('approver','write'));assert(!roleAllows('editor','approve'));
});
function database(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return db;}
test('Ledger triggers reject double spending, preserve reservations after expiry and are immutable',()=>{
 const db=database(),now=Date.now();db.prepare('INSERT INTO organizations VALUES (?,?,?,?)').run('org','Example','user',now);
 db.prepare('INSERT INTO workspaces(id,name,created_at,organization_id) VALUES (?,?,?,?)').run('space','Space',now,'org');
 db.prepare('INSERT INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('lot','org','subscription','sub',1000,1000,now-1000,now+1000,now);
 const hold=db.prepare('INSERT INTO credit_holds(id,organization_id,workspace_id,actor,reference,units,created_at) VALUES (?,?,?,?,?,?,?)');hold.run('h1','org','space','user','r1',800,now);hold.run('h2','org','space','user','r2',400,now);
 const a=db.prepare('INSERT INTO credit_allocations(id,hold_id,lot_id,units,created_at) VALUES (?,?,?,?,?)');a.run('a1','h1','lot',800,now);assert.throws(()=>a.run('a2','h2','lot',400,now),/insufficient_credits/);
 db.prepare('UPDATE credit_lots SET expires_at=? WHERE id=?').run(now-1,'lot');
 db.exec("UPDATE credit_allocations SET charged=500,state='settled' WHERE id='a1'");
 assert.deepEqual({...db.prepare('SELECT balance,reserved FROM credit_lots').get()},{balance:500,reserved:0});
 assert.throws(()=>a.run('a3','h2','lot',300,now),/insufficient_credits/);
 assert.throws(()=>db.exec("UPDATE credit_allocations SET charged=100 WHERE id='a1'"),/allocation_final/);
 assert.throws(()=>db.exec('DELETE FROM credit_ledger'),/immutable_ledger/);db.close();
});
test('Budget limits are checked before a concurrent hold can be inserted',()=>{
 const db=database(),now=Date.now();db.prepare('INSERT INTO billing_limits VALUES (?,?,?,?)').run('org','organization','org',1000);
 const hold=db.prepare('INSERT INTO credit_holds(id,organization_id,workspace_id,actor,reference,units,created_at) VALUES (?,?,?,?,?,?,?)');hold.run('h1','org','space','user','r1',700,now);
 assert.throws(()=>hold.run('h2','org','space','user','r2',400,now),/spend_limit/);db.close();
});
