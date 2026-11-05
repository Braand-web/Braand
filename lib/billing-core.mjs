import {AppError} from './core.mjs';

export const CATALOG_VERSION='2026-11-05.1';
export const CREDIT_SCALE=100;
export const DAY=86400000;
export const PLANS=Object.freeze({
 essential:{name:'Essentiel',periodPrice:4900,annualPrice:49000,credits:100,members:1,spaces:1,projects:10,storage:2*1024**3,transfer:10*1024**3,concurrency:1,sites:3},
 pro:{name:'Pro',periodPrice:9900,annualPrice:99000,credits:250,members:1,spaces:2,projects:30,storage:10*1024**3,transfer:30*1024**3,concurrency:2,sites:10},
 business:{name:'Business',periodPrice:24900,annualPrice:249000,credits:600,members:5,spaces:5,projects:50,storage:25*1024**3,transfer:75*1024**3,concurrency:3,sites:25},
 enterprise:{name:'Entreprise',periodPrice:79900,annualPrice:799000,credits:2500,members:20,spaces:20,projects:200,storage:100*1024**3,transfer:500*1024**3,concurrency:10,sites:100}
});
export const PLAN_ORDER=Object.freeze(['essential','pro','business','enterprise']);
/** Plans with a shared team, governance and member invitations. */
export const teamPlan=plan=>plan==='business'||plan==='enterprise';
// Historical contracts remain independent of the current sales catalogue.
export const LEGACY_PLANS=Object.freeze({pro:{...PLANS.pro,periodPrice:9900,annualPrice:99000,credits:200},business:{...PLANS.business,periodPrice:29900,annualPrice:299000,credits:600}});
export const PACKS=Object.freeze([50,125,300]);
const PACK_PRICES=Object.freeze({50:2500,125:5000,300:10000});
export function topupPrice(quantity){
 if(!Number.isSafeInteger(quantity)||!PACKS.includes(quantity))throw new AppError('Choisissez un pack de 50, 125 ou 300 crédits.',400,'invalid_quantity');
 return PACK_PRICES[quantity];
}
export function product(input){
 if(input.kind==='topup')return {kind:'topup',quantity:input.quantity,credits:input.quantity,amount:topupPrice(input.quantity),currency:'XAF',version:CATALOG_VERSION};
 if(input.kind!=='subscription'||!Object.hasOwn(PLANS,input.plan)||!['period','annual'].includes(input.cycle))throw new AppError('Offre invalide.');
 const p=PLANS[input.plan];return {kind:'subscription',plan:input.plan,cycle:input.cycle,credits:p.credits,amount:input.cycle==='annual'?p.annualPrice:p.periodPrice,currency:'XAF',version:CATALOG_VERSION};
}
export function taxRule(value,validated=false){
 if(!validated||!value||!['exclusive','inclusive'].includes(value.mode)||!Number.isSafeInteger(value.rateBps)||value.rateBps<0||value.rateBps>10000||typeof value.jurisdiction!=='string'||!value.jurisdiction.trim()||value.jurisdiction.length>100||typeof value.version!=='string'||!value.version.trim()||value.version.length>100||typeof value.validatedAt!=='string'||!Number.isFinite(Date.parse(value.validatedAt)))throw new AppError('La fiscalité doit être configurée et validée avant de préparer le paiement.',503,'tax_not_ready');
 return {mode:value.mode,rateBps:value.rateBps,jurisdiction:value.jurisdiction.trim(),version:value.version.trim(),validatedAt:value.validatedAt};
}
// XAF has no minor currency unit. BigInt avoids floating point rounding drift.
export function quoteTax(baseAmount,rule){
 if(!Number.isSafeInteger(baseAmount)||baseAmount<=0)throw new AppError('Montant du devis invalide.',409,'quote_invalid');
 const checked=taxRule(rule,true),base=BigInt(baseAmount),rate=BigInt(checked.rateBps);
 const tax=Number(checked.mode==='exclusive'?(base*rate+5000n)/10000n:(base*rate+(10000n+rate)/2n)/(10000n+rate));
 const total=checked.mode==='exclusive'?baseAmount+tax:baseAmount,subtotal=total-tax;
 if(!Number.isSafeInteger(total)||subtotal<=0)throw new AppError('Montant fiscal hors limites.',409,'quote_invalid');
 return {baseAmount,subtotal,tax,total,amount:total,taxMode:checked.mode,taxRateBps:checked.rateBps,taxJurisdiction:checked.jurisdiction,taxConfigVersion:checked.version,taxValidatedAt:checked.validatedAt};
}
export function validateQuoteTax(p,rule){
 const expected=quoteTax(p.baseAmount,rule);
 if(Object.entries(expected).some(([key,value])=>p[key]!==value))throw new AppError('La fiscalité ou le montant a changé. Actualisez le devis.',409,'quote_tax_changed');
 return expected;
}
export function anniversary(anchor,months){
 const d=new Date(anchor);if(!Number.isFinite(d.getTime())||!Number.isInteger(months))throw new AppError('Date invalide.');
 const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
 d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.getTime();
}
export function periods(start,cycle,credits){
 return Array.from({length:cycle==='annual'?12:1},(_,i)=>({index:i,start:cycle==='annual'?anniversary(start,i):start,end:cycle==='annual'?anniversary(start,i+1):start+30*DAY,units:credits*CREDIT_SCALE}));
}
export function marginCheck(p,e){
 const valid=['taxBps','feeBps','feeFixed','unitCost','monthlyServiceCost','riskBps'].every(k=>Number.isFinite(e?.[k])&&e[k]>=0);
 if(!valid||e.unitCost<4||e.taxBps>10000||e.feeBps>10000||e.riskBps>10000)return {eligible:false,reason:'Coûts ou fiscalité non validés.'};
 const months=p.kind==='upgrade'?p.serviceMonths:p.kind==='subscription'?(p.cycle==='annual'?12:1):0;
 if(p.taxRateBps!==undefined&&p.taxRateBps!==e.taxBps)return {eligible:false,reason:'Fiscalité et coûts incohérents.'};
 const net=p.subtotal??p.amount/(1+e.taxBps/10000),credits=p.kind==='upgrade'?p.remainingCredits:p.credits*(months||1);
 if(!Number.isFinite(months)||months<0||!Number.isFinite(credits)||credits<0)return {eligible:false,reason:'Engagement restant inconnu.'};
 const cost=credits*e.unitCost+p.amount*e.feeBps/10000+e.feeFixed+months*e.monthlyServiceCost+net*e.riskBps/10000;
 const margin=net>0?1-cost/net:0;return {eligible:margin>=.75,margin,netRevenue:net,variableCost:cost,fullConsumptionCredits:credits};
}
export function roleAllows(role,action){
 return ({owner:['read','write','approve','billing','manage'],admin:['read','write','approve','manage'],editor:['read','write'],approver:['read','approve'],reader:['read']}[role]||[]).includes(action);
}
export function usageUnits(usage,rate){
 for(const k of ['input_tokens','output_tokens'])if(!Number.isSafeInteger(usage?.[k])||usage[k]<0)throw new AppError('Consommation fournisseur incomplète.',409,'usage_unknown');
 const input=usage.input_tokens,output=usage.output_tokens,cacheWrite=usage.cache_creation_input_tokens||0,cacheRead=usage.cache_read_input_tokens||0;
 if(![cacheWrite,cacheRead].every(n=>Number.isSafeInteger(n)&&n>=0))throw new AppError('Consommation cache invalide.');
 const hour=usage.cache_creation?.ephemeral_1h_input_tokens||0;
 if(!Number.isSafeInteger(hour)||hour<0||hour>cacheWrite||(hour>0&&!Number.isFinite(rate.cacheWriteHour)))throw new AppError('Tarif de cache longue durée inconnu.',409,'usage_unknown');
 const xaf=(input*rate.input+output*rate.output+(cacheWrite-hour)*rate.cacheWrite+hour*(rate.cacheWriteHour||0)+cacheRead*rate.cacheRead)/1e6*rate.usdXaf+rate.overheadXaf;
 return {xaf,units:Math.ceil(xaf/4*100),usage};
}
export function upgradePlan(sub,target='business'){
 const historical=sub.cycle==='annual'&&(!sub.catalog_version||['2026-10-16.1','2026-10-22.1'].includes(sub.catalog_version))&&Object.hasOwn(LEGACY_PLANS,target);
 return historical?LEGACY_PLANS[target]:PLANS[target];
}
export function upgradeQuote(sub,now,terms,target='business'){
 const ranking={essential:0,pro:1,business:2,enterprise:3};
 if(!Object.hasOwn(ranking,sub.plan)||!Object.hasOwn(ranking,target)||ranking[target]<=ranking[sub.plan]||now<sub.start_at||now>=sub.end_at)throw new AppError('Aucun forfait actif à faire évoluer vers cette offre.',409);
 const old=terms||LEGACY_PLANS[sub.plan]||PLANS[sub.plan],next=upgradePlan(sub,target);
 if(!next)throw new AppError('Ce changement annuel est indisponible.',409);
 const delta=sub.cycle==='annual'?next.annualPrice-old.annualPrice:next.periodPrice-old.periodPrice;
 const schedule=periods(sub.start_at,sub.cycle,old.credits),current=schedule.find(p=>p.start<=now&&p.end>now),future=schedule.filter(p=>p.start>now).length;
 const fraction=(current.end-now)/(current.end-current.start),units=Math.floor((next.credits-old.credits)*100*fraction);
 return {amount:Math.ceil(delta*(sub.end_at-now)/(sub.end_at-sub.start_at)),units,periodEnd:current.end,subscriptionEnd:sub.end_at,remainingCredits:units/100+future*(next.credits-old.credits),serviceMonths:fraction+future};
}
export function decimalXaf(value){if(!/^\d+(?:\.0{1,2})?$/.test(String(value)))throw new AppError('Montant fournisseur invalide.',409);const n=Number(value);if(!Number.isSafeInteger(n))throw new AppError('Montant hors limites.');return n;}
export async function verifyWebhook(raw,headers,secret,now=Date.now()){
 const stamp=headers.get('x-webhook-timestamp'),signature=headers.get('x-webhook-signature');
 if(!secret||!/^\d{10}$/.test(stamp||'')||! /^[a-f0-9]{64}$/.test(signature||'')||Math.abs(now/1000-Number(stamp))>300)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),s=>parseInt(s,16)),new TextEncoder().encode(stamp+'.'+raw));
}
