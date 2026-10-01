// 導讀（1.8.0）：資料夾規則、檔數＝頁數、串接與起點、掛到簡報；mcslide --narration 與 narration 子指令。
// 跑法：node --test test/narration.test.mjs（要有 ffmpeg；沒有就跳過串接那幾條）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawnSync } from 'node:child_process'
import { resolveNarrationDir, checkNarrationCount, buildNarration } from '../bin/narration.mjs'
import { ImageUploadError } from '../bin/images.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin')
const PUSH_ID = 'cmnarr0001'
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
const DECK = `---\ntitle: 導讀測試\n---\n\n# 第一章\n\n## 一\n\n- a\n\n## 二\n\n- b\n`   // 封面＋章＋2 內容＝4 頁

function tone(file, sec) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${sec}`, '-ar', '22050', '-ac', '1', '-b:a', '32k', file])
  assert.equal(r.status, 0, 'ffmpeg 產測試音檔')
}
function dir(n, { secs = [1, 2, 1.5, 1], text = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'mcslide-narr-'))
  const audio = join(d, '音檔'); mkdirSync(audio)
  for (let i = 1; i <= n; i++) {
    if (hasFfmpeg) tone(join(audio, `${String(i).padStart(2, '0')}.mp3`), secs[i - 1] ?? 1); else writeFileSync(join(audio, `${String(i).padStart(2, '0')}.mp3`), 'x')
    if (text) writeFileSync(join(audio, `${String(i).padStart(2, '0')}.txt`), `第${i}頁第一句。第二句！`)
  }
  writeFileSync(join(d, 'deck.md'), DECK)
  return { d, audio }
}

function fakeApi() {
  const calls = []
  const state = { narration: null, assets: [], puts: {} }
  const server = createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const raw = Buffer.concat(chunks); const path = req.url.replace(/^\/api/, ''); calls.push({ method: req.method, path })
      const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.method === 'POST' && path === '/v1/makeclass/pusher/create') return send({ success: true, pushId: PUSH_ID })
      if (req.method === 'GET' && path === `/v1/makeclass/pusher/${PUSH_ID}`) return send({ success: true, data: { title: '導讀測試', contentType: 'slides', articleBody: DECK, assets: state.assets } })
      if (req.method === 'POST' && path === `/v1/makeclass/pusher/${PUSH_ID}/upload-url`) { const j = JSON.parse(raw); const sp = `makeclass/pusher/${PUSH_ID}/1_${j.fileName}`; return send({ success: true, uploadUrl: `${state.base}/put/${encodeURIComponent(sp)}`, storagePath: sp, fileUrl: `https://storage.test/bkt/${sp}`, type: 'AUDIO', contentType: j.mimeType }) }
      if (req.method === 'PUT' && path.startsWith('/put/')) { state.puts[decodeURIComponent(path.slice(5))] = raw.length; res.writeHead(200); return res.end('{}') }
      if (req.method === 'POST' && path === `/v1/makeclass/pusher/${PUSH_ID}/register-asset`) { const j = JSON.parse(raw); const a = { id: `aud_${state.assets.length + 1}`, type: j.type, fileUrl: j.fileUrl, fileName: j.fileName }; state.assets.push(a); return send({ success: true, asset: a }, 201) }
      if (req.method === 'POST' && path === `/v1/makeclass/pusher/${PUSH_ID}/narration`) { const j = JSON.parse(raw); if (j.timings.length !== 4) return send({ success: false, error: 'timings 要有 4 筆（每頁一筆）' }, 400); state.narration = j; return send({ success: true, pushId: PUSH_ID, pageCount: 4 }) }
      if (req.method === 'PATCH') return send({ success: true })
      res.writeHead(404); res.end('{}')
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => { state.base = `http://127.0.0.1:${server.address().port}/api`; ok({ base: state.base, calls, state, close: () => server.close() }) }))
}
function run(args, env, cwd) {
  return new Promise((ok) => {
    execFile(process.execPath, [join(BIN, 'mcslide.mjs'), ...args], { cwd, env: { ...process.env, MCPOST_NO_MAIN: '', MCPOST_NO_UPDATE_CHECK: '1', MAKECLASS_TOKEN: 'mck_test', HOME: tmpdir(), ...env } },
      (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: stdout + stderr }))
  })
}

