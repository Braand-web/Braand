// Render printable HTML to PDF with Cloudflare Browser Rendering (Chromium),
// the same way a browser prints: real typography, images, links and page numbers.
import {env} from 'cloudflare:workers';
import {AppError} from './core.mjs';
import {PRINT_FOOTER} from './print-document.mjs';

type PdfPage={setContent(html:string,options:{waitUntil:'networkidle'|'load';timeout:number}):Promise<void>;pdf(options:Record<string,unknown>):Promise<Uint8Array>;setViewportSize(size:{width:number;height:number}):Promise<void>;screenshot(options:Record<string,unknown>):Promise<Uint8Array>};
type PdfBrowser={newPage():Promise<PdfPage>;close():Promise<void>};
type Launch=(endpoint:{fetch:typeof fetch})=>Promise<PdfBrowser>;

export function printEngineReady(){return !!(env as unknown as {BROWSER?:unknown}).BROWSER;}

/** Render HTML to PDF bytes. `launch` is injectable for offline tests. */
export async function renderPrintPdf(html:string,options:{small?:boolean;slides?:boolean}={},launch?:Launch){
 const binding=(env as unknown as {BROWSER?:Fetcher}).BROWSER;
 if(!binding&&!launch)throw new AppError('Le moteur de mise en page n’est pas disponible.',503,'print_engine_unavailable');
 const start=launch||((await import('@cloudflare/playwright')).launch as unknown as Launch);
 const browser=await start(binding?{fetch:binding.fetch.bind(binding) as typeof fetch}:{fetch});
 try{
  const page=await browser.newPage();
  await page.setContent(html,{waitUntil:'networkidle',timeout:45000});
  const bytes=await page.pdf({preferCSSPageSize:true,printBackground:true,displayHeaderFooter:true,headerTemplate:'<div></div>',footerTemplate:PRINT_FOOTER,margin:options.slides?{top:'0',bottom:'0',left:'0',right:'0'}:options.small?{top:'16mm',bottom:'18mm',left:'15mm',right:'15mm'}:{top:'22mm',bottom:'24mm',left:'20mm',right:'20mm'},tagged:true,outline:true});
  if(!(bytes instanceof Uint8Array)||bytes.length<100)throw new AppError('Le PDF n’a pas pu être produit.',502,'print_failed');
  return bytes;
 }finally{await browser.close().catch(()=>undefined);}
}

/** Render a designed visual to PNG at its exact pixel size. */
export async function renderVisualPng(html:string,width:number,height:number,launch?:Launch){
 const binding=(env as unknown as {BROWSER?:Fetcher}).BROWSER;
 if(!binding&&!launch)throw new AppError('Le moteur de rendu n’est pas disponible.',503,'print_engine_unavailable');
 const start=launch||((await import('@cloudflare/playwright')).launch as unknown as Launch);
 const browser=await start(binding?{fetch:binding.fetch.bind(binding) as typeof fetch}:{fetch});
 try{
  const page=await browser.newPage();
  await page.setViewportSize({width,height});
  await page.setContent(html,{waitUntil:'networkidle',timeout:30000});
  const bytes=await page.screenshot({type:'png',fullPage:false});
  if(!(bytes instanceof Uint8Array)||bytes.length<1000)throw new AppError('Le visuel n’a pas pu être produit.',502,'print_failed');
  return bytes;
 }finally{await browser.close().catch(()=>undefined);}
}
