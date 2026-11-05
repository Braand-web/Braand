import {z} from 'zod';

export type PlanName='essential'|'pro'|'business'|'enterprise';
export type BillingCycle='period'|'annual';
export type QuoteInput={kind:'topup';quantity:number}|{kind:'subscription';plan:PlanName;cycle:BillingCycle}|{kind:'upgrade';plan?:PlanName};
export type TaxRule={mode:'exclusive'|'inclusive';rateBps:number;jurisdiction:string;version:string;validatedAt:string};
export type TaxQuote={baseAmount:number;subtotal:number;tax:number;total:number;taxMode:'exclusive'|'inclusive';taxRateBps:number;taxJurisdiction:string;taxConfigVersion:string;taxValidatedAt:string};
type ProductBase={amount:number;currency:string;version:string;invoiceSeller?:InvoiceSeller;documentKind?:'invoice'|'receipt'}&Partial<TaxQuote>;
export type BillingProduct=ProductBase & (
  {kind:'topup';quantity:number;credits:number;plan?:never;cycle?:never}|
  {kind:'subscription';plan:PlanName;cycle:BillingCycle;credits:number}|
  {kind:'upgrade';plan:PlanName;cycle:BillingCycle;credits:0;units:number;periodEnd:number;subscriptionEnd:number;remainingCredits:number;serviceMonths:number;subscriptionId:string;subscriptionRevision:number;targetCredits?:number;targetContractPrice?:number}
);
export type SubscriptionRow={id:string;organization_id:string;plan:PlanName;catalog_plan?:PlanName|null;credit_allowance?:number|null;catalog_version?:string|null;contract_price?:number|null;cycle:BillingCycle;start_at:number;end_at:number;version:number;status:string;order_id:string};
export type QuoteRow={id:string;organization_id:string;actor:string;product:string;amount:number;version:string;subscription_version:string;created_at:number;expires_at:number};
export type OrderRow={id:string;organization_id:string;quote_id:string;actor:string;idempotency_key:string;status:string;amount:number;currency:string;product:string;session_id:string|null;checkout_url:string|null;transaction_id:string|null;verified:string|null;created_at:number;updated_at:number;payment_environment:'sandbox'|'live'|null;reconcile_attempts:number;next_reconcile_at:number;reconcile_lease_until:number};
export type CreditHoldRow={id:string;organization_id:string;workspace_id:string;actor:string;reference:string;units:number;actual:number|null;status:string;created_at:number};
export type CreditAllocationRow={id:string;hold_id:string;lot_id:string;units:number;charged:number;state:string;created_at:number};
export type CreditLotSummary={id:string;source:string;granted:number;balance:number;reserved:number;starts_at:number;expires_at:number|null;frozen:number};
export type Economics=Partial<{taxBps:number;feeBps:number;feeFixed:number;unitCost:number;monthlyServiceCost:number;riskBps:number}>;
export type InvoiceSeller={name?:string;address?:string;taxId?:string;email?:string};
export type InvoiceDocument={seller:InvoiceSeller;buyer:{name?:string;email?:string};product:BillingProduct;documentKind?:'invoice'|'receipt';payment?:{currency:string;amount:string|number};total:number;subtotal?:number;tax?:number;taxJurisdiction?:string;currency:string;transaction:string;taxBps?:number;issuedAt:number};

// Only fields consumed by billing are interpreted; extra provider fields survive parsing.
const amount=z.union([z.string(),z.number()]);
export const checkoutResponseSchema=z.object({id:z.string(),checkout_url:z.string(),fee_charge_mode:z.string().optional()}).passthrough();
export const sessionResponseSchema=z.object({
  id:z.string(),merchant:z.string().optional(),metadata:z.object({braand_order_id:z.string().optional()}).passthrough().nullish(),currency:z.string().optional(),amount:amount.optional(),
  transaction:z.union([z.string(),z.object({id:z.string().optional()}).passthrough()]).nullish(),status:z.string().optional(),customer_email:z.string().optional(),customer_name:z.string().optional(),
}).passthrough();
export type PaymentSession=z.infer<typeof sessionResponseSchema>;
export const sessionListSchema=z.object({results:z.array(sessionResponseSchema).default([]),next:z.string().nullish()}).passthrough();
export const transactionResponseSchema=z.object({
  id:z.string(),merchant:z.string(),transaction_type:z.string(),flow_direction:z.string(),status:z.string(),currency:z.string().optional(),requested_amount:amount.optional(),debited_amount:amount.optional(),fee_charge_mode:z.string().optional(),net_amount:amount.nullish(),client_fee:amount.nullish(),
}).passthrough();
