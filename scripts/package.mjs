import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = `${root}/release/aether-theme.zip`
await mkdir(`${root}/release`, { recursive: true })
await rm(output, { force: true })
const files = ['index.html', ...(await readdir(`${root}/dist/assets`)).map(name => `assets/${name}`)]
execFileSync('zip', ['-q', output, ...files], { cwd: `${root}/dist` })
const hash = createHash('sha256').update(await readFile(output)).digest('hex')
await writeFile(`${root}/release/SHA256SUMS.txt`, `${hash}  aether-theme.zip\n`)
console.log(`Packaged ${files.length} files into release/aether-theme.zip`)
