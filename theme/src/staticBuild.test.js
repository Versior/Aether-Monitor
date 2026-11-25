import assert from 'node:assert/strict'
import test from 'node:test'
import { configureStaticHtml } from '../../scripts/static-html.mjs'
const html='<html><head><meta charset="utf-8"><title>Project</title></head><body></body></html>'
test('独立页面配置保留多源和受限 CSP；默认同源安装不绑定任何 Worker',()=>{
  assert.equal(configureStaticHtml(html,{}),html)
  const page=configureStaticHtml(html,{API_BASE:'https://a.example,https://b.example',TITLE:'A & B',BACKGROUND_IMAGE:'https://img.example/bg.png',CSP_API:'https://api.example',CSP_STATIC:'https://cdn.example'})
  for(const value of ['A &amp; B','https://a.example,https://b.example','wss://b.example','https://img.example/bg.png','connect-src','https://api.example','https://cdn.example']) assert.ok(page.includes(value),value)
  assert.doesNotMatch(page,/unsafe-eval/); assert.ok(page.indexOf('Content-Security-Policy')<page.indexOf('<title>'))
  assert.throws(()=>configureStaticHtml(html,{API_BASE:'https://ok.example,https://bad.example/some/path'}),/origin/i)
})
