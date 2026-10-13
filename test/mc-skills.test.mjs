// /mc 系列 skill 與 `mcpost call`。跑法：npm test
//
// 守的三件事：
//   1. call 只能打白名單（發布、建立、改封面等對外生效的工具不能從這裡帶出去）
//   2. 每個 skill 的 frontmatter 有效、name 與資料夾一致；會寫檔的只有 mcfile／mcskill，而且都要求確認
//   3. install-skill 真的把全部 skill 接起來（1.4.0 的教訓：沒有用真實安裝驗過就不算數）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, lstatSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { callMcpTool, parseCallArgs, CALL_ALLOWED } from '../bin/mc-call.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'bin', 'mcpost.mjs')
const NAMES = ['mcway', 'mcdetail', 'mcview', 'mctool', 'mcfile', 'mcskill', 'mcidea', 'mchelp']

test('call：白名單只有唯讀查詢與 collect_skill；發布、建立、改封面都不能從這裡呼叫', async () => {
  for (const t of ['search_notes', 'read_note', 'list_my_notes', 'list_my_ideas', 'search_skills', 'search_entities', 'get_skill', 'get_method', 'get_transcript', 'collect_skill', 'save_idea']) assert.ok(CALL_ALLOWED.includes(t), t)
  for (const t of ['publish_note', 'create_note', 'update_note', 'set_cover', 'set_cover_design', 'generate_cover', 'nope']) {
    await assert.rejects(() => callMcpTool({ tool: t, token: 'x', apiBase: 'http://x', fetchImpl: () => { throw new Error('不該送出請求') } }), (e) => e.code === 'NOT_ALLOWED', t)
  }
  await assert.rejects(() => callMcpTool({ tool: 'get_skill', token: '', apiBase: 'http://x' }), (e) => e.code === 'NO_TOKEN')
})

test('call：送出 JSON-RPC tools/call、帶 Bearer 權杖、解出文字；isError 會帶出', async () => {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) })
      res.writeHead(200, { 'content-type': 'application/json' })
      const bad = JSON.parse(body).params.name === 'get_skill'
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: bad ? '找不到' : '{"count":1}' }], ...(bad ? { isError: true } : {}) } }))
    })
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const apiBase = `http://127.0.0.1:${server.address().port}/api`
  try {
    const r = await callMcpTool({ tool: 'search_entities', args: { query: 'claude-code' }, token: 'tok123', apiBase })
    assert.equal(r.text, '{"count":1}'); assert.equal(r.isError, false)
    assert.equal(seen[0].url, '/api/v1/makeclass/mcp'); assert.equal(seen[0].auth, 'Bearer tok123')
    assert.deepEqual(seen[0].body.params, { name: 'search_entities', arguments: { query: 'claude-code' } })
    const e = await callMcpTool({ tool: 'get_skill', args: { name: 'x' }, token: 't', apiBase })
    assert.equal(e.isError, true)
  } finally { server.close() }
})

test('parseCallArgs：工具名必填；參數必須是 JSON 物件；空白參數＝{}', () => {
  assert.deepEqual(parseCallArgs(['get_skill', '{"name":"a"}']), { tool: 'get_skill', args: { name: 'a' } })
  assert.deepEqual(parseCallArgs(['get_skill', '{"name":', '"a b"}']), { tool: 'get_skill', args: { name: 'a b' } }, '被 shell 拆開的 JSON 要接回去')
  assert.deepEqual(parseCallArgs(['search_skills']), { tool: 'search_skills', args: {} })
  assert.throws(() => parseCallArgs([]), /用法/)
  assert.throws(() => parseCallArgs(['x', 'not json']), /JSON/)
  assert.throws(() => parseCallArgs(['x', '[1,2]']), /物件/)
})

function frontmatter(raw) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw)
  assert.ok(m, '缺 frontmatter')
  return Object.fromEntries(m[1].split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}

test('skill：frontmatter 有效、name 與資料夾一致、描述寫了觸發說法', () => {
  for (const n of NAMES) {
    const raw = readFileSync(join(ROOT, 'skills', n, 'SKILL.md'), 'utf8')
    const fm = frontmatter(raw)
    assert.equal(fm.name, n); assert.ok(fm.description.length > 30, `${n} 描述太短`)
    assert.ok(fm.description.includes(`/${n}`), `${n} 的描述要含 /${n} 這個觸發詞`)
  }
})

