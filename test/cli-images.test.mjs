// devlog 與 mcslide 的圖片自動上傳，整條路徑跑一次。跑法：npm test
//
// 為什麼要跑整條：這兩支是「先建 → 傳圖 → PATCH 換網址」三步，
// 單測 findLocalImages 抓不到順序錯、pushId 拿錯、PATCH 漏送這類問題——
// 1.4.x 就是三步都沒有，送出去的圖全是本機路徑、站上一張都不顯示。
//
// 用本機假 API（不打正式站）：記下每個請求，最後檢查存進去的正文。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin')
const PUSH_ID = 'cmtest0001'

function fakeApi() {
  const calls = []
  let stored = ''
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const path = req.url.replace(/^\/api/, '')
      calls.push({ method: req.method, path })
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.method === 'POST' && path === '/v1/makeclass/devlog/ingest') {
        stored = JSON.parse(raw).body
        return send({ success: true, pushId: PUSH_ID, url: `https://makeclass.me/learn/${PUSH_ID}` })
      }
      if (req.method === 'POST' && path === '/v1/makeclass/pusher/create') {
        stored = JSON.parse(raw).articleBody
        return send({ success: true, pushId: PUSH_ID })
      }
      if (req.method === 'POST' && path.endsWith('/upload-asset')) {
        const name = (raw.match(/filename="([^"]+)"/) || [])[1]
        return send({ success: true, fileUrl: `https://cdn.test/${PUSH_ID}/${name}` })
      }
      if (req.method === 'PATCH' && path === `/v1/makeclass/pusher/${PUSH_ID}`) {
        stored = JSON.parse(raw).articleBody ?? stored
        return send({ success: true })
      }
      if (req.method === 'GET' && path === `/v1/makeclass/pusher/${PUSH_ID}`) {
        return send({ success: true, data: { articleBody: stored } })
      }
      res.writeHead(404); res.end('{}')
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    base: `http://127.0.0.1:${server.address().port}/api`, calls, stored: () => stored, close: () => server.close(),
  })))
}

function run(bin, args, env) {
  return new Promise((ok) => {
    execFile(process.execPath, [join(BIN, bin), ...args], {
      env: { ...process.env, MCPOST_NO_MAIN: '', MAKECLASS_TOKEN: 'mck_test', HOME: tmpdir(), ...env },
    }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: stdout + stderr }))
  })
}

function fixture(md) {
  const dir = mkdtempSync(join(tmpdir(), 'mcpost-cli-'))
  mkdirSync(join(dir, 'img'))
  writeFileSync(join(dir, 'img', 'a.png'), 'x')
  writeFileSync(join(dir, 'img', 'b.png'), 'x')
  const file = join(dir, 'doc.md')
  writeFileSync(file, md)
  return file
}

test('devlog：送出後自動上傳本地圖片，正文換成網址', async () => {
  const api = await fakeApi()
  const file = fixture(`---
makeclass: devlog/v1
title: 測試
category: vibecoding
question: |
  怎麼放圖？
source:
  agent: claude-code
---

![甲](./img/a.png)

內文

![乙](./img/b.png "說明")
`)
  const r = await run('mcpost.mjs', ['devlog', file, '--yes'], { MAKECLASS_API_BASE: api.base })
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /2 張本地圖片/)
  const body = api.stored()
  assert.ok(body.includes(`](https://cdn.test/${PUSH_ID}/a.png)`), body)
  assert.ok(body.includes(`](https://cdn.test/${PUSH_ID}/b.png "說明")`), body)
  assert.ok(!body.includes('./img/'), '不能留下本機路徑')
  // 順序：先建、再傳圖、最後 PATCH
  const order = api.calls.map((c) => `${c.method} ${c.path.split('/').pop()}`)
  assert.ok(order.indexOf('POST ingest') < order.indexOf('POST upload-asset'), order.join(' → '))
  assert.ok(order.lastIndexOf('POST upload-asset') < order.indexOf(`PATCH ${PUSH_ID}`), order.join(' → '))
})

test('devlog --no-images：不上傳、不 PATCH', async () => {
  const api = await fakeApi()
  const file = fixture(`---
makeclass: devlog/v1
title: 測試
category: vibecoding
question: 放圖
source:
  agent: claude-code
---

![甲](./img/a.png)
`)
  const r = await run('mcpost.mjs', ['devlog', file, '--yes', '--no-images', '--no-verify'], { MAKECLASS_API_BASE: api.base })
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.ok(!api.calls.some((c) => c.path.endsWith('/upload-asset') || c.method === 'PATCH'))
})

const SLIDES = `---
title: 測試簡報
---

## 第一頁
![甲](./img/a.png)

## 第二頁
![乙](img/b.png "caption")
`

test('mcslide 新建：先建草稿、傳圖、再換網址', async () => {
  const api = await fakeApi()
  const r = await run('mcslide.mjs', [fixture(SLIDES)], { MAKECLASS_API: api.base })
  api.close()
  assert.equal(r.code, 0, r.out)
  const body = api.stored()
  assert.ok(body.includes(`](https://cdn.test/${PUSH_ID}/a.png)`), body)
  assert.ok(body.includes(`](https://cdn.test/${PUSH_ID}/b.png "caption")`), body)
  assert.ok(!/\]\(\.?\/?img\//.test(body), '不能留下本機路徑')
})

test('mcslide --update：圖先傳完，一次 PATCH 就定案', async () => {
  const api = await fakeApi()
  const r = await run('mcslide.mjs', [fixture(SLIDES), '--update', PUSH_ID], { MAKECLASS_API: api.base })
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.equal(api.calls.filter((c) => c.method === 'PATCH').length, 1)
  assert.ok(!api.calls.some((c) => c.path.endsWith('/create')))
  assert.ok(api.stored().includes(`https://cdn.test/${PUSH_ID}/a.png`))
})

test('mcslide --dry-run：列出圖片數，不打任何 API', async () => {
  const api = await fakeApi()
  const r = await run('mcslide.mjs', [fixture(SLIDES), '--dry-run'], { MAKECLASS_API: api.base })
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /2 張本地圖片/)
  assert.equal(api.calls.length, 0)
})
