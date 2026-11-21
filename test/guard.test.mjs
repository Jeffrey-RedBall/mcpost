// 1.10.1：post 也要過機密閘門與客戶名遮罩（以前只有 devlog 有）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { guardFields, scanSecrets, maskClients } from '../bin/guard.mjs'

test('guardFields：每個欄位都掃，機密帶欄位名與行號', () => {
  const r = guardFields({ title: '標題', articleBody: '第一行\nTOKEN=' + 'A'.repeat(20) + '\n', take: 'sk-' + 'x'.repeat(20) })
  assert.equal(r.secrets.length, 2)
  assert.deepEqual(r.secrets.map((s) => s.field).sort(), ['articleBody', 'take'])
  assert.equal(r.secrets.find((s) => s.field === 'articleBody').line, 2)
})

test('guardFields：客戶名預設遮、mask:false 不遮、非字串原樣回', () => {
  const r = guardFields({ title: '給中華汽車的提案', subtitle: undefined, articleBody: '裕隆 與 CMC01' })
  assert.equal(r.fields.title, '給<客戶A>的提案')
  assert.equal(r.fields.articleBody, '<客戶B> 與 <客戶A>')
  assert.equal(r.fields.subtitle, undefined)
  assert.deepEqual(r.masked.sort(), ['<客戶A>', '<客戶B>'])
  const raw = guardFields({ title: '中華汽車' }, { mask: false })
  assert.equal(raw.fields.title, '中華汽車')
  assert.deepEqual(raw.masked, [])
})

test('maskClients 可連續呼叫（g 旗標的 lastIndex 不殘留）', () => {
  assert.equal(maskClients('裕隆').text, '<客戶B>')
  assert.equal(maskClients('裕隆').text, '<客戶B>')
  assert.equal(scanSecrets('').length, 0)
})

// ── CLI 端到端：假 API，確認 post 送出前真的會擋／會遮 ──
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin')
function fakeApi() {
  const calls = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      const path = req.url.replace(/^\/api/, '')
      calls.push({ method: req.method, path, body: raw ? JSON.parse(raw) : null })
      const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.method === 'POST' && path === '/v1/makeclass/pusher/create') return send({ success: true, pushId: 'cmguard0001' })
      if (req.method === 'GET' && path.startsWith('/v1/makeclass/pusher/cmguard0001')) return send({ success: true, data: { id: 'cmguard0001', title: 'x' } })
      send({ success: false, error: 'unexpected ' + path }, 404)
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${server.address().port}/api`, calls, close: () => server.close() })))
}
function run(args, env) {
  return new Promise((ok) => execFile(process.execPath, [join(BIN, 'mcpost.mjs'), ...args], {
    env: { ...process.env, MCPOST_NO_MAIN: '', MCPOST_NO_UPDATE_CHECK: '1', MAKECLASS_TOKEN: 'mck_test', HOME: tmpdir(), ...env },
  }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, stdout, stderr })))
}

test('CLI：post 正文含機密 → exit 1、一個 API 都不打', async () => {
  const api = await fakeApi()
  const dir = mkdtempSync(join(tmpdir(), 'mcguard-'))
  const f = join(dir, 'b.md'); writeFileSync(f, '正文\n\nDATABASE_URL=postgres://u:p@h/db\n')
  const r = await run(['post', '--post', '--title', 't', '--body', f, '--no-verify'], { MAKECLASS_API_BASE: api.base })
  api.close()
  assert.equal(r.code, 1)
  assert.match(r.stderr, /疑似機密/)
  assert.equal(api.calls.length, 0)
})

test('CLI：post 標題與正文的客戶名送出前已遮', async () => {
  const api = await fakeApi()
  const dir = mkdtempSync(join(tmpdir(), 'mcguard-'))
  const f = join(dir, 'b.md'); writeFileSync(f, '這次幫裕隆做的\n')
  const r = await run(['post', '--post', '--title', '中華汽車上線紀錄', '--body', f, '--no-verify'], { MAKECLASS_API_BASE: api.base })
  api.close()
  assert.equal(r.code, 0, r.stderr)
  const create = api.calls.find((c) => c.path === '/v1/makeclass/pusher/create')
  assert.equal(create.body.title, '<客戶A>上線紀錄')
  assert.equal(create.body.articleBody, '這次幫<客戶B>做的\n')
  assert.match(r.stdout, /已遮罩客戶名/)
})

test('CLI：mcpost post --help 印用法而不是「缺少 --title」', async () => {
  const r = await run(['post', '--help'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /post 選項/)
  assert.doesNotMatch(r.stderr, /缺少 --title/)
})
