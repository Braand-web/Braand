import {z} from "zod";
export const pageSchema=z.object({
 title:z.string().min(1).max(160),description:z.string().max(500),accent:z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#3b82f6"),
 sections:z.array(z.object({type:z.enum(["hero","benefits","proof","faq","cta"]),heading:z.string().max(200),body:z.string().max(4000),items:z.array(z.string().max(500)).max(12).optional()})).min(1).max(15),
 cta:z.object({label:z.string().min(1).max(80),url:z.string().url().refine(v=>v.startsWith("https://"))}),noindex:z.boolean().default(true)
});
export const proposalSchema=z.object({kind:z.enum(["media","campaign","assembly","media_plan"]),title:z.string().min(1).max(160),rationale:z.string().max(3000),maxCredits:z.number().int().positive().max(100000),payload:z.record(z.unknown())});
export const missionSchema=z.object({title:z.string().min(1).max(160),objective:z.string().min(1).max(3000),steps:z.array(z.string().max(500)).min(1).max(20),successCriteria:z.array(z.string()).min(1).max(10),maxCredits:z.number().int().min(0),stopConditions:z.array(z.string()).min(1),mode:z.enum(["accompanied","autonomous"]).default("accompanied")});
export type PageContent=z.infer<typeof pageSchema>;
export type Resource={id:string;workspace_id:string;kind:string;title:string;data:Record<string,unknown>;status:string;version:number;created_at:number;updated_at:number};
export type FileRecord={id:string;workspace_id:string;owner_id:string|null;legacy_resource_id:string|null;display_name:string;storage_name:string;size_bytes:number;detected_mime:string;sha256:string|null;status:string;storage_key:string|null;thumbnail_key:string|null;extraction_key:string|null;created_at:number;updated_at:number;deleted_at:number|null};
export type Message={id:string;role:string;content:unknown;created_at:number};

