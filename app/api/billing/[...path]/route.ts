import {privateJSON} from '@/lib/private-json';
import {z} from 'zod';
import {identity,db,failure} from '@/lib/server';
import {AppError} from '@/lib/core.mjs';
import {catalog,summary,makeQuote,checkout,orderView,reconcileOrder,requestRefund,claimFree,requireBilling} from '@/lib/billing';
import {organizationSummary,changeOrganization,acceptInvite} from '@/lib/organizations';
import {topupPrice,CATALOG_VERSION} from '@/lib/billing-core.mjs';
import {invoiceHTML} from '@/lib/invoice';
import {creditNoteHTML} from '@/lib/credit-note';
import type {InvoiceDocument,OrderRow} from '@/lib/billing-types';
type Context={params:Promise<{path:string[]}>};
export async function GET(request:Request,context:Context){try{
 const {path}=await context.params,key=path[0];
 if(key==='catalog')return Response.json(catalog(),{headers:{'Cache-Control':'no-store'}});
 if(key==='price'){const quantity=Number(new URL(request.url).searchParams.get('quantity'));return Response.json({quantity,amount:topupPrice(quantity),currency:'XAF',version:CATALOG_VERSION});}
 const who=await identity(request);
 if(key==='summary'){const data=await summary(who.organization);if(who.role!=='owner'){data.orders=[];data.invoices=[];data.creditNotes=[];}return Response.json(data);}
 if(key==='organization')return Response.json(await organizationSummary(who));
 if(key==='orders'&&path[1]){
  requireBilling(who);let order=await db().prepare('SELECT * FROM billing_orders WHERE id=? AND organization_id=?').bind(path[1],who.organization).first<OrderRow>();
  if(!order)throw new AppError('Commande introuvable.',404);
  if(new URL(request.url).searchParams.get('verify')==='true'){await reconcileOrder(order.id);order=await db().prepare('SELECT * FROM billing_orders WHERE id=?').bind(order.id).first<OrderRow>();}
  return Response.json(orderView(order));
 }
 if(key==='usage'){
  if(!['owner','admin'].includes(who.role))return Response.json({entries:[],daily:[],restricted:true,asOf:Date.now()});
  const now=Date.now(),before=Number(new URL(request.url).searchParams.get('before'))||now+1,today=new Date(now),from=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()-29);
  const [rows,daily]=await Promise.all([
   db().prepare('SELECT id,kind,units,reference,created_at FROM credit_ledger WHERE organization_id=? AND created_at<? ORDER BY created_at DESC,id LIMIT 100').bind(who.organization,before).all(),
   db().prepare("SELECT date(created_at/1000,'unixepoch') day,COALESCE(SUM(units),0) units FROM credit_ledger WHERE organization_id=? AND kind='consume' AND created_at>=? AND created_at<? GROUP BY date(created_at/1000,'unixepoch') ORDER BY day").bind(who.organization,from,before).all()
  ]);return Response.json({entries:rows.results,daily:daily.results,restricted:false,asOf:now});
 }
 if(key==='invoices'&&path[1]){
  requireBilling(who);const row=await db().prepare('SELECT * FROM billing_invoices WHERE id=? AND organization_id=?').bind(path[1],who.organization).first<{number:string;document:string}>();if(!row)throw new AppError('Facture introuvable.',404);
  const document=JSON.parse(row.document) as InvoiceDocument;
  return new Response(invoiceHTML(row.number,document),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':`attachment; filename="${document.documentKind==='receipt'?'recu':'facture'}-braand.html"`,'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'Cache-Control':'private, no-store'}});
 }
 if(key==='credit-notes'&&path[1]){
  requireBilling(who);const row=await db().prepare('SELECT n.number,n.document,t.tax,t.subtotal FROM billing_credit_notes n LEFT JOIN billing_credit_note_taxes t ON t.credit_note_id=n.id WHERE n.id=? AND n.organization_id=?').bind(path[1],who.organization).first<{number:string;document:string;tax:number|null;subtotal:number|null}>();if(!row)throw new AppError('Avoir introuvable.',404);
  return new Response(creditNoteHTML(row.number,{...JSON.parse(row.document),...(row.tax!==null?{tax:row.tax,subtotal:row.subtotal}:{})}),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="avoir-braand.html"','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'Cache-Control':'private, no-store'}});
 }
 throw new AppError('Route introuvable.',404);
 }catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
 const who=await identity(request),{path}=await context.params,body=await privateJSON(request,1048576);
 if(path[0]==='quotes'){
  const p=z.discriminatedUnion('kind',[z.object({kind:z.literal('topup'),quantity:z.number().int().refine(value=>[50,125,300].includes(value))}),z.object({kind:z.literal('subscription'),plan:z.enum(['essential','pro','business']),cycle:z.enum(['period','annual'])}),z.object({kind:z.literal('upgrade'),plan:z.enum(['essential','pro','business']).optional()})]).parse(body);
  return Response.json(await makeQuote(who,p),{status:201});
 }
 if(path[0]==='checkout'){
  const p=z.object({quoteId:z.string().uuid(),idempotencyKey:z.string().uuid()}).parse(body);return Response.json(await checkout(who,p.quoteId,p.idempotencyKey,new URL(request.url).origin));
 }
 if(path[0]==='free'){await claimFree(who);return Response.json(await summary(who.organization));}
 if(path[0]==='refund-requests'){
  const p=z.object({orderId:z.string().uuid(),reason:z.string().trim().min(10).max(2000)}).parse(body);return Response.json(await requestRefund(who,p.orderId,p.reason),{status:201});
 }
 if(path[0]==='plan-changes'){
  const p=z.object({plan:z.enum(['essential','pro','business']),cycle:z.enum(['period','annual']),immediate:z.boolean().default(false)}).parse(body);
  return Response.json(await makeQuote(who,p.immediate?{kind:'upgrade',plan:p.plan}:{kind:'subscription',plan:p.plan,cycle:p.cycle}));
 }
 if(path[0]==='organization'){
  const p=z.discriminatedUnion('action',[
   z.object({action:z.literal('space'),name:z.string().trim().min(1).max(100)}),
   z.object({action:z.literal('invite'),email:z.string().email(),role:z.enum(['admin','editor','approver','reader']),spaces:z.array(z.string()).min(1).max(5)}),
   z.object({action:z.literal('revoke'),userId:z.string().min(1).max(200)}),
   z.object({action:z.literal('limit'),scope:z.enum(['organization','workspace','member']),scopeId:z.string(),credits:z.number().min(0).max(1000000)})
  ]).parse(body);return Response.json(await changeOrganization(who,p));
 }
 if(path[0]==='accept-invite'){const {token}=z.object({token:z.string().max(200)}).parse(body);return Response.json(await acceptInvite(who,token));}
 throw new AppError('Route introuvable.',404);
 }catch(error){return failure(error);}}