test('resolveNarrationDir：01..N 連號才收；缺號、沒 01、空資料夾、給檔案都擋；同名 .txt 當字幕', () => {
  const { audio } = dir(4)
  const files = resolveNarrationDir(audio, '/')
  assert.deepEqual(files.map((f) => f.n), [1, 2, 3, 4])
  assert.match(files[0].text, /第1頁/)
  const gap = mkdtempSync(join(tmpdir(), 'narr-gap-')); writeFileSync(join(gap, '01.mp3'), 'x'); writeFileSync(join(gap, '03.mp3'), 'x')
  assert.throws(() => resolveNarrationDir(gap, '/'), (e) => e instanceof ImageUploadError && /缺 02/.test(e.message))
  const no1 = mkdtempSync(join(tmpdir(), 'narr-no1-')); writeFileSync(join(no1, '02.mp3'), 'x')
  assert.throws(() => resolveNarrationDir(no1, '/'), /沒有 01/)
  assert.throws(() => resolveNarrationDir(mkdtempSync(join(tmpdir(), 'narr-empty-')), '/'), /沒有音檔/)
  assert.throws(() => resolveNarrationDir(join(audio, '01.mp3'), '/'), /資料夾/)
  assert.throws(() => checkNarrationCount(files, 5), /4 個，簡報 5 頁/)
  checkNarrationCount(files, 4)
})

test('buildNarration：起點＝前面長度累加＋頁間空白；字幕逐句落在該頁區間內', { skip: !hasFfmpeg && '沒有 ffmpeg' }, () => {
  const { audio } = dir(4, { secs: [1, 2, 1.5, 1] })
  const b = buildNarration(resolveNarrationDir(audio, '/'), { gapSec: 0.5, log: () => {} })
  assert.equal(b.starts[0], 0)
  assert.ok(Math.abs(b.starts[1] - 1.5) < 0.15, `第 2 頁起點 ${b.starts[1]}`)
  assert.ok(Math.abs(b.starts[2] - 4.0) < 0.2, `第 3 頁起點 ${b.starts[2]}`)
  assert.ok(b.durationSec > 6.5 && b.durationSec < 7.5, `總長 ${b.durationSec}`)
  assert.equal(b.transcript.length, 8)
  assert.ok(b.transcript[2].t >= b.starts[1] - 0.01 && b.transcript[3].end <= b.starts[2] + 0.01, '第 2 頁的兩句要落在第 2 頁區間')
  assert.ok(b.mp3.endsWith('narration.mp3'))
})

test('🚨 mcslide --narration：檔數≠頁數 → 連草稿都不建（0 次 API 呼叫）', async () => {
  const api = await fakeApi(); const { d } = dir(3)
  const r = await run(['deck.md', '--narration', '音檔'], { MAKECLASS_API: api.base }, d)
  api.close()
  assert.notEqual(r.code, 0)
  assert.match(r.out, /3 個，簡報 4 頁/)
  assert.equal(api.calls.length, 0)
})

test('mcslide deck.md --narration 音檔/：建草稿 → 上傳串好的音檔 → 掛導讀（timings 4 筆、遞增、有字幕）', { skip: !hasFfmpeg && '沒有 ffmpeg' }, async () => {
  const api = await fakeApi(); const { d } = dir(4)
  const r = await run(['deck.md', '--narration', '音檔'], { MAKECLASS_API: api.base }, d)
  api.close()
  assert.equal(r.code, 0, r.out)
  const n = api.state.narration
  assert.ok(n, '要呼叫 /narration')
  assert.equal(n.timings.length, 4)
  assert.equal(n.timings[0].startSec, 0)
  assert.ok(n.timings.every((t, i) => i === 0 || t.startSec > n.timings[i - 1].startSec))
  assert.equal(n.audioAssetId, 'aud_1')
  assert.ok(n.transcript.length >= 8)
  assert.ok(Object.values(api.state.puts)[0] > 1000, '串好的 mp3 要真的 PUT 上去')
  assert.match(r.out, /已建立草稿/)
})

test('mcslide narration <pushId> 音檔/：既有簡報補導讀；--dry-run 不上傳', { skip: !hasFfmpeg && '沒有 ffmpeg' }, async () => {
  const api = await fakeApi(); const { d } = dir(4, { text: false })
  const dry = await run(['narration', PUSH_ID, '音檔', '--dry-run'], { MAKECLASS_API: api.base }, d)
  assert.equal(dry.code, 0, dry.out)
  assert.match(dry.out, /沒有字幕/)
  assert.ok(!api.calls.some((c) => c.path.endsWith('/narration')))
  const r = await run(['narration', PUSH_ID, '音檔'], { MAKECLASS_API: api.base }, d)
  api.close()
  assert.equal(r.code, 0, r.out)
  assert.equal(api.state.narration.timings.length, 4)
  assert.equal(api.state.narration.transcript, null)
  assert.match(r.out, /導讀已掛上/)
})
