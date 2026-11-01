import type { Browser, BrowserContext, Page, Download, Route } from '@cloudflare/playwright';
import type { BrowserCommand, BrowserDriver, BrowserDownload, BrowserObservation, BrowserReceipt } from './browser-contracts';
import { parseBrowserCommand, normalizeBrowserDomains, validateBrowserURL } from './browser-policy.mjs';
import { detectFileType } from './file-policy.mjs';

export { BrowserPolicyError, parseBrowserCommand, normalizeBrowserDomains, validateBrowserURL, browserCommandNeedsApproval } from './browser-policy.mjs';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const ACTION_TIMEOUT = 15_000;
type SDK = Pick<typeof import('@cloudflare/playwright'), 'launch' | 'connect' | 'history'>;
type Handle = { version: 1; providerId: string; domains: string[] };
type ElementDetail = { selector: string; role: string; name: string; inputType?: string; sensitive: boolean; href?: string };
type Snapshot = { title: string; text: string; elements: ElementDetail[]; stateFingerprint: string };
type State = Awaited<ReturnType<BrowserContext['storageState']>>;
type NetworkGrant={postsUntil:number;downloadsUntil:number};
type OwnedSession = {browser: Browser; context: BrowserContext; handle: Handle;network:NetworkGrant};
// Retain the guarded connection. Its incognito context is disposed by Chromium
// on transport loss. A cold HTTP isolate must fail closed; an actual durable
// owner must be verified before enabling this adapter in production.
const owners = new WeakMap<Fetcher, Map<string, OwnedSession>>();
const activePages=new WeakMap<BrowserContext,Page>();

export class BrowserDriverError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code === 'browser_human_required' ? 'Ce champ nécessite le contrôle manuel.' : code === 'browser_stale_observation' ? 'La page a changé. Actualisez son observation.' : 'Le navigateur ne peut pas confirmer cette opération.');
    this.name = 'BrowserDriverError';
  }
}

