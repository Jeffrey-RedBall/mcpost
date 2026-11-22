import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSize, findChrome, chromeArgs } from '../bin/shot.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('parseSize：別名與 WxH', () => {
  assert.deepEqual(parseSize(undefined), [1200, 630])
  assert.deepEqual(parseSize('cover'), [1200, 630])
  assert.deepEqual(parseSize('figure'), [1200, 675])
  assert.deepEqual(parseSize('800x450'), [800, 450])
  assert.throws(() => parseSize('big'), /看不懂 --size/)
})

test('findChrome：MCPOST_CHROME 優先，否則平台路徑，都沒有回 null', () => {
  const exists = (p) => p === '/x/chrome' || p === '/usr/bin/chromium'
  assert.equal(findChrome({ env: { MCPOST_CHROME: '/x/chrome' }, platform: 'linux', exists }), '/x/chrome')
  assert.equal(findChrome({ env: {}, platform: 'linux', exists }), '/usr/bin/chromium')
  assert.equal(findChrome({ env: {}, platform: 'linux', exists: () => false }), null)
})

test('chromeArgs：尺寸、輸出、file:// 網址', () => {
  const a = chromeArgs({ html: 'cover.html', out: '/tmp/c.png', size: [1200, 630] })
  assert.ok(a.includes('--window-size=1200,630'))
  assert.ok(a.includes('--screenshot=/tmp/c.png'))
  assert.match(a.at(-1), /^file:\/\/.*cover\.html$/)
})

test('templates 跟著套件走', () => {
  for (const f of ['base.css', 'cover.html', 'cover-riso.html', 'figure.html']) assert.ok(existsSync(join(ROOT, 'templates', f)), f)
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('templates'))
})
