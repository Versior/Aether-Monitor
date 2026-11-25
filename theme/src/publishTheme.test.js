import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('发布两个独立构建到本地 bare 仓库，各分支保留每次源码说明，重跑不重复、不回退', context => {
  const directory = mkdtempSync(join(tmpdir(), 'aether-publish-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const remote = join(directory, 'fixture.git'), checkout = join(directory, 'source')
  const pages = join(directory, 'pages'), install = join(directory, 'install'), trace = join(directory, 'git-events')
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0' }
  function run(command, args, cwd, extra = {}) {
    return execFileSync(command, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }
  const git = (...args) => run('git', args, checkout)
  const inRemote = (...args) => run('git', ['--git-dir', remote, ...args], directory)
  const publish = () => run('bash', [join(root, 'scripts/publish-theme.sh'), pages, install], checkout, { GIT_TRACE2_EVENT: trace })
  const build = (out, variables) => run('npm', ['run', 'build', '--', '--outDir', out], root, { API_BASE: '', TITLE: '', BACKGROUND_IMAGE: '', CSP_API: '', CSP_STATIC: '', ...variables })

  build(install, {})
  build(pages, { API_BASE: 'https://worker.example', TITLE: 'Fixture Pages', BACKGROUND_IMAGE: 'https://images.example/maps.webp', CSP_API: 'https://api.example', CSP_STATIC: 'https://static.example' })
  run('git', ['init', '--bare', '--initial-branch=main', remote], directory)
  inRemote('config', 'receive.denyNonFastForwards', 'true')
  run('git', ['clone', remote, checkout], directory)
  git('config', 'user.name', 'Fixture publisher')
  git('config', 'user.email', 'fixture@example.invalid')
  git('commit', '--allow-empty', '-m', 'Previous install')
  const previous = git('rev-parse', 'HEAD')
  git('push', 'origin', 'HEAD:refs/heads/build')
  const parents = { build: previous, dist: previous }
  function pushSource(subject) {
    git('commit', '--allow-empty', '-m', subject, '-m', 'Source body with a second paragraph.')
    git('push', 'origin', 'main')
    return git('rev-parse', 'HEAD')
  }
  const subjects = ['首次发布', '仅更新文档也保留源码说明']
  const sourceShas = subjects.map(pushSource)
  for (const [index, subject] of subjects.entries()) {
    const source = sourceShas[index]
    git('switch', '--detach', source)
    publish()
    for (const branch of ['dist', 'build']) {
      assert.equal(inRemote('rev-parse', `${branch}^`), parents[branch])
      assert.equal(inRemote('log', '-1', '--format=%B', branch), `${subject}\n\nSource body with a second paragraph.\n\nSource: ${source}`)
      assert.deepEqual(inRemote('ls-tree', '--name-only', branch).split('\n'), ['assets', 'index.html'])
      const html = inRemote('show', `${branch}:index.html`)
      for (const marker of ['https://worker.example', 'Fixture Pages', 'https://images.example/maps.webp', 'https://api.example', 'https://static.example']) assert.equal(html.includes(marker), branch === 'dist', marker)
      assert.equal((/<meta\b[^>]*\bname="apiBase"/i).test(html), branch === 'dist')
      parents[branch] = inRemote('rev-parse', branch)
    }
  }
  publish()
  git('switch', '--detach', sourceShas[0])
  publish()
  for (const [branch, tip] of Object.entries(parents)) assert.equal(inRemote('rev-parse', branch), tip)
  git('switch', 'main')
  const lateSource = pushSource('较晚完成的第三次构建')
  const latestSource = pushSource('先完成的第四次构建')
  publish()
  const latestTips = Object.fromEntries(['dist', 'build'].map(branch => [branch, inRemote('rev-parse', branch)]))
  git('switch', '--detach', lateSource)
  for (const path of [pages, install]) appendFileSync(join(path, 'index.html'), '\n<!-- older artifact -->\n')
  publish()
  for (const [branch, latestTip] of Object.entries(latestTips)) {
    assert.equal(inRemote('rev-parse', `${branch}^1`), latestTip)
    assert.equal(inRemote('rev-parse', `${branch}^{tree}`), inRemote('rev-parse', `${latestTip}^{tree}`))
    assert.equal(inRemote('log', '-1', '--format=%(trailers:key=Live-Source,valueonly)', branch), latestSource)
    assert.equal(inRemote('log', '-1', '--format=%(trailers:key=Source,valueonly)', `${branch}^2`), lateSource)
    assert.match(inRemote('show', `${branch}^2:index.html`), /older artifact/)
    parents[branch] = inRemote('rev-parse', branch)
  }
  publish()
  git('commit', '--allow-empty', '-m', 'Not in remote main')
  assert.throws(publish, /not in the history of origin\/main/)
  for (const [branch, tip] of Object.entries(parents)) assert.equal(inRemote('rev-parse', branch), tip)
  const pushes = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(event => event.event === 'start' && event.argv[1] === 'push')
  assert.equal(pushes.length, 4)
  for (const { argv } of pushes) assert.ok(!argv.some(arg => arg === '-f' || arg.startsWith('--force') || arg.startsWith('+')), 'publication must not force-push')
})
