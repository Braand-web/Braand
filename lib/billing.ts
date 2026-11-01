import {z} from 'zod';
import {db,config,uid,auditLog} from './server';
import {AppError} from './core.mjs';
import {PLANS,LEGACY_PLANS,PACKS,CATALOG_VERSION,product,topupPrice,periods,marginCheck,decimalXaf,upgradeQuote,upgradePlan,DAY,roleAllows,taxRule,quoteTax,validateQuoteTax} from './billing-core.mjs';
import {checkoutResponseSchema,sessionResponseSchema,sessionListSchema,transactionResponseSchema,type BillingProduct,type CreditAllocationRow,type CreditHoldRow,type CreditLotSummary,type Economics,type InvoiceDocument,type InvoiceSeller,type OrderRow,type PaymentSession,type QuoteInput,type QuoteRow,type SubscriptionRow,type TaxRule} from './billing-types';
import type {ModelRate} from './model-protocol';
import {WELCOME_CREDITS,WELCOME_DAYS,WELCOME_UNITS,WELCOME_TTL} from './welcome-credits.mjs';

export type BillingIdentity={tenant:string;organization:string;user:{userId:string;email:string;displayName:string};role:string};
const s=(q:string,...values:(string|number|null)[])=>db().prepare(q).bind(...values);
const LEGACY_ORDER_METADATA_KEY=['ai','ra','_order_id'].join('');
const providerOrderId=(session:PaymentSession)=>session.metadata?.braand_order_id??(session.metadata as Record<string,unknown>|null|undefined)?.[LEGACY_ORDER_METADATA_KEY];
// Provider country/network currencies plus its global card/crypto currency.
const convertedCheckoutCurrencies=new Set(['USD','XOF','CDF','GHS','GNF','KES','MWK','MZN','NGN','RWF','TZS','UGX','ZMW']);
function decimalMinorUnits(value:unknown):number|undefined{
 if(value===undefined||value===null)return;
 const raw=String(value);if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return;
 const [whole,fraction='']=raw.split('.');const result=Number(whole)*100+Number((fraction+'00').slice(0,2));
 return Number.isSafeInteger(result)?result:undefined;
}
function commercialSubscription(row:SubscriptionRow|null){return row?{...row,plan:row.catalog_plan||row.plan}:null;}
export async function currentSubscription(org:string,now=Date.now()) {return commercialSubscription(await s("SELECT * FROM billing_subscriptions WHERE organization_id=? AND status='active' AND start_at<=? AND end_at>? ORDER BY start_at DESC LIMIT 1",org,now,now).first<SubscriptionRow>());}
export async function subscriptionTerms(sub:SubscriptionRow){
 const order=await s('SELECT product FROM billing_orders WHERE id=? AND organization_id=?',sub.order_id,sub.organization_id).first<{product:string}>();
 const historical=LEGACY_PLANS[sub.plan as keyof typeof LEGACY_PLANS]||PLANS[sub.plan];
 let purchased:BillingProduct|undefined;try{purchased=order?JSON.parse(order.product) as BillingProduct:undefined;}catch{throw new AppError('Contrat de crédits illisible. Rapprochement requis.',409,'subscription_terms_unknown');}
 const credits=sub.credit_allowance??(purchased?.kind==='subscription'?purchased.credits:historical.credits);
 if(!Number.isSafeInteger(credits)||credits<0)throw new AppError('Contrat de crédits invalide.',409,'subscription_terms_unknown');
 const amount=sub.contract_price??(purchased?.kind==='subscription'?(purchased.baseAmount??purchased.amount):undefined);
 return {credits,periodPrice:sub.cycle==='period'&&amount!==undefined?amount:historical.periodPrice,annualPrice:sub.cycle==='annual'&&amount!==undefined?amount:historical.annualPrice};
}
export async function subscriptionVersion(org:string){const rows=await s("SELECT id,version,start_at,end_at,status FROM billing_subscriptions WHERE organization_id=? ORDER BY id",org).all<Pick<SubscriptionRow,'id'|'version'|'start_at'|'end_at'|'status'>>();return JSON.stringify(rows.results);}
export function economics(plan:string='pro'):Economics{
 try{const all=JSON.parse(config().BILLING_ECONOMICS_JSON||'{}') as Record<string,Economics>;return all[plan]||{};}catch{return {};}
}
export function billingTaxRule():TaxRule{let raw:unknown;try{raw=JSON.parse(config().BILLING_TAX_JSON||'null');}catch{throw new AppError('Configuration fiscale invalide.',503,'tax_not_ready');}return taxRule(raw,config().BILLING_TAX_VALIDATED==='true') as TaxRule;}
function taxStatus(){try{return {configured:true,...billingTaxRule()};}catch{return {configured:false};}}
const invoiceSellerSchema=z.object({name:z.string().trim().min(2).max(200),address:z.string().trim().min(5).max(500),taxId:z.string().trim().min(3).max(100),email:z.string().email().max(254)});
export function billingLegalSeller(){try{return invoiceSellerSchema.parse(JSON.parse(config().BILLING_LEGAL_JSON||'null'));}catch{throw new AppError('Complétez et validez l’identité légale de facturation avant tout paiement.',503,'billing_legal_not_ready');}}
function legalReady(){try{billingLegalSeller();return true;}catch{return false;}}
const hostedCheckout=()=>config().BILLING_CHECKOUT_MODE==='hosted';
function commercialDetails(amount:number){
 // Hosted checkout issues a payment receipt. It makes no claim about a tax
 // exemption or legal seller identity. The invoiced mode retains fiscal checks.
 if(hostedCheckout())return {baseAmount:amount,amount,total:amount,documentKind:'receipt' as const,invoiceSeller:{name:'Braand'}};
 return {...quoteTax(amount,billingTaxRule()),documentKind:'invoice' as const,invoiceSeller:billingLegalSeller()};
}
export function releaseReadiness(){
 const c=config();const checks=[
  ['payment',!!c.SASPAY_SECRET_KEY&&!!c.SASPAY_MERCHANT_ID&&!!c.SASPAY_WEBHOOK_SECRET],
  ['xafCheckout',c.BILLING_XAF_CHECKOUT_VALIDATED==='true'],
  ['fiscal',legalReady()&&taxStatus().configured],
  ['benchmarks',c.BILLING_BENCHMARKS_VALIDATED==='true'],
  ['scheduler',c.BILLING_SCHEDULER_VERIFIED==='true'&&!!c.SCHEDULER_SECRET],
  ['providerTests',c.BILLING_PROVIDER_TESTS_PASSED==='true'],
  ['support',c.BILLING_SUPPORT_READY==='true'],
  ['terms',c.BILLING_TERMS_APPROVED==='true'],
  ['restore',c.BILLING_RESTORE_TESTED==='true'],
  ['webhookReachable',c.BILLING_WEBHOOK_VERIFIED==='true'],
  ['productAcceptance',c.BILLING_PRODUCT_ACCEPTANCE==='true'],
  ['enabled',c.BILLING_ENABLED==='true']
 ] as const;
 const diagnostics=Object.fromEntries(checks),mode=hostedCheckout()?'hosted':'invoiced';
 const operational={payment:diagnostics.payment,environment:!!c.SASPAY_SECRET_KEY?.startsWith(c.SASPAY_ENV==='live'?'sk_live_':'sk_test_'),scheduler:!!c.SCHEDULER_SECRET&&c.SCHEDULER_SECRET.length>=32,enabled:diagnostics.enabled};
 return {enabled:mode==='hosted'?Object.values(operational).every(Boolean):checks.every(([,ok])=>ok),checks:diagnostics,operational,mode,environment:c.SASPAY_ENV==='live'?'live':'sandbox'};
}
export function catalog(){return {version:CATALOG_VERSION,currency:'XAF',plans:PLANS,packs:PACKS.map(quantity=>({quantity,amount:topupPrice(quantity)})),custom:null,cycles:['period','annual'],annualAvailable:true,checkoutMode:hostedCheckout()?'hosted':'invoiced',tax:hostedCheckout()?{configured:false}:taxStatus(),readiness:releaseReadiness(),free:{credits:WELCOME_CREDITS,days:WELCOME_DAYS,enabled:Number(config().FREE_DAILY_CREDITS||0)>=WELCOME_CREDITS},renewal:'manual'};}
export function requireBilling(who:BillingIdentity){if(!roleAllows(who.role,'billing'))throw new AppError('Seul le propriétaire peut gérer les paiements.',403);}
export async function activeRights(org:string){const sub=await currentSubscription(org);return {subscription:sub,plan:sub?.plan||'free',limits:sub?PLANS[sub.plan as keyof typeof PLANS]:{members:1,spaces:1,projects:2,storage:256*1024**2,transfer:1024**3,concurrency:1}};}

