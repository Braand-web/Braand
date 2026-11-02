// Preserve streaming bodies, Set-Cookie and stricter route-level policies.
export function secureResponse(response, request) {
 if(response.status===101)return response; // WebSocket upgrades carry a socket.
 const headers=new Headers(response.headers);
 const defaults={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(self), geolocation=(), payment=()',
  'Content-Security-Policy':"base-uri 'self'; object-src 'none'; frame-ancestors 'self'",
 };
 if(new URL(request.url).protocol==='https:')defaults['Strict-Transport-Security']='max-age=15552000';
 for(const [key,value] of Object.entries(defaults))if(!headers.has(key))headers.set(key,value);
 if(!response.headers.has('Content-Security-Policy')&&!headers.has('X-Frame-Options'))headers.set('X-Frame-Options','SAMEORIGIN');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
