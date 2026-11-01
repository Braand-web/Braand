import {z} from 'zod';
const common={enabled:z.boolean().default(false),verified:z.boolean().default(false),verifiedAt:z.string().datetime().optional()};
const settingsSchema=z.object({version:z.literal(1),browserbase:z.object({...common,apiKey:z.string().min(16),mode:z.literal('free_only'),liveVerified:z.boolean().default(false),maxSessionSeconds:z.number().int().min(60).max(900).default(300),maxBrowserMinutes:z.number().positive().max(60).default(60)}).strict().optional(),firecrawl:z.object({...common,apiKey:z.string().min(16),mode:z.literal('free_only'),maxCredits:z.number().int().positive().max(1000).default(900)}).strict().optional()}).strict();
export type WebProviderSettings=z.infer<typeof settingsSchema>;
export function webProviderSettings(env:{WEB_PROVIDERS_JSON?:string}):WebProviderSettings{
 if(!env.WEB_PROVIDERS_JSON)return {version:1};
 try{return settingsSchema.parse(JSON.parse(env.WEB_PROVIDERS_JSON));}catch{throw new Error('web_provider_configuration_invalid');}
}
export function firecrawlConfigured(env:{WEB_PROVIDERS_JSON?:string}){try{const p=webProviderSettings(env).firecrawl;return !!p?.enabled&&p.verified;}catch{return false;}}
