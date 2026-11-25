let loading

export function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve()
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = resolve
    script.onerror = error => { loading = null; script.remove(); reject(error) }
    document.head.appendChild(script)
  })
  return loading
}
