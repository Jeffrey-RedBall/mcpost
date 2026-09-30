// --attach（1.7.0）：直傳三步（upload-url → PUT → register-asset）＋正文檔設定區＋mcslide --cover/--attach。
// 跑法：node --test test/attach.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { resolveAttachFile, ImageUploadError, MAX_ATTACH_BYTES } from '../bin/images.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin')
const PUSH_ID = 'cmattach0001'

function fakeApi({ uploadUrl = true } = {}) {
  const calls = []
  const state = { body: '', coverUrl: null, assets: [], puts: {} }
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const path = req.url.replace(/^\/api/, '')
      calls.push({ method: req.method, path })
      const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.method === 'POST' && path === '/v1/makeclass/pusher/create') { state.body = JSON.parse(raw).articleBody || ''; return send({ success: true, pushId: PUSH_ID }) }
      if (req.method === 'POST' && path.endsWith('/upload-asset')) { const name = (raw.toString().match(/filename="([^"]+)"/) || [])[1]; return send({ success: true, fileUrl: `https://cdn.test/${PUSH_ID}/${name}` }) }
      if (req.method === 'POST' && path === `/v1/makeclass/pusher/${PUSH_ID}/upload-url`) {
        if (!uploadUrl) return send({ success: false, error: 'Not found' }, 404)
        const j = JSON.parse(raw)
        const storagePath = `makeclass/pusher/${PUSH_ID}/${Date.now()}_${j.fileName}`
        return send({ success: true, uploadUrl: `${state.base}/put/${encodeURIComponent(storagePath)}`, storagePath, fileUrl: `https://storage.test/bkt/${storagePath}`, type: /mp4/.test(j.mimeType) ? 'VIDEO' : 'OTHER', contentType: j.mimeType })
      }
      if (req.method === 'PUT' && path.startsWith('/put/')) { state.puts[decodeURIComponent(path.slice(5))] = { bytes: raw.length, type: req.headers['content-type'] }; res.writeHead(200); return res.end('{}') }
      if (req.method === 'POST' && path === `/v1/makeclass/pusher/${PUSH_ID}/register-asset`) {
        const j = JSON.parse(raw)
        const storagePath = j.fileUrl.split('/bkt/')[1]
        if (!state.puts[storagePath]) return send({ success: false, error: '找不到這個檔案（上傳可能沒完成）' }, 400)
        state.assets.push(j); return send({ success: true, asset: { id: 'a1', type: j.type, fileUrl: j.fileUrl } }, 201)
      }
      if (req.method === 'PATCH' && path === `/v1/makeclass/pusher/${PUSH_ID}`) { const j = JSON.parse(raw); if (j.articleBody !== undefined) state.body = j.articleBody; if (j.coverUrl !== undefined) state.coverUrl = j.coverUrl; return send({ success: true }) }
      if (req.method === 'GET' && path === `/v1/makeclass/pusher/${PUSH_ID}`) return send({ success: true, data: { articleBody: state.body, coverUrl: state.coverUrl, title: 't' } })
      res.writeHead(404); res.end('{}')
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => { state.base = `http://127.0.0.1:${server.address().port}/api`; ok({ base: state.base, calls, state, close: () => server.close() }) }))
}

function run(bin, args, env, cwd) {
  return new Promise((ok) => {
    execFile(process.execPath, [join(BIN, bin), ...args], { cwd, env: { ...process.env, MCPOST_NO_MAIN: '', MCPOST_NO_UPDATE_CHECK: '1', MAKECLASS_TOKEN: 'mck_test', HOME: tmpdir(), ...env } },
      (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: stdout + stderr }))
  })
}
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'mcpost-attach-'))
  writeFileSync(join(d, 'clip.mp4'), Buffer.alloc(3000, 1))
  writeFileSync(join(d, 'pack.zip'), Buffer.alloc(700, 2))
  writeFileSync(join(d, 'cover.jpg'), 'jpg')
  writeFileSync(join(d, 'empty.zip'), '')
  writeFileSync(join(d, 'body.md'), '正文')
  return d
}

test('resolveAttachFile：本機檔可以；網址、找不到、空檔擋', () => {
  const d = dir()
  const f = resolveAttachFile('clip.mp4', d)
  assert.equal(f.mime, 'video/mp4'); assert.equal(f.size, 3000); assert.equal(f.name, 'clip.mp4')
  assert.equal(resolveAttachFile('pack.zip', d).mime, 'application/zip')
  for (const bad of ['https://x/a.zip', 'nope.zip', 'empty.zip']) assert.throws(() => resolveAttachFile(bad, d), ImageUploadError, bad)
  assert.ok(MAX_ATTACH_BYTES >= 500 * 1024 * 1024)
})