// Stable IDs and INSERT OR IGNORE make allocation catch-up safe after crashes.
export async function allocateDue(org:string,now=Date.now()){
 const subs=await s("SELECT * FROM billing_subscriptions WHERE organization_id=? AND status='active' AND start_at<=?",org,now).all<SubscriptionRow>();
 for(const row of subs.results){const sub=commercialSubscription(row)!;if(await s("SELECT id FROM billing_refunds WHERE order_id=? AND status IN ('requested','processing','confirmed')",sub.order_id).first())continue;const terms=await subscriptionTerms(sub);for(const p of periods(sub.start_at,sub.cycle,terms.credits)){
  if(p.start>now)continue;
  const id=`allocation:${sub.id}:${p.index}`;
  await s('INSERT OR IGNORE INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',id,org,'subscription',sub.order_id,p.units,p.units,p.start,p.end,now).run();
 }}
}
export async function expireLots(org:string,now=Date.now()){
 await db().batch([
 s("INSERT INTO credit_ledger SELECT ?||':'||id,organization_id,id,'expire',balance-reserved,id,? FROM credit_lots WHERE organization_id=? AND expires_at<=? AND balance>reserved",uid(),now,org,now),
 s('UPDATE credit_lots SET balance=reserved WHERE organization_id=? AND expires_at<=? AND balance>reserved',org,now)
 ]);
}
export async function claimFree(who:BillingIdentity){
 requireBilling(who);
 const daily=Math.floor(Number(config().FREE_DAILY_CREDITS||0)*100);if(daily<WELCOME_UNITS)throw new AppError('La découverte gratuite est actuellement indisponible.',409);
 const now=Date.now(),day=new Date(now).toISOString().slice(0,10),id='free:'+who.user.userId;
 await db().batch([
  s('INSERT OR IGNORE INTO billing_claims SELECT ?,?,?,?,? WHERE (SELECT COALESCE(SUM(units),0) FROM billing_claims WHERE day=?)+?<=?',who.user.userId,who.organization,day,WELCOME_UNITS,now,day,WELCOME_UNITS,daily),
  s("INSERT OR IGNORE INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,expires_at,created_at) SELECT ?,organization_id,'free',user_id,units,units,created_at,created_at+?,created_at FROM billing_claims WHERE user_id=? AND organization_id=?",id,WELCOME_TTL,who.user.userId,who.organization)
 ]);
 if(!await s('SELECT id FROM credit_lots WHERE id=? AND organization_id=?',id,who.organization).first())throw new AppError('Le budget de découverte du jour est atteint.',429);
}
export async function summary(org:string){
 await allocateDue(org);await expireLots(org);
 const now=Date.now();const [wallet,lots,subscription,orders,notifications,invoices,creditNotes]=await Promise.all([
 s('SELECT COALESCE(SUM(CASE WHEN frozen=0 AND starts_at<=? AND (expires_at IS NULL OR expires_at>?) THEN balance-reserved ELSE 0 END),0) available,COALESCE(SUM(reserved),0) reserved,COALESCE(SUM(CASE WHEN frozen=0 AND starts_at<=? AND (expires_at IS NULL OR expires_at>?) THEN granted ELSE 0 END),0) granted FROM credit_lots WHERE organization_id=?',now,now,now,now,org).first<{available:number;reserved:number;granted:number}>(),
 s('SELECT id,source,granted,balance,reserved,starts_at,expires_at,frozen FROM credit_lots WHERE organization_id=? ORDER BY created_at DESC LIMIT 100',org).all<CreditLotSummary>(),currentSubscription(org),
 s('SELECT id,status,amount,currency,product,created_at FROM billing_orders WHERE organization_id=? ORDER BY created_at DESC LIMIT 50',org).all(),
 s('SELECT * FROM billing_notifications WHERE organization_id=? ORDER BY created_at DESC LIMIT 30',org).all(),
 s('SELECT id,number,created_at FROM billing_invoices WHERE organization_id=? ORDER BY created_at DESC LIMIT 50',org).all(),
 s('SELECT id,number,created_at FROM billing_credit_notes WHERE organization_id=? ORDER BY created_at DESC LIMIT 50',org).all()
 ]);
 const terms=subscription?await subscriptionTerms(subscription):null;
 const allocation=subscription?periods(subscription.start_at,subscription.cycle,terms!.credits).find(p=>p.start<=now&&p.end>now):undefined;
 const meters=await s("SELECT COALESCE(SUM(CASE WHEN kind='storage' THEN quantity ELSE 0 END),0) storage,COALESCE(SUM(CASE WHEN kind='transfer' AND created_at>=? THEN quantity ELSE 0 END),0) transfer FROM billing_meter WHERE organization_id=?",now-30*DAY,org).first<{storage:number;transfer:number}>();
 return {wallet:{available:wallet!.available/100,reserved:wallet!.reserved/100,granted:wallet!.granted/100},creditAllowance:terms?.credits||0,lots:lots.results,subscription,nextAllocation:allocation&&allocation.end<subscription!.end_at?allocation.end:null,meters,orders:orders.results,notifications:notifications.results,invoices:invoices.results,creditNotes:creditNotes.results,readiness:releaseReadiness(),asOf:now};
}
export async function reserve(who:BillingIdentity,reference:string,units:number,options:{upToAvailable?:boolean}={}){
 if(!Number.isSafeInteger(units)||units<=0)throw new AppError('Plafond de crédits invalide.');
 await allocateDue(who.organization);
 const prior=await s('SELECT * FROM credit_holds WHERE reference=?',reference).first<CreditHoldRow>();if(prior){if(prior.organization_id!==who.organization)throw new AppError('Réservation invalide.',403);return prior;}
 const now=Date.now(),id=uid(),lots=await s('SELECT id,balance-reserved available FROM credit_lots WHERE organization_id=? AND frozen=0 AND starts_at<=? AND (expires_at IS NULL OR expires_at>?) AND balance>reserved ORDER BY expires_at IS NULL,expires_at,created_at,id',who.organization,now,now).all<{id:string;available:number}>();
 if(options.upToAvailable)units=Math.min(units,lots.results.reduce((sum,lot)=>sum+lot.available,0));
 if(units<=0)throw new AppError('Crédits insuffisants. Rechargez votre portefeuille avant de continuer.',402,'insufficient_credits');
 let left=units;const statements=[s('INSERT INTO credit_holds(id,organization_id,workspace_id,actor,reference,units,created_at) VALUES (?,?,?,?,?,?,?)',id,who.organization,who.tenant,who.user.userId,reference,units,now)];
 for(const lot of lots.results){const n=Math.min(left,lot.available);if(n>0)statements.push(s('INSERT INTO credit_allocations(id,hold_id,lot_id,units,created_at) VALUES (?,?,?,?,?)',uid(),id,lot.id,n,now));left-=n;if(!left)break;}
 if(left>0)throw new AppError('Crédits insuffisants. Rechargez votre portefeuille avant de continuer.',402,'insufficient_credits');
 try{await db().batch(statements);}catch(error){const same=await s('SELECT * FROM credit_holds WHERE reference=? AND organization_id=?',reference,who.organization).first<CreditHoldRow>();if(same)return same;if(String(error).includes('insufficient_credits')||String(error).includes('spend_limit'))throw new AppError('Solde ou plafond modifié. Aucun nouvel appel fournisseur effectué.',402);throw error;}
 return {id,units,status:'reserved',organization_id:who.organization};
}
export async function settleHold(id:string,units:number){
 const hold=await s('SELECT * FROM credit_holds WHERE id=?',id).first<CreditHoldRow>();if(!hold||hold.status==='settled')return;
 if(!Number.isSafeInteger(units)||units<0)throw new AppError('Consommation invalide.');
 const charged=Math.min(units,hold.units),rows=await s('SELECT * FROM credit_allocations WHERE hold_id=? ORDER BY created_at,id',id).all<CreditAllocationRow>();let left=charged;
 const statements=rows.results.map(row=>{const n=Math.min(row.units,left);left-=n;return s("UPDATE credit_allocations SET charged=?,state='settled' WHERE id=? AND state='reserved'",n,row.id);});
 statements.push(s("UPDATE credit_holds SET status='settled',actual=? WHERE id=? AND status!='settled'",charged,id));await db().batch(statements);await expireLots(hold.organization_id);
}
export async function makeQuote(who:BillingIdentity,input:QuoteInput){
 requireBilling(who);const now=Date.now(),version=await subscriptionVersion(who.organization);let p:BillingProduct;
 if(input.kind==='upgrade'){
  await allocateDue(who.organization);
  const sub=await currentSubscription(who.organization);if(!sub)throw new AppError('Abonnement actif requis.',409);
  const target=input.plan||'business';
  const adjustment=upgradeQuote(sub,now,await subscriptionTerms(sub),target),next=upgradePlan(sub,target);
  p={kind:'upgrade',plan:target,cycle:sub.cycle,...adjustment,targetCredits:next.credits,targetContractPrice:(sub.cycle==='annual'?next.annualPrice:next.periodPrice)!,subscriptionId:sub.id,subscriptionRevision:sub.version,currency:'XAF',version:CATALOG_VERSION,credits:0};
 }else p=product(input) as BillingProduct;
 p={...p,...commercialDetails(p.amount)} as BillingProduct;
 const economicsResult=marginCheck(p,economics(p.plan));
 const id=uid(),body={...p,economics:economicsResult};
 await s('INSERT INTO billing_quotes VALUES (?,?,?,?,?,?,?,?,?)',id,who.organization,who.user.userId,JSON.stringify(body),p.amount,CATALOG_VERSION,version,now,now+900000).run();
 return {id,...p,expiresAt:now+900000,eligible:(hostedCheckout()||economicsResult.eligible)&&releaseReadiness().enabled};
}
async function sas<T>(path:string,schema:z.ZodType<T,z.ZodTypeDef,unknown>,body?:unknown):Promise<T>{
 const c=config(),key=c.SASPAY_SECRET_KEY;if(!key)throw new AppError('Paiement non configuré.',503);
 const live=c.SASPAY_ENV==='live';if(!key.startsWith(live?'sk_live_':'sk_test_'))throw new AppError('Environnement de paiement incohérent.',503);
 const response=await fetch('https://api.saspay.me/api/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new AppError('SasPay est indisponible. La commande reste enregistrée.',502,'payment_provider');
 const result=z.object({success:z.boolean().optional(),data:z.unknown().optional()}).passthrough().parse(await response.json());if(result.success===false)throw new AppError('La vérification SasPay a échoué.',502);return schema.parse(result.data??result);
}
export async function checkout(who:BillingIdentity,quoteId:string,key:string,origin:string){
 requireBilling(who);
 const prior=await s('SELECT * FROM billing_orders WHERE organization_id=? AND (idempotency_key=? OR quote_id=?)',who.organization,key,quoteId).first<OrderRow>();
 if(prior){if(prior.quote_id!==quoteId)throw new AppError('Cette clé correspond à une autre commande.',409);return orderView(prior);}
 if(!releaseReadiness().enabled)throw new AppError('Les encaissements ne sont pas encore activés. Aucun paiement ne sera demandé.',503,'billing_not_ready');
 const q=await s('SELECT * FROM billing_quotes WHERE id=? AND organization_id=? AND actor=?',quoteId,who.organization,who.user.userId).first<QuoteRow>();
 if(!q||q.expires_at<=Date.now())throw new AppError('Ce devis a expiré. Demandez un nouveau récapitulatif.',409);
 if(q.subscription_version!==await subscriptionVersion(who.organization))throw new AppError('Votre abonnement a changé. Actualisez le devis.',409);
 const p=JSON.parse(q.product) as BillingProduct;
 if(p.version!==CATALOG_VERSION||q.version!==CATALOG_VERSION)throw new AppError('Le catalogue a changé. Actualisez le devis.',409,'quote_catalog_changed');
 if(p.documentKind==='receipt'){
  if(!hostedCheckout()||p.baseAmount!==q.amount||p.tax!==undefined||p.subtotal!==undefined||p.taxRateBps!==undefined||p.taxMode!==undefined||p.taxJurisdiction!==undefined||JSON.stringify(p.invoiceSeller)!==JSON.stringify({name:'Braand'}))throw new AppError('Le mode de paiement a changé. Actualisez le devis.',409,'quote_changed');
 }else{
  if(hostedCheckout())throw new AppError('Le mode de paiement a changé. Actualisez le devis.',409,'quote_changed');
  validateQuoteTax(p,billingTaxRule());
  if(JSON.stringify(p.invoiceSeller)!==JSON.stringify(billingLegalSeller()))throw new AppError('L’identité de facturation a changé. Actualisez le devis.',409,'quote_legal_changed');
 }
 if(q.amount!==p.total||q.amount!==p.amount)throw new AppError('Montant du devis incohérent.',409,'quote_invalid');
 if(!hostedCheckout()&&!marginCheck(p,economics(p.plan)).eligible)throw new AppError(p.kind==='upgrade'?'Le passage immédiat est indisponible. Choisissez le forfait pour votre prochaine période.':'Cette offre attend sa validation économique.',409,'margin_gate');
 if(p.kind==='upgrade'&&(p.periodEnd<=Date.now()||p.subscriptionEnd<=Date.now()))throw new AppError('Ce devis de changement a expiré. Actualisez votre demande.',409);
 const id=uid(),now=Date.now();
 try{await s("INSERT INTO billing_orders(id,organization_id,quote_id,actor,idempotency_key,status,amount,product,created_at,updated_at,payment_environment) VALUES (?,?,?,?,?,'initializing',?,?,?,?,?)",id,who.organization,quoteId,who.user.userId,key,q.amount,q.product,now,now,config().SASPAY_ENV==='live'?'live':'sandbox').run();}catch(error){const same=await s('SELECT * FROM billing_orders WHERE quote_id=? AND organization_id=?',quoteId,who.organization).first<OrderRow>();if(same)return orderView(same);throw error;}
 try{
  const remote=await sas('checkout-sessions/',checkoutResponseSchema,{amount:q.amount.toFixed(2),currency:'XAF',country:'CM',customer_email:who.user.email,customer_name:who.user.displayName||who.user.email,description:'Braand · '+id,metadata:{braand_order_id:id},fee_charge_mode:'DEDUCTED',return_url:origin+'/?settings=billing&billingOrder='+id,expires_at:new Date(now+1800000).toISOString()});
  const url=new URL(remote.checkout_url);if(url.protocol!=='https:'||!['checkout.saspay.me','pay.saspay.me'].includes(url.hostname)||!remote.id)throw new Error('Invalid checkout');
  if(remote.fee_charge_mode!=='DEDUCTED')throw new Error('Merchant fee mode not verified');
  await s("UPDATE billing_orders SET status='pending',session_id=?,checkout_url=?,updated_at=? WHERE id=?",remote.id,url.href,Date.now(),id).run();
 }catch{await s("UPDATE billing_orders SET status='needs_reconciliation',updated_at=? WHERE id=?",Date.now(),id).run();throw new AppError('La création du paiement doit être vérifiée. Aucun nouvel essai automatique.',502,'needs_reconciliation');}
 return orderView(await s('SELECT * FROM billing_orders WHERE id=?',id).first<OrderRow>());
}
export function orderView(row:OrderRow|null){if(!row)throw new AppError('Commande introuvable.',404);return {id:row.id,status:row.status,amount:row.amount,currency:row.currency,checkoutUrl:row.checkout_url,product:JSON.parse(row.product) as BillingProduct,createdAt:row.created_at};}
export async function reconcileOrder(id:string){
 const order=await s('SELECT * FROM billing_orders WHERE id=?',id).first<OrderRow>();if(!order||['fulfilled','refunded','refund_requested','partially_refunded'].includes(order.status))return order;
 if(!order.payment_environment||order.payment_environment!==(config().SASPAY_ENV==='live'?'live':'sandbox'))throw new AppError('L’environnement de cette commande doit être vérifié avant rapprochement.',409);
 if(!order.session_id){
  // Search the merchant's existing sessions; never issue another create after a timeout.
  let path='checkout-sessions/?currency=XAF';const matches:PaymentSession[]=[];
  for(let page=0;path&&page<5;page++){
   const listing=await sas(path,sessionListSchema);for(const item of listing.results)if(providerOrderId(item)===id)matches.push(item);
   if(!listing.next){path='';break;}const next=new URL(listing.next,'https://api.saspay.me');
   if(next.origin!=='https://api.saspay.me'||!next.pathname.startsWith('/api/v1/checkout-sessions/'))throw new AppError('Pagination fournisseur invalide.',502);
   path=next.pathname.slice('/api/v1/'.length)+next.search;
  }
  if(matches.length!==1||path)return order;
  await s('UPDATE billing_orders SET session_id=?,updated_at=? WHERE id=? AND session_id IS NULL',matches[0].id,Date.now(),id).run();order.session_id=matches[0].id;
 }
 const session=await sas('checkout-sessions/'+encodeURIComponent(order.session_id)+'/',sessionResponseSchema);
 if(session.id!==order.session_id||session.merchant!==config().SASPAY_MERCHANT_ID||providerOrderId(session)!==id||session.currency!=='XAF'||decimalXaf(session.amount)!==order.amount)throw new AppError('Paiement incohérent : rapprochement requis.',409);
 const txid=typeof session.transaction==='string'?session.transaction:session.transaction?.id;
 if(!txid){if(session.status==='EXPIRED'||session.status==='CANCELLED'){await s('UPDATE billing_orders SET status=?,updated_at=? WHERE id=? AND transaction_id IS NULL',session.status.toLowerCase(),Date.now(),id).run();}return order;}
 // /verify refreshes PENDING from the actual gateway. Its documented schema differs from webhook data.
 const tx=await sas('payments/'+encodeURIComponent(txid)+'/verify/',transactionResponseSchema);
 if(tx.id!==txid||tx.merchant!==config().SASPAY_MERCHANT_ID||tx.transaction_type!=='PAIEMENT'||tx.flow_direction!=='INBOUND')throw new AppError('Transaction ou marchand incohérent.',409);
 if(tx.status!=='SUCCESS'){
  if(tx.status==='FAILED'||tx.status==='CANCELLED')await s("UPDATE billing_orders SET status=?,transaction_id=?,updated_at=? WHERE id=? AND status NOT IN ('fulfilled','refunded','refund_requested','partially_refunded')",tx.status.toLowerCase(),txid,Date.now(),id).run();
  return s('SELECT * FROM billing_orders WHERE id=?',id).first<OrderRow>();
 }
 // SasPay can convert a hosted XAF checkout to the selected network's currency.
 // A converted successful transaction is accepted only after the exact merchant,
 // order metadata, checkout session, and linked transaction ID above are verified.
 // Keep the original XAF order amount as the commercial price, and persist the
 // provider's actual amounts and currency below for an auditable payment record.
 const settledAsQuoted=tx.currency==='XAF'&&decimalXaf(tx.requested_amount)===order.amount&&decimalXaf(tx.debited_amount)===order.amount;
 const requested=decimalMinorUnits(tx.requested_amount),debited=decimalMinorUnits(tx.debited_amount);
 const convertedByProvider=convertedCheckoutCurrencies.has(tx.currency||'')&&requested!==undefined&&requested>0&&requested===debited;
 if((!settledAsQuoted&&!convertedByProvider)||tx.fee_charge_mode!=='DEDUCTED')throw new AppError('Montant réellement payé incohérent.',409);
 const verifiedTx={id:tx.id,merchant:tx.merchant,status:tx.status,currency:tx.currency,requestedAmount:tx.requested_amount,charged:tx.debited_amount,net:tx.net_amount,fee:tx.client_fee,feeChargeMode:tx.fee_charge_mode};
 const p=JSON.parse(order.product) as BillingProduct,now=Date.now(),statements:D1PreparedStatement[]=[];
 if(p.kind==='upgrade'&&(p.periodEnd<=now||p.subscriptionEnd<=now)){
  await s("UPDATE billing_orders SET status='needs_reconciliation',transaction_id=?,verified=?,updated_at=? WHERE id=? AND status NOT IN ('fulfilled','refunded','refund_requested','partially_refunded')",txid,JSON.stringify({transaction:verifiedTx,reason:'upgrade_paid_after_period_end'}),now,id).run();return s('SELECT * FROM billing_orders WHERE id=?',id).first<OrderRow>();
 }
 // The claim UPDATE and fulfilment must commit together. Conditional inserts below
 // are anchored to the persisted verified order, never to browser-returned data.
 await s("UPDATE billing_orders SET status='verified',transaction_id=?,verified=?,updated_at=? WHERE id=? AND status NOT IN ('fulfilled','refunded','refund_requested','partially_refunded')",txid,JSON.stringify({session:session.id,transaction:verifiedTx,paidAt:now}),now,id).run();
 const q=await s('SELECT subscription_version FROM billing_quotes WHERE id=?',order.quote_id).first<Pick<QuoteRow,'subscription_version'>>();
 if(q?.subscription_version!==await subscriptionVersion(order.organization_id)){
  await s("UPDATE billing_orders SET status='needs_reconciliation' WHERE id=? AND status!='fulfilled'",id).run();return;
 }
 if(p.kind==='topup'){
  statements.push(s("INSERT OR IGNORE INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,created_at) SELECT ?,organization_id,'topup',id,?,?,?,? FROM billing_orders WHERE id=? AND status='verified'",'topup:'+id,p.credits*100,p.credits*100,now,now,id));
 }else if(p.kind==='subscription'){
  const last=await s("SELECT MAX(end_at) end_at FROM billing_subscriptions WHERE organization_id=? AND status='active'",order.organization_id).first<{end_at:number|null}>();
  const start=Math.max(now,last?.end_at||0),schedule=periods(start,p.cycle,p.credits);
  statements.push(s("INSERT OR IGNORE INTO billing_subscriptions(id,organization_id,plan,catalog_plan,credit_allowance,catalog_version,contract_price,cycle,start_at,end_at,order_id) SELECT ?,organization_id,?,?,?,?,?,?,?,?,id FROM billing_orders WHERE id=? AND status='verified'",'sub:'+id,p.plan==='essential'?'pro':p.plan,p.plan,p.credits,p.version,p.baseAmount??p.amount,p.cycle,start,schedule.at(-1)!.end,id));
 }else if(p.kind==='upgrade'){
  await allocateDue(order.organization_id,now);
  const next=p.version==='2026-10-16.1'?LEGACY_PLANS[p.plan as keyof typeof LEGACY_PLANS]:PLANS[p.plan],allowance=p.targetCredits??next.credits,contractPrice=p.targetContractPrice??(p.cycle==='annual'?next.annualPrice:next.periodPrice);
  if(!Number.isSafeInteger(allowance)||allowance<0||!contractPrice||!Number.isSafeInteger(contractPrice))throw new AppError('Contrat de changement incomplet.',409,'subscription_terms_unknown');
  statements.push(s("UPDATE billing_subscriptions SET plan=?,catalog_plan=?,credit_allowance=?,catalog_version=?,contract_price=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM billing_orders WHERE id=? AND status='verified')",p.plan,p.plan,allowance,p.version,contractPrice,p.subscriptionId,p.subscriptionRevision,id));
  statements.push(s("INSERT OR IGNORE INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,expires_at,created_at) SELECT ?,organization_id,'upgrade',id,?,?,?,?,? FROM billing_orders WHERE id=? AND status='verified'",'upgrade:'+id,p.units,p.units,now,p.periodEnd,now,id));
 }
 const receipt=p.documentKind==='receipt';
 const legal:InvoiceSeller=receipt?{name:'Braand'}:p.invoiceSeller?invoiceSellerSchema.parse(p.invoiceSeller):billingLegalSeller();
 const invoice:InvoiceDocument={seller:legal,buyer:{email:session.customer_email,name:session.customer_name},product:p,documentKind:receipt?'receipt':'invoice',payment:{currency:tx.currency!,amount:tx.debited_amount!},total:order.amount,...(receipt?{}:{subtotal:p.subtotal,tax:p.tax,taxJurisdiction:p.taxJurisdiction,taxBps:p.taxRateBps??economics(p.plan).taxBps}),currency:'XAF',transaction:txid,issuedAt:now};
 statements.push(s("INSERT OR IGNORE INTO billing_invoices SELECT ?,organization_id,id,?,?,? FROM billing_orders WHERE id=? AND status='verified'",'invoice:'+id,(receipt?'BR-REC-':'BR-INV-')+new Date(now).getUTCFullYear()+'-'+id,JSON.stringify(invoice),now,id));
 statements.push(s("INSERT OR IGNORE INTO billing_audit SELECT ?,actor,organization_id,'payment.fulfilled',id,?,? FROM billing_orders WHERE id=? AND status='verified'",'fulfilled:'+id,JSON.stringify({transactionId:txid,amount:order.amount}),now,id));
 statements.push(s("UPDATE billing_orders SET status='fulfilled',updated_at=? WHERE id=? AND status='verified'",now,id));
 await db().batch(statements);await allocateDue(order.organization_id);await auditLog(order.organization_id,'system:billing-reconciliation','billing.fulfilled',id);
 return s('SELECT * FROM billing_orders WHERE id=?',id).first<OrderRow>();
}
export async function requestRefund(who:BillingIdentity,orderId:string,reason:string){
 requireBilling(who);
 if(typeof reason!=='string'||reason.trim().length<10||reason.length>2000)throw new AppError('Précisez le motif du remboursement.');
 const existing=await s("SELECT id,status FROM billing_refunds WHERE order_id=? AND organization_id=? AND status IN ('requested','partially_confirmed','confirmed')",orderId,who.organization).first<{id:string;status:string}>();if(existing)return existing;
 const order=await s("SELECT * FROM billing_orders WHERE id=? AND organization_id=? AND status='fulfilled'",orderId,who.organization).first<OrderRow>();if(!order)throw new AppError('Commande remboursable introuvable.',404);
 const rejected=await s("SELECT id,version FROM billing_refunds WHERE order_id=? AND organization_id=? AND status='rejected' ORDER BY created_at DESC LIMIT 1",orderId,who.organization).first<{id:string;version:number}>();
 const id=rejected?.id||uid(),now=Date.now(),revision=rejected?rejected.version+1:1;
 try{await db().batch([
  rejected?s("UPDATE billing_refunds SET status='requested',reason=?,version=version+1 WHERE id=? AND status='rejected' AND version=?",reason,id,rejected.version):s('INSERT INTO billing_refunds(id,organization_id,order_id,reason,amount,created_at) VALUES (?,?,?,?,?,?)',id,who.organization,orderId,reason,order.amount,now),
  s('UPDATE credit_lots SET frozen=1 WHERE source_id=? AND organization_id=?',orderId,who.organization),
  s('INSERT OR IGNORE INTO billing_audit VALUES (?,?,?,?,?,?,?)','refund-request:'+id+':'+revision,who.user.userId,who.organization,'refund.requested',orderId,JSON.stringify({reason}),now),
  s("UPDATE billing_orders SET status='refund_requested',updated_at=? WHERE id=? AND status='fulfilled'",now,orderId)
 ]);}catch(error){const prior=await s("SELECT id,status FROM billing_refunds WHERE order_id=? AND organization_id=? AND status IN ('requested','partially_confirmed','confirmed')",orderId,who.organization).first<{id:string;status:string}>();if(prior)return prior;throw error;}
 return {id,status:'requested'};
}
export async function tick(){
 const now=Date.now();
 await (await import('./metering')).reconcileOpenRouterUsage(undefined,10);
 const stale=await s("SELECT id FROM runs WHERE status='streaming' AND updated_at<? LIMIT 25",now-600000).all<{id:string}>();
 for(const run of stale.results){
  const claim=await s("UPDATE runs SET status='failed',error='Worker interrompu : reprise requise',updated_at=? WHERE id=? AND status='streaming' AND updated_at<?",now,run.id,now-600000).run();
  if(claim.meta.changes){const hold=await s('SELECT id,units FROM credit_holds WHERE reference=?','chat:'+run.id).first<Pick<CreditHoldRow,'id'|'units'>>();if(hold){const rate=await s('SELECT rate FROM provider_usage WHERE run_id=? LIMIT 1',run.id).first<{rate:string}>();await (await import('./metering')).finishRunBudget({runId:run.id,holdId:hold.id,rate:JSON.parse(rate?.rate||'{}') as ModelRate});}}
 }
 const orgs=await s("SELECT DISTINCT organization_id FROM billing_subscriptions WHERE status='active' AND end_at>?",now-2*DAY).all<{organization_id:string}>();
 for(const {organization_id} of orgs.results){await allocateDue(organization_id,now);await expireLots(organization_id,now);}
 const orders=await s("SELECT id,reconcile_attempts FROM billing_orders WHERE status IN ('initializing','pending','verified','needs_reconciliation','expired','cancelled','failed') AND next_reconcile_at<=? AND reconcile_lease_until<=? ORDER BY next_reconcile_at,created_at,id LIMIT 25",now,now).all<Pick<OrderRow,'id'|'reconcile_attempts'>>();
 for(const {id,reconcile_attempts} of orders.results){
  const lease=Date.now()+90000,claim=await s('UPDATE billing_orders SET reconcile_lease_until=?,reconcile_attempts=reconcile_attempts+1 WHERE id=? AND next_reconcile_at<=? AND reconcile_lease_until<=?',lease,id,now,now).run();if(!claim.meta.changes)continue;
  try{await reconcileOrder(id);}catch{await s("UPDATE billing_orders SET status='needs_reconciliation',updated_at=? WHERE id=? AND status NOT IN ('fulfilled','refunded','refund_requested')",now,id).run();}
  finally{await s('UPDATE billing_orders SET next_reconcile_at=?,reconcile_lease_until=0 WHERE id=? AND reconcile_lease_until=?',Date.now()+Math.min(3600000,30000*2**Math.min(reconcile_attempts,7)),id,lease).run();}
 }
 const subs=await s("SELECT * FROM billing_subscriptions WHERE status='active' AND end_at BETWEEN ? AND ?",now-90*DAY,now+7*DAY).all<SubscriptionRow>();
 for(const sub of subs.results)for(const [kind,at,message] of [['renewal7',sub.end_at-7*DAY,'Votre abonnement arrive à échéance dans sept jours.'],['renewal1',sub.end_at-DAY,'Votre abonnement arrive à échéance demain.'],['expired',sub.end_at,'Votre abonnement a expiré. Vos recharges restent disponibles.'],['retention60',sub.end_at+60*DAY,'Pensez à exporter vos fichiers avant la fin de conservation.'],['retention83',sub.end_at+83*DAY,'La période de conservation de vos fichiers se termine dans sept jours.']] as [string,number,string][]){if(at<=now)await s('INSERT OR IGNORE INTO billing_notifications(id,organization_id,kind,message,created_at) VALUES (?,?,?,?,?)',kind+':'+sub.id,sub.organization_id,kind,message,now).run();}
 return {organizations:orgs.results.length,orders:orders.results.length};
}
