import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const elements=new Map(),store=new Map();
const context=vm.createContext({window:{},document:{getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',setAttribute(){},classList:{toggle(){}}});return elements.get(id)}},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},console,setTimeout,clearTimeout,Intl,Date,Map,crypto:{randomUUID:()=> 'new-id'}});
vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/\ninit\(\);\s*$/,''),context);
const run=s=>vm.runInContext(s,context);
await run(`saveDemo([{id:'1',org_id:'demo-1',name:'Actual',status:'Won',budget:100000,booking_value:75000.25},{id:'2',org_id:'demo-1',name:'Unknown',status:'Won',budget:900000},{id:'3',org_id:'demo-2',name:'Not won',status:'New',budget:200000,booking_value:50000},{id:'4',org_id:'demo-1',name:'Free',status:'Won',booking_value:0}]);`);
let page=await run('getLeadPage()');
assert.equal(page.summary.revenue,75000.25);assert.equal(page.summary.won,3);assert.equal(page.summary.booking_value_count,2);assert.equal(page.summary.missing_booking_value,1);
await run('render()');assert.equal(elements.get('missingBookingValue').textContent,1);assert.equal(elements.get('avgDeal').textContent,run('money(75000.25/2)'));
page=await run(`filters.client='demo-2';getLeadPage()`);assert.equal(page.summary.revenue,0);assert.equal(page.summary.missing_booking_value,0);
for(const invalid of ['-1','abc','Infinity','1.123','10000000000'])assert.throws(()=>run('parseBookingValue('+JSON.stringify(invalid)+')'));
assert.equal(run("parseBookingValue('')"),null);assert.equal(run("parseBookingValue('0')"),0);assert.equal(run("parseBookingValue('123.45')"),123.45);
await run(`saveLead({id:'1',booking_value:'80000.50'})`);assert.equal(await run(`getLead('1').then(x=>x.booking_value)`),80000.5);
await run(`saveLead({id:'1',booking_value:''})`);assert.equal(await run(`getLead('1').then(x=>x.booking_value)`),null);
for(const slug of ['meta-crm-event','meta-business-messaging-event']){const source=fs.readFileSync(new URL('../supabase/functions/'+slug+'/index.ts',import.meta.url),'utf8');assert.match(source,/Number\(lead\.booking_value \|\| 0\)/);assert.doesNotMatch(source,/lead\.budget/);}
console.log('Booking value: confirmed-only revenue, missing/zero amounts, decimals, validation, editing, client scope and Meta amount sources passed');