test('post --attach ×2：建草稿 → 要網址 → PUT 全部位元組 → 登記；順序對、位元組對', async () => {
  const api = await fakeApi(); const d = dir()
  const r = await run('mcpost.mjs', ['post', '--title', 'T', '--post', '--body', 'body.md', '--attach', 'clip.mp4', '--attach', 'pack.zip', '--no-verify'], { MAKECLASS_API_BASE: api.base }, d)
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.equal(api.state.assets.length, 2)
  assert.deepEqual(api.state.assets.map((a) => a.fileName), ['clip.mp4', 'pack.zip'])
  assert.deepEqual(api.state.assets.map((a) => a.type), ['VIDEO', 'OTHER'])
  const puts = Object.values(api.state.puts)
  assert.deepEqual(puts.map((p) => p.bytes).sort((a, b) => a - b), [700, 3000])
  const order = api.calls.map((c) => `${c.method} ${c.path.split('/').pop().split('?')[0]}`)
  assert.ok(order.indexOf('POST create') < order.indexOf('POST upload-url'), order.join(' → '))
  assert.match(r.out, /附件 2\/2：pack\.zip/)
})

test('post --update 只給 --attach：不建新篇，直接掛', async () => {
  const api = await fakeApi(); const d = dir()
  api.state.puts = {}
  const r = await run('mcpost.mjs', ['post', '--update', PUSH_ID, '--attach', 'pack.zip', '--no-verify'], { MAKECLASS_API_BASE: api.base }, d)
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.ok(!api.calls.some((c) => c.path.endsWith('/create')))
  assert.equal(api.state.assets.length, 1)
  assert.match(r.out, /附件×1/)
})

test('🚨 附件不合格：建草稿之前就停', async () => {
  const api = await fakeApi(); const d = dir()
  const r = await run('mcpost.mjs', ['post', '--title', 'T', '--body', 'body.md', '--attach', 'nope.zip'], { MAKECLASS_API_BASE: api.base }, d)
  api.close()
  assert.notEqual(r.code, 0)
  assert.equal(api.calls.length, 0)
})

test('伺服器還沒支援直傳（upload-url 404）：講清楚原因與重跑方式，exit 1', async () => {
  const api = await fakeApi({ uploadUrl: false }); const d = dir()
  const r = await run('mcpost.mjs', ['post', '--title', 'T', '--body', 'body.md', '--attach', 'pack.zip', '--no-verify'], { MAKECLASS_API_BASE: api.base }, d)
  api.close()
  assert.notEqual(r.code, 0)
  assert.match(r.out, /還沒更新到支援直傳/)
  assert.match(r.out, /--update cmattach0001 --attach/)
})

test('正文檔設定區：title／subtitle／cover／attach 都從檔案讀，正文不含設定區', async () => {
  const api = await fakeApi(); const d = dir()
  writeFileSync(join(d, 'doc.md'), `---
title: 設定區標題
subtitle: 副標
cover: ./cover.jpg
attach:
  - ./clip.mp4
  - ./pack.zip
---

真正的正文
`)
  const r = await run('mcpost.mjs', ['post', '--post', '--body', 'doc.md', '--no-verify'], { MAKECLASS_API_BASE: api.base }, d)
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.equal(api.state.body.trim(), '真正的正文')
  assert.ok(!api.state.body.includes('title:'), '設定區不能進正文')
  assert.equal(api.state.coverUrl, `https://cdn.test/${PUSH_ID}/cover.jpg`)
  assert.equal(api.state.assets.length, 2)
})

test('mcslide --cover --attach：簡報建好後設封面、掛附件', async () => {
  const api = await fakeApi(); const d = dir()
  writeFileSync(join(d, 'deck.md'), `---
title: 測試簡報
---

## 第一頁

- 一件事
`)
  const r = await run('mcslide.mjs', ['deck.md', '--cover', 'cover.jpg', '--attach', 'pack.zip'], { MAKECLASS_API: api.base }, d)
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.equal(api.state.coverUrl, `https://cdn.test/${PUSH_ID}/cover.jpg`)
  assert.equal(api.state.assets.length, 1)
  assert.match(r.out, /已建立草稿/)
})
