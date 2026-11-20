/**
 * Erinnerungsdienst unter der Adresse der App (…/svc/…) – für andere Familien, damit sie die
 * Adresse des Betreibers nie sehen. Leitet intern per Service-Binding an den Worker weiter;
 * die echte Absender-IP (cf-connecting-ip) bleibt dabei erhalten (für das Anmeldelimit).
 */
interface Env { SERVICE?: { fetch: (r: Request) => Promise<Response> } }

export const onRequest = async ({ request, env, params }: { request: Request; env: Env; params: { path?: string | string[] } }) => {
  if (!env.SERVICE) return new Response('Dienst nicht verbunden', { status: 503 });
  const url = new URL(request.url);
  const path = '/' + [params.path ?? []].flat().map(encodeURIComponent).join('/');
  const headers = new Headers(request.headers);
  headers.set('x-fk-base', `${url.origin}/svc`);
  const init: RequestInit = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  const res = await env.SERVICE.fetch(new Request(`https://dienst.intern${path}${url.search}`, init));
  return new Response(res.body, res);
};
