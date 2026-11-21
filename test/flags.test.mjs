// 1.10.2：不認得的旗標直接中止（以前靜默忽略）
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { unknownFlags, unknownFlagMessage, KNOWN } from '../bin/flags.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin')

test('unknownFlags：只挑不在白名單的；--help／-- 之後不算；=值 會去掉', () => {
  assert.deepEqual(unknownFlags(['--title', 't', '--foo', '--bar=1', '--help'], KNOWN.post), ['foo', 'bar'])
  assert.deepEqual(unknownFlags(['--title', 't', '--', '--whatever'], KNOWN.post), [])
  assert.deepEqual(unknownFlags(['--out', 'x', '--size=cover'], KNOWN.shot), [])
  assert.deepEqual(unknownFlags(['{"a":"--b"}'], KNOWN.call), [])
})

test('mcslide from --focus 是認得的（1.10.2 起會送到後端）', () => {
  assert.deepEqual(unknownFlags(['from', 'cmx', '--pages', '12', '--focus', '定價'], KNOWN.mcslide), [])
})

test('unknownFlagMessage：訊息帶版本與升級指引；都認得回 null', () => {
  const m = unknownFlagMessage(['--attach', 'a.pdf', '--shot'], 'post', { version: '1.6.0' })
  assert.match(m.msg, /--shot/)
  assert.match(m.msg, /mcpost 1\.6\.0 沒有這個功能/)
  assert.match(m.hint, /mcpost upgrade/)
  assert.equal(unknownFlagMessage(['--attach', 'a.pdf'], 'post', { version: '1.6.0' }), null)
})

function run(bin, args, env) {
  return new Promise((ok) => execFile(process.execPath, [join(BIN, bin), ...args], {
    env: { ...process.env, MCPOST_NO_MAIN: '', MCPOST_NO_UPDATE_CHECK: '1', MAKECLASS_TOKEN: 'mck_test', MAKECLASS_API_BASE: 'http://127.0.0.1:9', MAKECLASS_API: 'http://127.0.0.1:9', ...env },
  }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: stdout + stderr })))
}

test('CLI：mcpost post --foo 在打 API 之前就中止', async () => {
  const r = await run('mcpost.mjs', ['post', '--title', 't', '--body', 'x', '--foo'])
  assert.equal(r.code, 1)
  assert.match(r.out, /不認得的選項：--foo/)
  assert.doesNotMatch(r.out, /連不上 API/)
})

test('CLI：mcslide 不認得的旗標會中止而不是吞掉', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcslide-flags-'))
  const f = join(dir, 'a.md'); writeFileSync(f, '---\ntitle: t\n---\n\n## 一\n內容\n')
  const r = await run('mcslide.mjs', [f, '--dry-run', '--zoom', 'x'])
  assert.equal(r.code, 1)
  assert.match(r.out, /不認得的選項：--zoom/)
  assert.match(r.out, /mcslide \d+\.\d+\.\d+ 沒有這個功能/)
})

test('CLI：認得的旗標組合照常（mcslide --dry-run 不受影響）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcslide-flags-'))
  const f = join(dir, 'a.md'); writeFileSync(f, '---\ntitle: t\n---\n\n## 一\n內容\n')
  const r = await run('mcslide.mjs', [f, '--dry-run', '--no-images'])
  assert.equal(r.code, 0, r.out)
})
