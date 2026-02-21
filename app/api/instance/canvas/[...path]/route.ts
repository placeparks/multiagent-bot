import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getActiveInstance } from '@/lib/get-active-instance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROXY_PREFIX = '/api/instance/canvas'

/** Rewrite root-relative /__openclaw__/ paths in HTML to go through our proxy.
 *  Without this, src="/__openclaw__/canvas/bundle.js" resolves to the Next.js
 *  root and returns 404 instead of going through our proxy route.
 */
function rewriteHtmlPaths(html: string): string {
  return html.replace(/"\/__openclaw__\//g, `"${PROXY_PREFIX}/__openclaw__/`)
}

/** Inject shims into canvas HTML:
 *  1. fetch/XHR interceptor — rewrites dynamic /__openclaw__/ requests through proxy
 *  2. WebSocket interceptor — redirects WS through pairing server's /canvas-ws bridge
 */
function injectBridgeShim(html: string, accessUrl: string): string {
  const wsBase = accessUrl.replace(/^https?:\/\//, 'wss://')
  // WS goes through the pairing server's /canvas-ws handler (port 18800, public URL)
  const wsGateway = `${wsBase}/canvas-ws`
  const shim = `<script>
(function(){
  var PFX='${PROXY_PREFIX}';
  // Rewrite fetch calls with root-relative /__openclaw__/ paths
  var _fetch=window.fetch;
  window.fetch=function(url,opts){
    if(typeof url==='string'&&url.startsWith('/__openclaw__/')){url=PFX+url;}
    return _fetch.call(this,url,opts);
  };
  // Rewrite XHR calls
  var _open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(){
    var args=Array.prototype.slice.call(arguments);
    if(typeof args[1]==='string'&&args[1].startsWith('/__openclaw__/')){args[1]=PFX+args[1];}
    return _open.apply(this,args);
  };
  // WebSocket: redirect through pairing server's WS bridge
  var PROXY='${wsGateway}';
  var _WS=window.WebSocket;
  function ProxiedWS(url,proto){
    var ws=proto?new _WS(PROXY,proto):new _WS(PROXY);
    return ws;
  }
  ProxiedWS.CONNECTING=0;ProxiedWS.OPEN=1;ProxiedWS.CLOSING=2;ProxiedWS.CLOSED=3;
  ProxiedWS.prototype=_WS.prototype;
  window.WebSocket=ProxiedWS;
})();
</script>`
  if (html.includes('</head>')) return html.replace('</head>', shim + '</head>')
  if (html.includes('</body>')) return html.replace('</body>', shim + '</body>')
  return shim + html
}

export async function GET(
  req: Request,
  { params }: { params: { path: string[] } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await getActiveInstance(session.user.email)
  if (!result?.instance) {
    return NextResponse.json({ error: 'No instance found' }, { status: 404 })
  }

  const accessUrl = result.instance.accessUrl?.replace(/\/$/, '')
  if (!accessUrl) {
    return NextResponse.json({ error: 'No public URL for instance' }, { status: 503 })
  }

  // Build upstream URL via the pairing server's /canvas proxy handler (port 18800, public URL).
  // The pairing server strips the /canvas prefix and forwards to the gateway at /__openclaw__/...
  // with the correct Authorization header — so we don't need to send auth here.
  //
  // params.path for "/api/instance/canvas/__openclaw__/canvas/" → ['__openclaw__', 'canvas', '']
  // params.path for "/api/instance/canvas/__openclaw__/canvas"  → ['__openclaw__', 'canvas']
  // For directory-like paths (no file extension), always add trailing slash.
  const segments = params.path ?? []
  const lastSegment = segments[segments.length - 1] ?? ''
  const pathStr = segments.join('/')
  const needsSlash = !lastSegment.includes('.') && !pathStr.endsWith('/')
  const upstreamUrl = `${accessUrl}/canvas/${pathStr}${needsSlash ? '/' : ''}`

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      signal: AbortSignal.timeout(10000),
    })

    const contentType = upstreamRes.headers.get('Content-Type') ?? 'text/html'

    // For HTML responses: rewrite root-relative asset paths + inject shims
    if (contentType.includes('text/html')) {
      const html = await upstreamRes.text()
      const patched = injectBridgeShim(rewriteHtmlPaths(html), accessUrl)
      return new Response(patched, {
        status: upstreamRes.status,
        headers: { 'Content-Type': contentType },
      })
    }

    // For all other assets (CSS, JS, images) stream through verbatim
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: { 'Content-Type': contentType },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Canvas server unreachable', detail: err.message },
      { status: 503 }
    )
  }
}
