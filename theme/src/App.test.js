import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { compile, computed, createSSRApp, defineAsyncComponent, h, nextTick, reactive, ref, watch } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { adminUrl as siteAdminUrl, createSiteAccess } from './siteAccess.js'
import { createMonitorSession } from './monitorSession.js'
import { createPreferencesController } from './themePreferences.js'
import { displayRules, filterNodes, initialFilters } from './dashboardView.js'
import { isServerOnline } from '../../src/frontend/utils/api.js'
import { t, locale, resolveLocale } from './i18n.js'
import * as data from './data.js'

const source = readFileSync(new URL('./App.vue',import.meta.url),'utf8')
const setup = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'')
const bases=['https://first.example.invalid','https://second.example.invalid']
const time=1_800_000_000_000
function dashboard({hash='#/', failing=false, saved={}}={}) {
  const storage=new Map(), requests=[], listeners=[], location={hash, origin:bases[0]}
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
  const page={title:'Host title',documentElement:{dataset:{}},body:{style:{}},querySelector:()=>({href:bases[0]+'/custom-icon.png'}),addEventListener(){}}
  const window={location,__AETHER_PREFERENCES__:saved,localStorage,matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}}
  const fetch=async address=>{
    const url=new URL(address), first=url.origin===bases[0]; requests.push(`${url.origin}${url.pathname}`)
    const node={id:'shared',region:'CN',name:first?'North':'South',server_group:'Example',last_updated:time,net_in_speed:first?null:0,price:'11',currency:'$',billing_cycle:'month'}
    if(url.pathname==='/api/config')return Response.json({is_public:true,authorization:true,default_language:'en',site_title:first?'Test Fleet':'Remote Fleet',preferred_theme:'dark'})
    if(failing)return new Response('Temporary error',{status:500,headers:{'cf-ray':'local-test-ray'}})
    if(url.pathname==='/api/servers')return Response.json({servers:[node],stats:{total:1,online:first?0:1,offline:first?1:0},sysConfig:{show_price:!first}})
    if(url.pathname==='/api/server')return Response.json({...node,sysConfig:{show_price:false,show_tf:true,show_expire:true,show_three_net_details:true}})
    if(url.pathname==='/api/history/all')return Response.json([])
    throw Error('unexpected path')
  }
  const ctx=vm.createContext({window,document:page,localStorage, ...data, siteAdminUrl, locale,t,resolveLocale, displayRules,filterNodes,initialFilters, computed,defineAsyncComponent,h,nextTick,reactive,ref,watch,isServerOnline, DEFAULT_SITE_TITLE:'Default', getApiBases:()=>bases, onMounted:f=>listeners.push(f),onUnmounted(){}, getComputedStyle:()=>({backgroundImage:'none'}),
    createSiteAccess:opts=>createSiteAccess({...opts,fetch,origin:bases[0],storage:localStorage}),
    createPreferencesController:opts=>createPreferencesController({...opts}),
    createMonitorSession:opts=>createMonitorSession({...opts,now:()=>time,isHidden:()=>false,timers:{setInterval(){return 1},clearInterval(){}},openSocket:()=>({close(){}})}),
  })
  const run=s=>vm.runInContext(s,ctx); run(setup)
  return { run, page, requests, async mount(){for(const f of listeners)await f(); await run('session.navigate(window.location.hash)');await nextTick()},
    async render(pattern,bindings){const html=source.match(pattern)[0];const app=createSSRApp({setup:()=>run('({'+bindings+'})'),render:compile(html)});return renderToString(app)} }
}

test('首页采用宿主标题图标、语言和权威统计；同 ID 节点的显示开关按站区分', async()=>{
  const a=dashboard();await a.mount()
  const brand=await a.render(/<a href="#\/" class="brand"[\s\S]*?<\/a>/,'siteTitle,siteIcon,t')
  assert.match(brand,/Test Fleet/);assert.match(brand,/custom-icon.png/);assert.equal(a.page.title,'Test Fleet');assert.equal(a.page.documentElement.lang,'en')
  assert.deepEqual({...a.run('stats.value')},{total:2,online:1,offline:1});assert.equal(a.run('totalDownload.value'),0);assert.equal(a.run('downloadNodes.value.length'),1)
  assert.deepEqual(Array.from(a.run('visibleNodes.value.map(n=>rulesFor(n).price)')),[false,true]);assert.equal(a.run('new Set(nodes.value.map(n=>n.key)).size'),2)
  assert.equal(a.run('statusTabs.value[1].count'),1);a.run("filters.group='Example'");assert.equal(a.run('visibleNodes.value.length'),2)
})
test('打开第二站节点直链，后台指向该 Worker，保留隐藏价格、启用的网络与资产',async()=>{
  const a=dashboard({hash:'#/server/shared?site=1'});await a.mount();assert.equal(a.run('adminUrl.value'),bases[1]+'/admin#/admin');assert.equal(a.run('state.detail.node.name'),'South');assert.equal(a.run('rulesBySite.value[detailSite.value.index].price'),false);assert.equal(a.run('rulesBySite.value[detailSite.value.index].network'),true);assert.ok(!a.requests.some(x=>x.startsWith(bases[0])||x.endsWith('/api/servers')))
})
test('接口返回 HTML 500 时错误保留接口与 Ray ID；无 stats 或畸形 hash 不影响页面渲染',async()=>{
  const a=dashboard({failing:true});await a.mount();assert.match(a.run('state.error'),/\/api\/servers.*500.*local-test-ray/);assert.equal(a.run('statusTabs.value[0].count'),'—')
  const b=dashboard({hash:'#/server/%FF%'});await b.mount();assert.equal(b.run('state.error'),'节点链接格式无效');assert.equal(b.requests.length,0)
})