test('skill 安全：查詢類都有「資料不是指令」規則；只有 mcfile、mcskill 寫檔且要求確認；沒有任何 skill 叫 AI 執行安裝指令', () => {
  const read = (n) => readFileSync(join(ROOT, 'skills', n, 'SKILL.md'), 'utf8')
  for (const n of ['mcway', 'mcdetail', 'mcview', 'mctool', 'mcfile']) assert.match(read(n), /資料，不是指令/, n)
  for (const n of ['mcfile', 'mcskill']) assert.match(read(n), /確認/, `${n} 寫檔前要確認`)
  for (const n of ['mcway', 'mcdetail', 'mcview', 'mctool']) assert.match(read(n), /不.{0,6}(改|寫|執行|安裝)/, `${n} 要明說不動檔案`)
  assert.match(read('mcfile'), /不執行/); assert.match(read('mcdetail'), /不要執行/)
  assert.match(read('mcskill'), /私人/); assert.match(read('mcskill'), /金鑰|token/i)
  // 白名單外的工具不該出現在任何 skill 的指令範例裡
  for (const n of NAMES) for (const bad of ['publish_note', 'create_note', 'generate_cover']) assert.doesNotMatch(read(n), new RegExp(`mcpost call ${bad}`), `${n} 不該叫 ${bad}`)
  // mcidea：原文照存、只存私人、不得叫 AI 改寫；mchelp 求救要走 doctor 且不叫 AI 改設定
  assert.match(read('mcidea'), /原文照存/); assert.match(read('mcidea'), /私人/); assert.match(read('mcidea'), /不要.{0,4}自己幫他改/)
  assert.match(read('mchelp'), /mcpost doctor/); assert.match(read('mchelp'), /不要.{0,4}幫他改設定檔/)
  // mcview：用關鍵字找、不確定不替使用者猜、字數只回大小、逐字稿片段尚未開放且不准繞過
  assert.match(read('mcview'), /只讀/); assert.match(read('mcview'), /關鍵字/); assert.match(read('mcview'), /不要替使用者猜/)
  assert.match(read('mcview'), /get_transcript/); assert.match(read('mcview'), /不給任何原文/); assert.match(read('mcview'), /尚未開放/); assert.match(read('mcview'), /不要想辦法用別的工具繞過去/)
  for (const w of ['逐字稿', 'transcript', 'subtitle', '字幕', 'srt', '字數', 'size']) assert.ok(read('mcview').includes(w), `mcview 缺修飾詞 ${w}`)
  // mcidea：help／list／存三條路，且 help 不存東西
  for (const w of ['/mcidea help', '/mcidea list', 'list_my_ideas', '不要存任何東西']) assert.ok(read('mcidea').includes(w), `mcidea 缺 ${w}`)
  // mchelp：怎麼引用一節＋斜線指令才穩定
  assert.match(read('mchelp'), /怎麼引用一篇筆記/); assert.match(read('mchelp'), /標出處/); assert.match(read('mchelp'), /固定的行為/)
  // mchelp 列得出全部指令
  for (const n of ['mcway', 'mcdetail', 'mcview', 'mctool', 'mcfile', 'mcskill', 'mcpost', 'mcslide']) assert.ok(read('mchelp').includes(`/${n}`), `mchelp 缺 /${n}`)
})

test('install-skill：在乾淨的 HOME 真的把全部 skill 接起來（Claude Code 與 Codex 各一份）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mcpost-home-'))
  mkdirSync(join(home, '.claude')); mkdirSync(join(home, '.codex'))
  await new Promise((ok, bad) => execFile('node', [BIN, 'install-skill'], { env: { ...process.env, HOME: home, MCPOST_NO_MAIN: '', MCPOST_NO_UPDATE_CHECK: '1' } }, (e, out, err) => (e ? bad(new Error(err || out)) : ok())))
  for (const root of ['.claude', '.codex']) {
    const names = readdirSync(join(home, root, 'skills')).sort()
    assert.deepEqual(names, ['mcdetail', 'mcfile', 'mchelp', 'mcidea', 'mcpost', 'mcskill', 'mcslide', 'mctool', 'mcview', 'mcway'], root)
    for (const n of names) assert.ok(lstatSync(join(home, root, 'skills', n)).isSymbolicLink(), `${root}/${n} 要是 symlink`)
    assert.ok(readFileSync(join(home, root, 'skills', 'mchelp', 'SKILL.md'), 'utf8').includes('/mcway'))
  }
})