function handleOf(value: string): Handle {
  try {
    if (value.length > 10_000) throw new Error();
    const result: unknown = JSON.parse(value);
    if (!result || typeof result !== 'object' || !('version' in result) || result.version !== 1 || !('providerId' in result) || typeof result.providerId !== 'string' || !/^[\w-]{1,200}$/.test(result.providerId) || !('domains' in result)) throw new Error();
    return {version: 1, providerId: result.providerId, domains: normalizeBrowserDomains(result.domains)};
  } catch { throw new BrowserDriverError('browser_invalid_session', 400); }
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// URLs and DOM text are hostile data. Query strings/fragments and common credential
// encodings never enter public observations. Input values never leave the page;
// a one-way form-state digest binds approvals to their exact current state.
export function redactBrowserText(value: string): string {
  return value.replace(/\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/gi, '[privé]')
    .replace(/\b(?:sk|pk|api|token|secret|password|authorization|cookie)[-_:= ]+[A-Za-z0-9_+/.=-]{4,}/gi, '[privé]')
    .replace(/\b[A-Za-z0-9_+/=-]{28,}\b/g, '[privé]')
    .replace(/\b(?:otp|pin|one[- ]time(?:\s+code)?|verification\s+code|code(?:\s+(?:de\s+)?(?:vérification|connexion|sécurité))?)[\s:=#-]*\d{4,8}\b/gi, '[privé]')
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, '[privé]')
    .replace(/https?:\/\/[^\s<>]+/g, match => { try { const url = new URL(match); return `${url.origin}${url.pathname.replace(/[A-Za-z0-9_-]{24,}/g, '[privé]')}`; } catch { return '[lien]'; } })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 20_000);
}

function publicURL(value: string): string {
  if (value === 'about:blank') return '';
  const url = new URL(value);
  const path = url.pathname.replace(/[A-Za-z0-9_-]{24,}|\d{4,}/g, '[prive]').replace(/\/(?:token|secret|password|reset|verify|magic|callback|code)(?:\/[^/]*)?/gi, '/[prive]');
  return `${url.origin}${path}`;
}

// This function is fixed application code. Neither clients nor models can supply
// JavaScript, selectors, evaluate expressions, browser methods or CDP commands.
async function collectDOM(): Promise<Snapshot> {
  const sensitive = /pass(?:word)?|mot.?de.?passe|otp|one.?time|secret|token|bearer|api.?key|access.?key|\bcode\b|\bpin\b|\bsms\b|2fa|mfa|verification|credit.?card|card.?number|cc-|cvv|cvc|iban|swift|routing|account.?number|carte|bancaire|cryptogramme|expiry|expiration|payment|paiement/i;
  const selectorFor = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      const parent: Element | null = current.parentElement;
      if (!parent) break;
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${Array.prototype.indexOf.call(parent.children, current) + 1})`);
      current = parent;
    }
    return `html > ${parts.join(' > ')}`;
  };
  const fieldNodes = document.querySelectorAll('input,textarea,select,[contenteditable]');
  const formNodes = document.querySelectorAll('form,button,input[type=submit]');
  if (fieldNodes.length > 1000 || formNodes.length > 1000) throw new Error('Browser document exceeds observation limits');
  const fields = Array.from(fieldNodes);
  const formState = fields.map(element => ({path: selectorFor(element), value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.value : element.textContent, checked: element instanceof HTMLInputElement ? element.checked : undefined, disabled: element.hasAttribute('disabled'), type: element.getAttribute('type'), name: element.getAttribute('name')}));
  const forms = Array.from(formNodes).map(element => ({path: selectorFor(element), action: element.getAttribute('action') || element.getAttribute('formaction'), method: element.getAttribute('method') || element.getAttribute('formmethod')}));
  const privateValues = fields.flatMap(element => {
    const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : '';
    const isSensitive = sensitive.test([element.getAttribute('type'), element.getAttribute('name'), element.getAttribute('autocomplete'), element.id].join(' '));
    return value && (value.length >= 4 || isSensitive) ? [value] : [];
  }).sort((a, b) => b.length - a.length);
  const hideFieldValues = (value: string) => privateValues.reduce((text, privateValue) => text.split(privateValue).join('[privé]'), value);
  let stateFingerprint = '';
  if (formState.length || forms.length) {
    if (!crypto.subtle) throw new Error('Secure browser digest unavailable');
    const serialized = JSON.stringify({formState, forms});
    if (serialized.length > 2_097_152) throw new Error('Browser form exceeds observation limits');
    const stateHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    stateFingerprint = Array.from(new Uint8Array(stateHash), b => b.toString(16).padStart(2, '0')).join('');
  }
  const elements = Array.from(document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[contenteditable=true]')).slice(0, 300).filter(element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }).map(element => {
    const tag = element.tagName.toLowerCase();
    const inputType = element.getAttribute('type')?.toLowerCase() || (tag === 'input' ? 'text' : undefined);
    const labelIds = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const label = labelIds.map(id => document.getElementById(id)?.textContent || '').join(' ') || element.getAttribute('aria-label') || (element instanceof HTMLInputElement ? Array.from(element.labels || []).map(l => l.textContent || '').join(' ') : '') || (tag === 'input' || tag === 'textarea' ? element.getAttribute('placeholder') : element.textContent) || '';
    const isSensitive = sensitive.test([inputType, label, element.id, element.getAttribute('name'), element.getAttribute('autocomplete')].join(' '));
    const role = element.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'combobox' : inputType === 'checkbox' ? 'checkbox' : inputType === 'radio' ? 'radio' : 'textbox');
    return {selector: selectorFor(element), role, name: isSensitive ? '[champ privé — contrôle manuel]' : hideFieldValues(label.trim()).slice(0, 300), inputType, sensitive: isSensitive, href: tag === 'a' ? element.getAttribute('href') || undefined : undefined};
  });
  let text = '';
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null, visited = 0;
    while ((node = walker.nextNode()) && visited++ < 5000 && text.length < 20_000) {
      if (node.parentElement?.closest('script,style,noscript,input,textarea,select,[contenteditable],form,[autocomplete],[data-secret],[data-token]')) continue;
      text += ' ' + (node.nodeValue || '').slice(0, 20_000 - text.length);
    }
  }
  return {title: hideFieldValues(document.title).slice(0, 300), text: hideFieldValues(text.replace(/\s+/g, ' ').trim()).slice(0, 20_000), elements, stateFingerprint};
}

function installPageRestrictions() {
  // Registration is blocked before page code runs, including child frames.
  Object.defineProperty(navigator, 'serviceWorker', {value: undefined, configurable: false});
  Object.defineProperty(window, 'WebSocket', {value: class { constructor() { throw new Error('WebSocket disabled'); } }, configurable: false, writable: false});
}

async function pageIdentity(context: BrowserContext, page: Page): Promise<string> {
  const cdp = await context.newCDPSession(page);
  try { const result = await cdp.send('Target.getTargetInfo'); return `t_${(await digest(result.targetInfo.targetId)).slice(0, 24)}`; }
  finally { await cdp.detach(); }
}

async function readDownload(download: Download, domains: string[]): Promise<BrowserDownload> {
  try { validateBrowserURL(download.url(), domains); }
  catch { await download.cancel(); await download.delete().catch(() => {}); throw new BrowserDriverError('browser_download_destination_blocked', 403); }
  const stream = await download.createReadStream();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = new Uint8Array(chunk);
      size += bytes.byteLength;
      if (size > MAX_BYTES) { await download.cancel(); throw new BrowserDriverError('browser_file_too_large', 413); }
      chunks.push(bytes);
    }
    if (await download.failure()) throw new BrowserDriverError('browser_download_failed');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return {name: download.suggestedFilename().replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180) || 'download', mime: detectFileType(bytes) || 'application/octet-stream', bytes};
  } finally { stream.destroy(); await download.delete().catch(() => {}); }
}

function validateState(raw: string, domains: string[]): State {
  if (new TextEncoder().encode(raw).byteLength > MAX_STATE_BYTES) throw new BrowserDriverError('browser_profile_invalid', 413);
  let state: State;
  try { state = JSON.parse(raw); } catch { throw new BrowserDriverError('browser_profile_invalid', 400); }
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins) || state.cookies.length > 500 || state.origins.length > 50) throw new BrowserDriverError('browser_profile_invalid', 400);
  for (const cookie of state.cookies) {
    if (!cookie || typeof cookie.domain !== 'string' || !cookie.secure || !domains.includes(cookie.domain.replace(/^\./, ''))) throw new BrowserDriverError('browser_profile_scope', 400);
    validateBrowserURL(`https://${cookie.domain.replace(/^\./, '')}`, domains);
  }
  for (const origin of state.origins) { const url = validateBrowserURL(origin.origin, domains); if (url.origin !== origin.origin) throw new BrowserDriverError('browser_profile_invalid', 400); }
  return state;
}

