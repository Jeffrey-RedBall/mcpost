// 1.10.1：mcpost upgrade ＋ MCPOST_AUTO_UPDATE=1 自動升級
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { upgradeArgs, runUpgrade } from '../bin/update-check.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin')

test('upgradeArgs 固定是 install -g mcpost@latest', () => {
  assert.deepEqual(upgradeArgs(), ['install', '-g', 'mcpost@latest'])
})

/** 假 npm：把收到的參數寫進檔案，回 0 */
function fakeNpm() {
  const dir = mkdtempSync(join(tmpdir(), 'fake-npm-'))
  const log = join(dir, 'args.txt')
  const script = join(dir, 'npm.mjs')
  writeFileSync(script, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' '))`)
  const sh = join(dir, 'npm')
  writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
  chmodSync(sh, 0o755)
  return { bin: sh, log }
}

test('runUpgrade：真的用 npm 參數叫起來、回 exit code；找不到 npm 回 127 不丟例外', async () => {
  const npm = fakeNpm()
  assert.equal(await runUpgrade({ npm: npm.bin, stdio: 'ignore' }), 0)
  assert.equal(readFileSync(npm.log, 'utf8'), 'install -g mcpost@latest')
  assert.equal(await runUpgrade({ npm: join(tmpdir(), 'no-such-npm'), stdio: 'ignore' }), 127)
})

function run(args, env) {
  return new Promise((ok) => execFile(process.execPath, [join(BIN, 'mcpost.mjs'), ...args], {
    env: { ...process.env, MCPOST_NO_MAIN: '', MAKECLASS_TOKEN: 'mck_test', ...env },
  }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: stdout + stderr })))
}
function homeWithCache(latest) {
  const home = mkdtempSync(join(tmpdir(), 'mcpost-home-'))
  mkdirSync(join(home, '.makeclass'))
  writeFileSync(join(home, '.makeclass', 'version-check.json'), JSON.stringify({ at: Date.now(), latest }))
  return home
}
function fakeApi() {
  const server = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, data: [] })) }) })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${server.address().port}/api`, close: () => server.close() })))
}

test('CLI：落後時提醒文字指向 mcpost upgrade；MCPOST_AUTO_UPDATE=1 會自動叫 npm', async () => {
  const api = await fakeApi()
  const r1 = await run(['channels'], { MAKECLASS_API_BASE: api.base, HOME: homeWithCache('99.0.0') })
  assert.equal(r1.code, 0, r1.out)
  assert.match(r1.out, /有新版 99\.0\.0/)
  assert.match(r1.out, /mcpost upgrade/)

  const npm = fakeNpm()
  const r2 = await run(['channels'], { MAKECLASS_API_BASE: api.base, HOME: homeWithCache('99.0.0'), MCPOST_AUTO_UPDATE: '1', MCPOST_NPM: npm.bin })
  api.close()
  assert.equal(r2.code, 0, r2.out)
  assert.match(r2.out, /自動升級中/)
  assert.ok(existsSync(npm.log), '自動升級要真的叫 npm')
  assert.equal(readFileSync(npm.log, 'utf8'), 'install -g mcpost@latest')
})

test('CLI：mcpost upgrade --dry-run 只印指令不跑', async () => {
  const r = await run(['upgrade', '--dry-run'], { HOME: homeWithCache('0.0.1'), MCPOST_NPM: join(tmpdir(), 'no-such-npm') })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /會跑：npm install -g mcpost@latest/)
})

// doctor 的版本行：發布時間與安裝時間
import { versionLines, fmtTime } from '../bin/update-check.mjs'

test('versionLines：有時間就印、沒有就省略；落後指向 upgrade；離線也有話說', () => {
  const times = { '1.10.1': '2026-11-21T11:05:00Z', '1.10.2': '2026-11-22T01:00:00Z' }
  const [a, b] = versionLines({ mine: '1.10.1', latest: '1.10.2', times, installed: '2026-11-21T11:10:00Z' })
  assert.match(a, /^套件版本   1\.10\.1（npm 發布 \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}，裝在這台 \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}）$/)
  assert.match(b, /^registry   1\.10\.2（npm 發布 .+）  ← 你落後了（打 mcpost upgrade）$/)
  const [c, d] = versionLines({ mine: '1.10.2', latest: '1.10.2', times: {}, installed: null })
  assert.equal(c, '套件版本   1.10.2')
  assert.equal(d, 'registry   1.10.2  ✓')
  assert.equal(versionLines({ mine: '1.0.0', latest: null })[1], 'registry   （查不到，可能是離線）')
  assert.equal(fmtTime('not-a-date'), null)
  assert.equal(fmtTime(null), null)
})
