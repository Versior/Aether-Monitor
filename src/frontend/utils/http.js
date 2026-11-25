export async function requestJson(fetcher, base, path, { headers = {}, body, onResponseDate } = {}) {
  const endpoint = path.split('?')[0]
  let response
  try {
    response = await fetcher(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include', redirect: 'error',
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    })
  } catch (cause) {
    throw Object.assign(new Error(`${endpoint}: ${cause.message}`, { cause }), { status: 0, base, path })
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const rayId = response.status >= 500 && response.headers.get('cf-ray')
    const reason = data?.error || data?.message || response.statusText
    throw Object.assign(new Error(`${endpoint} (${response.status}): ${reason}${rayId ? ` · Ray ID ${rayId}` : ''}`), { status: response.status, base, path })
  }
  if (onResponseDate) {
    const date = Date.parse(response.headers.get('date'))
    if (Number.isFinite(date)) onResponseDate(date)
  }
  try {
    const result = await response.json()
    if (result === null) throw new Error('null')
    return result
  } catch (cause) {
    throw Object.assign(new Error(`${endpoint}: invalid JSON response`, { cause }), { status: response.status, base, path })
  }
}
