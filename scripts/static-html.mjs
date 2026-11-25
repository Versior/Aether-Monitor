function origins(raw, key) {
  return [...new Set((raw || '').split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error(`${key} must contain HTTP(S) origins`)
    return url.origin
  }))]
}
const escape = value => value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')
export function configureStaticHtml(html, env = {}) {
  const bases=origins(env.API_BASE,'API_BASE'), api=origins(env.CSP_API,'CSP_API'), assets=origins(env.CSP_STATIC,'CSP_STATIC')
  if (!bases.length && !api.length && !assets.length && !env.TITLE && !env.BACKGROUND_IMAGE) return html
  const tags=[]
  const image = env.BACKGROUND_IMAGE && new URL(env.BACKGROUND_IMAGE)
  if (image && (!['http:','https:'].includes(image.protocol) || image.username || image.password)) throw Error('BACKGROUND_IMAGE must be a public HTTP(S) URL')
  if (env.TITLE) html=html.replace(/<title>.*?<\/title>/s,()=>`<title>${escape(env.TITLE)}</title>`)
  const challenge='https://challenges.cloudflare.com'
  const staticOrigins = [...new Set([...bases,...assets,...(image?[image.origin]:[])])]
  const connect=[...new Set([...bases,...api,...bases.map(origin=>origin.replace(/^http/,'ws'))])]
  const csp=["default-src 'self'",`script-src 'self' 'unsafe-inline' ${challenge}`,`style-src 'self' 'unsafe-inline' ${assets.join(' ')}`,`img-src 'self' data: ${staticOrigins.join(' ')}`,`font-src 'self' ${assets.join(' ')}`,`connect-src 'self' ${challenge} ${connect.join(' ')}`,`frame-src ${challenge}`,"object-src 'none'","base-uri 'self'"].join('; ')
  tags.push(`<meta http-equiv="Content-Security-Policy" content="${escape(csp)}">`)
  if (bases.length) tags.push(`<meta name="apiBase" content="${escape(bases.join(','))}">`)
  if (image) tags.push(`<style>body{background-image:url("${image.href.replaceAll('<','%3C').replaceAll('>','%3E').replaceAll('"','%22')}");background-size:cover;background-position:center}</style>`)
  return html.replace(/<head>/i,match=>`${match}\n${tags.join('\n')}`)
}