/** Injection exists for offline contract tests; production always uses the SDK. */
export function createBrowserDriver(binding: Fetcher, injectedSDK?: SDK): BrowserDriver {
  const sdk = async (): Promise<SDK> => injectedSDK || await import('@cloudflare/playwright');
  const endpoint = {fetch: binding.fetch.bind(binding) as typeof fetch};
  let sessions = owners.get(binding);
  if (!sessions) { sessions = new Map(); owners.set(binding, sessions); }
  const owned = sessions;

  async function protect(context: BrowserContext, domains: string[],network:NetworkGrant) {
    context.setDefaultTimeout(ACTION_TIMEOUT);
    context.setDefaultNavigationTimeout(20_000);
    const route = async (requestRoute: Route) => {
      try {
        validateBrowserURL(requestRoute.request().url(), domains);
        if(!['GET','HEAD','OPTIONS'].includes(requestRoute.request().method())&&network.postsUntil<Date.now())return await requestRoute.abort('blockedbyclient');
        if (requestRoute.request().headers()['service-worker']) return await requestRoute.abort('blockedbyclient');
        await requestRoute.continue();
      } catch { await requestRoute.abort('blockedbyclient'); }
    };
    await context.route('**/*', route);
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addInitScript(installPageRestrictions);
    await context.clearPermissions();
    const guard = async (page: Page) => {
      page.on('download',download=>{if(network.downloadsUntil<Date.now()){void download.cancel();void download.delete();}});
      await page.route('**/*', route);
      await page.routeWebSocket('**/*', socket => socket.close());
      const cdp = await context.newCDPSession(page);
      try { await cdp.send('Network.setBypassServiceWorker', {bypass: true}); await cdp.send('ServiceWorker.stopAllWorkers'); }
      finally { await cdp.detach(); }
      if (page.url() !== 'about:blank') validateBrowserURL(page.url(), domains);
    };
    context.on('page', page => { void guard(page).catch(() => page.close().catch(() => {})); });
    await Promise.all(context.pages().map(guard));
    return guard;
  }

  async function connected<T>(sessionId: string, fn: (browser: Browser, context: BrowserContext, handle: Handle) => Promise<T>): Promise<T> {
    handleOf(sessionId);
    const owner = owned.get(sessionId);
    if (!owner || !owner.browser.isConnected()) {
      owned.delete(sessionId);
      throw new BrowserDriverError('browser_retained_session_required', 503);
    }
    try {
      return await fn(owner.browser, owner.context, owner.handle);
    } catch (error) { if (error instanceof BrowserDriverError || (error instanceof Error && error.name === 'BrowserPolicyError')) throw error; throw new BrowserDriverError('browser_transport_unknown'); }
  }

  async function choose(context: BrowserContext, pageId?: string): Promise<{page: Page; id: string}> {
    const pages = context.pages();
    const active=activePages.get(context);
    if(!pageId&&active&&pages.includes(active))return {page:active,id:await pageIdentity(context,active)};
    for (const page of pages) { const id = await pageIdentity(context, page); if (!pageId || pageId === id) return {page, id}; }
    throw new BrowserDriverError('browser_page_missing', 404);
  }

  async function observe(context: BrowserContext, domains: string[], pageId?: string): Promise<{observation: BrowserObservation; details: ElementDetail[]}> {
    const {page, id} = await choose(context, pageId);
    if (page.url() !== 'about:blank') validateBrowserURL(page.url(), domains);
    const raw = await page.evaluate(collectDOM);
    const roles = new Set(['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'switch', 'menuitem', 'tab', 'option', 'slider', 'spinbutton']);
    const inputTypes = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password', 'checkbox', 'radio', 'file', 'date', 'time', 'datetime-local', 'color', 'range', 'submit', 'button', 'reset', 'month', 'week']);
    const details = raw.elements.map(element => ({...element, role: roles.has(element.role) ? element.role : 'button', name: element.sensitive ? '[champ privé — contrôle manuel]' : redactBrowserText(element.name), inputType: element.inputType && inputTypes.has(element.inputType) ? element.inputType : undefined}));
    const tabs = await Promise.all(context.pages().map(async tab => {
      if (tab.url() !== 'about:blank') validateBrowserURL(tab.url(), domains);
      return {id: await pageIdentity(context, tab), title: redactBrowserText(await tab.title()).slice(0, 300), url: publicURL(tab.url())};
    }));
    const text = redactBrowserText(raw.text), title = redactBrowserText(raw.title).slice(0, 300);
    const fingerprint = await digest(JSON.stringify({url: page.url(), title, text, details, tabs, form: raw.stateFingerprint}));
    const elements = details.map((element, index) => ({ref: `e${index}_${fingerprint.slice(0, 16)}`, role: element.role, name: element.name, ...(element.inputType ? {inputType: element.inputType} : {})}));
    return {observation: {id: `o_${fingerprint}`, pageId: id, url: publicURL(page.url()), title, text, tabs, elements, fingerprint, capturedAt: Date.now()}, details};
  }

  async function receipt(sessionId:string):Promise<BrowserReceipt>{const handle=handleOf(sessionId);
      try {
        const entry = (await (await sdk()).history(endpoint)).find(item => item.sessionId === handle.providerId);
        if (entry && Number.isFinite(entry.startTime) && Number.isFinite(entry.endTime) && entry.startTime >= 0 && entry.endTime >= entry.startTime && entry.endTime <= Date.now() + 300_000 && entry.endTime - entry.startTime <= 7 * 86_400_000) return {sessionId, status: 'complete', milliseconds: entry.endTime - entry.startTime, source: 'provider_history'};
      } catch { /* Do not fabricate an elapsed-time receipt. */ }
      return {sessionId, status: 'unknown', source: 'provider_history'};
  }

  return {
    receipt,
    async configureNetwork(sessionId,policy){
      const owner=owned.get(sessionId);if(!owner)throw new BrowserDriverError('browser_retained_session_required');
      owner.network.postsUntil=policy.submit!=='deny'&&policy.approvedAction?Date.now()+3000:0;
      owner.network.downloadsUntil=policy.download==='allow'||policy.download==='ask'&&policy.approvedAction?Date.now()+3000:0;
    },
    async humanInput(sessionId,input,pageId){
      await connected(sessionId,async(_browser,context)=>{
        const {page}=await choose(context,pageId);
        if(input.kind==='pointer')await page.mouse.click(input.x,input.y);
        else if(input.kind==='scroll')await page.mouse.wheel(0,input.deltaY);
        else if(input.kind==='key')await page.keyboard.press(input.key);
        else await page.keyboard.insertText(input.text);
      });
    },
    async live(sessionId,emit){
      return connected(sessionId,async(_browser,context)=>{
        let closed=false,changing=false,last=0,busy=false,active:Page|undefined,cdp:Awaited<ReturnType<BrowserContext['newCDPSession']>>|undefined;
        let removeListener:(()=>void)|undefined;
        const detach=async()=>{removeListener?.();if(cdp){await cdp.send('Page.stopScreencast').catch(()=>{});await cdp.detach().catch(()=>{});}cdp=undefined;};
        const attach=async()=>{
          const next=activePages.get(context)||context.pages()[0];if(!next||next===active||changing||closed)return;
          changing=true;await detach();active=next;
          try{
            const connection=await context.newCDPSession(next);cdp=connection;let frameURL='';
            const listener=(frame:{sessionId:number;data:string})=>{
              void connection.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});
              if(closed||busy||Date.now()-last<100||frame.data.length>3_000_000)return;
              busy=true;last=Date.now();
              void (async()=>{
                const url=next.url();if(url!=='about:blank')validateBrowserURL(url,handleOf(sessionId).domains);
                let image=frame.data;
                if(url!==frameURL){const bytes=await next.screenshot({type:'jpeg',quality:65});let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));image=btoa(raw);}
                const title=redactBrowserText(await next.title()).slice(0,300);
                if(closed||active!==next||next.url()!==url)return;frameURL=url;
                const size=next.viewportSize()||{width:1280,height:720};emit({image,url:url==='about:blank'?'':publicURL(url),title,width:size.width,height:size.height});
              })().catch(()=>{}).finally(()=>{busy=false;});
            };
            connection.on('Page.screencastFrame',listener);removeListener=()=>connection.off('Page.screencastFrame',listener);
            await connection.send('Page.startScreencast',{format:'jpeg',quality:65,maxWidth:1280,maxHeight:720,everyNthFrame:1});
          }catch{active=undefined;await detach();throw new BrowserDriverError('browser_live_unavailable');}finally{changing=false;}
        };
        await attach();const timer=setInterval(()=>{void attach().catch(()=>{});},300);
        return {async close(){if(closed)return;closed=true;clearInterval(timer);await detach();}};
      });
    },
    async loginTarget(sessionId,method){
      return connected(sessionId,async(_browser,context,handle)=>{
        const {page,id}=await choose(context);const url=validateBrowserURL(page.url(),handle.domains);
        const field=page.locator(method==='otp'?'input[autocomplete="one-time-code"]:visible':'input[type="password"]:visible');
        if(await field.count()!==1||!await field.isEnabled())throw new BrowserDriverError('browser_login_field_not_ready');
        const formAction=await field.evaluate(element=>{const form=(element as HTMLInputElement).form;return form?.action||location.href;});
        if(new URL(formAction).origin!==url.origin)throw new BrowserDriverError('browser_login_origin_mismatch');
        return {origin:url.origin,pageId:id,method};
      });
    },
    async fillLogin(sessionId,target,secret){
      await connected(sessionId,async(_browser,context,handle)=>{
        const {page}=await choose(context,target.pageId),url=validateBrowserURL(page.url(),handle.domains);
        if(url.origin!==target.origin)throw new BrowserDriverError('browser_login_origin_mismatch');
        const field=page.locator(target.method==='otp'?'input[autocomplete="one-time-code"]:visible':'input[type="password"]:visible');
        if(await field.count()!==1||!await field.isEnabled())throw new BrowserDriverError('browser_login_field_not_ready');
        const formAction=await field.evaluate(element=>(element as HTMLInputElement).form?.action||location.href);
        if(new URL(formAction).origin!==target.origin)throw new BrowserDriverError('browser_login_origin_mismatch');
        if(target.method==='password'){
          if(!secret.password)throw new BrowserDriverError('browser_login_field_not_ready');
          const username=page.locator('input[autocomplete="username"]:visible, input[type="email"]:visible');
          if(secret.username&&await username.count()===1)await username.fill(secret.username);
          await field.fill(secret.password);
        }else{if(!secret.code)throw new BrowserDriverError('browser_login_field_not_ready');await field.fill(secret.code);}
        // Deliberately no click/submit. Returning control never approves an external action.
      });
    },
    async open(input) {
      const domains = normalizeBrowserDomains(input.allowedDomains);
      const state = input.storageState ? validateState(input.storageState, domains) : undefined;
      const provider = await sdk();
      const browser = await provider.launch(endpoint, {guardrails: {allowedDomains: domains}, keep_alive: 60_000});
      try {
        const providerId = browser.sessionId();
        if (!providerId || !/^[\w-]{1,200}$/.test(providerId)) throw new BrowserDriverError('browser_invalid_session');
        const context = await browser.newContext({serviceWorkers: 'block', acceptDownloads: true, viewport:{width:1280,height:720}, ...(state ? {storageState: state} : {})});
        const network={postsUntil:0,downloadsUntil:0};
        const guard = await protect(context, domains,network);
        if (!context.pages().length) { const page = await context.newPage(); await guard(page); }
        const result = JSON.stringify({version: 1, providerId, domains} satisfies Handle);
        owned.set(result, {browser, context, handle: {version: 1, providerId, domains},network});
        return {sessionId: result};
      } catch (error) {
        try { const cdp = await browser.newBrowserCDPSession(); await cdp.send('Browser.close'); } catch { /* Unknown acknowledgement. */ }
        await browser.close().catch(() => {});
        if (error instanceof BrowserDriverError) throw error;
        throw new BrowserDriverError('browser_transport_unknown');
      }
    },
    async observe(sessionId, pageId) { return connected(sessionId, async (_browser, context, handle) => (await observe(context, handle.domains, pageId)).observation); },
    async command(sessionId, input, file) {
      const command = parseBrowserCommand(input) as BrowserCommand;
      const handle = handleOf(sessionId);
      if (command.kind === 'navigate' || command.kind === 'new_tab') validateBrowserURL(command.url, handle.domains);
      if (file && (file.bytes.byteLength > MAX_BYTES || !file.bytes.byteLength)) throw new BrowserDriverError('browser_file_too_large', 413);
      return connected(sessionId, async (_browser, context) => {
        let {page, id} = await choose(context, command.pageId);
        if (command.kind === 'pointer' || command.kind === 'type') {
          // The service authorizes these only in exclusive human mode. Never
          // observe, capture, store or echo authentication text here.
          if (command.kind === 'pointer') await page.mouse.click(command.x!, command.y!);
          else await page.keyboard.insertText(command.value!);
          return {observation: {id: 'human_private', pageId: id, url: '', title: '', text: '', tabs: [], elements: [], fingerprint: '', capturedAt: Date.now()}};
        }
        let current: Awaited<ReturnType<typeof observe>> | undefined;
        if (command.observationId || command.targetRef) {
          current = await observe(context, handle.domains, id);
          if (current.observation.id !== command.observationId) throw new BrowserDriverError('browser_stale_observation');
        }
        const index = current?.observation.elements.findIndex(element => element.ref === command.targetRef) ?? -1;
        const target = index >= 0 ? current!.details[index] : undefined;
        if (command.targetRef && !target) throw new BrowserDriverError('browser_stale_observation');
        if (target?.sensitive) throw new BrowserDriverError('browser_human_required');
        if (target?.href && command.kind === 'click') validateBrowserURL(new URL(target.href, page.url()).href, handle.domains);
        const downloads: Download[] = [];
        const downloadHandler = (download: Download) => { downloads.push(download); };
        page.on('download', downloadHandler);
        try {
          switch (command.kind) {
            case 'navigate': await page.goto(command.url!, {waitUntil: 'domcontentloaded'}); break;
            case 'new_tab': page = await context.newPage(); activePages.set(context,page); id = await pageIdentity(context, page); await page.goto(command.url!, {waitUntil: 'domcontentloaded'}); break;
            case 'select_tab': activePages.set(context,page); await page.bringToFront(); break;
            case 'close_tab': await page.close(); if (!context.pages().length) await context.newPage(); ({id} = await choose(context)); break;
            case 'scroll': await page.mouse.wheel(0, command.deltaY!); break;
            case 'click': await page.locator(target!.selector).click(); break;
            case 'fill': await page.locator(target!.selector).fill(command.value!); break;
            case 'press': await page.locator(target!.selector).press(command.key!); break;
            case 'select': await page.locator(target!.selector).selectOption(command.value!); break;
            case 'upload':
              if (!file) throw new BrowserDriverError('browser_file_missing', 400);
              await page.locator(target!.selector).setInputFiles({name: file.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180), mimeType: file.mime, buffer: Buffer.from(file.bytes)});
              break;
          }
          const download = downloads[0] ? await readDownload(downloads[0], handle.domains) : undefined;
          for (const extra of downloads.slice(1)) { await extra.cancel(); await extra.delete(); }
          const observation = (await observe(context, handle.domains, id)).observation;
          return {observation, ...(download ? {download} : {})};
        } finally { page.off('download', downloadHandler); }
      });
    },
    async capture(sessionId, pageId) {
      return connected(sessionId, async (_browser, context) => {
        const {page} = await choose(context, pageId);
        return new Uint8Array(await page.screenshot({type: 'png', fullPage: false, mask: [page.locator('input,textarea,[contenteditable]'),page.locator('body:has(input[type=password]),body:has(input[autocomplete=one-time-code])')]}));
      });
    },
    async storageState(sessionId) { return connected(sessionId, async (_browser, context, handle) => {
      const raw = JSON.stringify(await context.storageState({indexedDB: true}));
      validateState(raw, handle.domains);
      return raw;
    }); },
    async close(sessionId): Promise<BrowserReceipt> {
      const handle = handleOf(sessionId);
      let browser: Browser | undefined;
      let disconnectOnly = false;
      const owner = owned.get(sessionId);
      owned.delete(sessionId);
      try {
        if (owner?.browser.isConnected()) {
          browser = owner.browser;
          await browser.close(); // launch() installs the real provider close.
        } else {
          browser = await (await sdk()).connect(endpoint, {sessionId: handle.providerId});
          disconnectOnly = true;
          const cdp = await browser.newBrowserCDPSession();
          // connect().close() merely disconnects in 1.3.6. CDP Browser.close
          // really terminates the provider session, including all its contexts.
          await cdp.send('Browser.close').catch(() => {});
        }
      } catch { /* Reconciliation below is the only billing authority. */ }
      finally { if (disconnectOnly) await browser?.close().catch(() => {}); }
      return receipt(sessionId);
    },
  };
}
