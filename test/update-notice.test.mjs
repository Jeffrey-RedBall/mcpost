// 升級提醒：mcpost 與 mcslide 都要收得到。跑法：npm test
//
// 為什麼要測：1.5.0 以前 mcslide 送了版本給後端，卻不印後端的提醒、也不查新版——
// 只用 mcslide 的人永遠不知道有新版，而且沒有任何東西會講（看起來一切正常）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { isOlder, userAgent } from '../bin/update-check.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin')
const VERSION = JSON.parse(readFileSync(join(BIN, '..', 'package.json'), 'utf8')).version
const NOTICE = '有新版 mcpost 9.9.9（測試用提醒）'

function fakeApi() {
  const uas = []
  const server = createServer((req, res) => {
    uas.push(req.headers['user-agent'])
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: true, pushId: 'cmx', data: [], clientNotice: NOTICE }))
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    base: `http://127.0.0.1:${server.address().port}/api`, uas, close: () => server.close(),
  })))
}

function run(bin, args, env) {
  return new Promise((ok) => {
    execFile(process.execPath, [join(BIN, bin), ...args], {
      env: { ...process.env, MCPOST_NO_MAIN: '', MAKECLASS_TOKEN: 'mck_test', ...env },
    }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: stdout + stderr }))
  })
}

/** 假的家目錄：放一份「剛查過、最新是 latest」的快取，不打真的 registry */
function homeWithCache(latest) {
  const home = mkdtempSync(join(tmpdir(), 'mcpost-home-'))
  mkdirSync(join(home, '.makeclass'))
  writeFileSync(join(home, '.makeclass', 'version-check.json'), JSON.stringify({ at: Date.now(), latest }))
  return home
}

function slidesFile() {
  const dir = mkdtempSync(join(tmpdir(), 'mcslide-'))
  const f = join(dir, 'a.md')
  writeFileSync(f, '---\ntitle: 測試\n---\n\n## 第一頁\n內容\n')
  return f
}

test('mcslide：送出版本、印出後端的升級提醒', async () => {
  const api = await fakeApi()
  const r = await run('mcslide.mjs', [slidesFile()], { MAKECLASS_API: api.base, HOME: homeWithCache(VERSION) })
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.ok(api.uas.every((ua) => ua.startsWith(`mcpost/${VERSION} (mcslide;`)), api.uas.join(' | '))
  assert.ok(r.out.includes(NOTICE), '後端的提醒要印出來')
  assert.equal(r.out.split(NOTICE).length - 1, 1, '同一則提醒只印一次')
})

test('mcslide：跑完會提醒本機版本落後（讀快取，不打 registry）', async () => {
  const r = await run('mcslide.mjs', [slidesFile(), '--dry-run'], { HOME: homeWithCache('99.0.0') })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /有新版 99\.0\.0/)
})

test('mcslide：已是最新版就不吵', async () => {
  const r = await run('mcslide.mjs', [slidesFile(), '--dry-run'], { HOME: homeWithCache(VERSION) })
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /有新版/)
})

test('mcpost：同一套提醒照舊', async () => {
  const api = await fakeApi()
  const r = await run('mcpost.mjs', ['channels'], { MAKECLASS_API_BASE: api.base, HOME: homeWithCache('99.0.0') })
  api.close()
  assert.ok(r.out.includes(NOTICE), r.out)
  assert.match(r.out, /有新版 99\.0\.0/)
  assert.ok(api.uas.every((ua) => /^mcpost\/\d+\.\d+\.\d+ \(node /.test(ua)), api.uas.join(' | '))
})

test('UA 格式要讓後端認得（/\\bmcpost\\/x.y.z/）', () => {
  assert.match(userAgent('mcslide'), /\bmcpost\/\d+\.\d+\.\d+ \(mcslide; node /)
  assert.match(userAgent(), /\bmcpost\/\d+\.\d+\.\d+ \(node /)
})

test('版本比較逐段比數字', () => {
  assert.equal(isOlder('1.5.0', '1.10.0'), true)
  assert.equal(isOlder('1.5.1', '1.5.1'), false)
  assert.equal(isOlder('2.0.0', '1.9.9'), false)
})
