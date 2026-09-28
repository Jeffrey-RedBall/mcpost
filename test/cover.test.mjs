// --cover（1.6.0）：上傳本機圖設成封面，不讓網頁審閱頁自動請 AI 畫。跑法：node --test test/cover.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { resolveCoverFile, ImageUploadError } from '../bin/images.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin')
const PUSH_ID = 'cmcover0001'

function fakeApi() {
  const calls = []
  const state = { body: '', coverUrl: null }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const path = req.url.replace(/^\/api/, '')
      calls.push({ method: req.method, path })
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.method === 'POST' && path === '/v1/makeclass/pusher/create') {
        state.body = JSON.parse(raw).articleBody || ''
        return send({ success: true, pushId: PUSH_ID })
      }
      if (req.method === 'POST' && path === '/v1/makeclass/devlog/ingest') {
        const j = JSON.parse(raw)
        state.body = j.body
        state.fm = j.frontmatter
        return send({ success: true, pushId: PUSH_ID, url: `https://makeclass.me/learn/${PUSH_ID}` })
      }
      if (req.method === 'POST' && path.endsWith('/upload-asset')) {
        const name = (raw.match(/filename="([^"]+)"/) || [])[1]
        return send({ success: true, fileUrl: `https://cdn.test/${PUSH_ID}/${name}` })
      }
      if (req.method === 'PATCH' && path === `/v1/makeclass/pusher/${PUSH_ID}`) {
        const j = JSON.parse(raw)
        if (j.articleBody !== undefined) state.body = j.articleBody
        if (j.coverUrl !== undefined) state.coverUrl = j.coverUrl
        return send({ success: true })
      }
      if (req.method === 'GET' && path === `/v1/makeclass/pusher/${PUSH_ID}`) {
        return send({ success: true, data: { articleBody: state.body, coverUrl: state.coverUrl, title: 't' } })
      }
      res.writeHead(404); res.end('{}')
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    base: `http://127.0.0.1:${server.address().port}/api`, calls, state, close: () => server.close(),
  })))
}

function run(args, env, cwd) {
  return new Promise((ok) => {
    execFile(process.execPath, [join(BIN, 'mcpost.mjs'), ...args], {
      cwd,
      env: { ...process.env, MCPOST_NO_UPDATE_CHECK: '1', MAKECLASS_TOKEN: 'mck_test', HOME: tmpdir(), ...env },
    }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: stdout + stderr }))
  })
}

function dir() {
  const d = mkdtempSync(join(tmpdir(), 'mcpost-cover-'))
  writeFileSync(join(d, 'cover.jpg'), 'jpg')
  writeFileSync(join(d, 'cover.gif'), 'gif')
  writeFileSync(join(d, 'body.md'), '正文')
  return d
}

test('resolveCoverFile：本機 jpg 可以；網址、找不到、不支援格式一律擋', () => {
  const d = dir()
  assert.equal(resolveCoverFile('cover.jpg', d).ext, '.jpg')
  for (const bad of ['https://x.com/a.jpg', 'nope.jpg', 'cover.gif']) {
    assert.throws(() => resolveCoverFile(bad, d), ImageUploadError, bad)
  }
})

test('post --cover：建草稿 → 上傳封面 → PATCH coverUrl', async () => {
  const api = await fakeApi()
  const d = dir()
  const r = await run(['post', '--title', 'T', '--post', '--body', 'body.md', '--cover', 'cover.jpg', '--no-verify'],
    { MAKECLASS_API_BASE: api.base }, d)
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.equal(api.state.coverUrl, `https://cdn.test/${PUSH_ID}/cover.jpg`)
  const order = api.calls.map((c) => `${c.method} ${c.path.split('/').pop()}`)
  assert.ok(order.indexOf('POST create') < order.indexOf('POST upload-asset'), order.join(' → '))
})

test('post --update 只給 --cover 也可以（換已經發出去那篇的封面）', async () => {
  const api = await fakeApi()
  const d = dir()
  const r = await run(['post', '--update', PUSH_ID, '--cover', 'cover.jpg', '--no-verify'], { MAKECLASS_API_BASE: api.base }, d)
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.equal(api.state.coverUrl, `https://cdn.test/${PUSH_ID}/cover.jpg`)
  assert.ok(!api.calls.some((c) => c.path.endsWith('/create')), '不能建新的一篇')
  assert.match(r.out, /已更新：封面/)
})

test('🚨 封面不合格：在建草稿之前就停，不留半成品', async () => {
  const api = await fakeApi()
  const d = dir()
  for (const bad of ['cover.gif', 'missing.jpg', 'https://example.com/c.jpg']) {
    const r = await run(['post', '--title', 'T', '--body', 'body.md', '--cover', bad], { MAKECLASS_API_BASE: api.base }, d)
    assert.notEqual(r.code, 0, `${bad} 應該失敗`)
  }
  api.close()
  assert.equal(api.calls.length, 0, '一個 API 都不能打：' + api.calls.map((c) => c.path).join(', '))
})

test('devlog：front matter 的 cover: 相對於 devlog 檔案；不會把本機路徑送給後端', async () => {
  const api = await fakeApi()
  const d = dir()
  const file = join(d, 'log.md')
  writeFileSync(file, `---
makeclass: devlog/v1
title: 測試封面
category: vibecoding
question: |
  封面怎麼放？
source:
  agent: claude-code
cover: ./cover.jpg
---

內文
`)
  const r = await run(['devlog', file, '--yes', '--no-verify'], { MAKECLASS_API_BASE: api.base }, tmpdir())
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.equal(api.state.coverUrl, `https://cdn.test/${PUSH_ID}/cover.jpg`)
  assert.equal(api.state.fm.cover, undefined, '本機路徑不能送出去')
})
