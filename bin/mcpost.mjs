#!/usr/bin/env node
/**
 * mcpost — 把開發對話或觀點文，從任何終端機直接發到 MakeClass。
 *
 * 為什麼會有這支獨立套件：原本這兩支邏輯活在 MakeClass 的私有主程式 repo 裡
 * （skills/makeclass-blog/bin/makeclass-push.mjs、scripts/mc-post.mjs），
 * 要用就得 clone 整包 2GB 的公司原始碼——但後端 API 本來就是用 Token 驗證，
 * 跟 repo 存取權限完全無關（比照 Notion API：@notionhq/client 是獨立套件，
 * 不需要 clone Notion 自己的原始碼）。這支把「發文」這個獨立能力抽出來單獨發布。
 *
 * 用法：
 *   npx mcpost token              # 互動輸入 Personal Access Token 並存檔
 *   npx mcpost devlog <file.md> [--dry-run] [--yes]     # 送 DevLog（進 Vibe Coding 專區）
 *   npx mcpost post --title "..." --body <file|文字> [--post]   # 送一般文章 / 觀點文
 *   npx mcpost channels           # 列出我的頻道（含 handle），發文前不用先開網頁查
 *   npx mcpost install-skill      # 幫 Claude Code 與 Codex 裝 /mcpost 與 /mcslide
 *
 * 刻意零 npm 依賴——任何 agent 的沙箱都能直接 node 跑，不用先 npm install 別的東西。
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, unlinkSync, lstatSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { findLocalImages, oversizedImages, uploadImages, rewriteImageUrls, ImageUploadError, IMG_MIME, MAX_IMAGE_BYTES } from './images.mjs'
import { installApiFetch, localVersion, latestVersion, isOlder, nudgeIfOutdated } from './update-check.mjs'

const API_BASE = process.env.MAKECLASS_API_BASE
  || 'https://asia-east1-makeclass-prod.cloudfunctions.net/api'

const TOKEN_FILE = join(homedir(), '.makeclass', 'token')

// 所有打 MakeClass 的請求自動帶版本、印出後端的升級提醒（./update-check.mjs，與 mcslide 共用）
installApiFetch(API_BASE, { tool: 'mcpost' })

const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

function resolveToken(argToken) {
  if (argToken) return argToken
  if (process.env.MAKECLASS_TOKEN) return process.env.MAKECLASS_TOKEN
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim()
  return null
}

function die(msg, hint) {
  console.error(`\n✗ ${msg}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────
// token 子指令：互動輸入或直接帶值，存到 ~/.makeclass/token
// ─────────────────────────────────────────────────────────────────────────
async function cmdToken(args) {
  const inline = args.find((a) => !a.startsWith('-'))
  let value = inline

  if (!value) {
    if (!process.stdin.isTTY) {
      die('非互動環境沒有帶值，無法設定 token', '用法：mcpost token mck_xxxx')
    }
    console.log('去 https://makeclass.me/settings/tokens 建一支 Personal Access Token')
    console.log('（一般文章勾「發表內容」；要進 Vibe Coding 專區的 devlog 另外勾 devlog:write）')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    value = (await rl.question('貼上 token：')).trim()
    rl.close()
  }

  if (!value) die('沒有拿到 token，取消設定')
  if (!value.startsWith('mck_')) {
    console.error('⚠️ 這串不是 mck_ 開頭，看起來不像 MakeClass token，仍照你貼的存起來')
  }
  mkdirSync(dirname(TOKEN_FILE), { recursive: true })
  writeFileSync(TOKEN_FILE, value, 'utf8')
  chmodSync(TOKEN_FILE, 0o600)
  console.log(`✓ Token 已存到 ${TOKEN_FILE}（chmod 600）`)
}

// ─────────────────────────────────────────────────────────────────────────
// devlog 子指令：DevLog v1 → Vibe Coding 專區（原 makeclass-push.mjs 邏輯）
// ─────────────────────────────────────────────────────────────────────────
const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'OpenAI/Anthropic 風格 API key'],
  [/\bAIza[0-9A-Za-z_-]{30,}/, 'Google API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained PAT'],
  [/\bmck_[A-Za-z0-9]{20,}/, 'MakeClass access token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私鑰'],
  [/\b(?:postgres|postgresql|mysql|mongodb)(?:\+srv)?:\/\/[^\s:@]+:[^\s@]+@/, 'DB 連線字串（含密碼）'],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/, 'Bearer token'],
  [/^[A-Z][A-Z0-9_]{3,}=\S{16,}$/m, '.env 形式的變數賦值'],
]

const CLIENT_MASKS = [
  [/CMC01|中華汽車/g, '<客戶A>'],
  [/裕隆/g, '<客戶B>'],
  [/TD-?VIP/gi, '<客戶C>'],
  [/百思客/g, '<客戶D>'],
  [/荷風/g, '<客戶E>'],
]

const REQUIRED = ['makeclass', 'title', 'question', 'category']

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) throw new Error('找不到 YAML frontmatter（檔案必須以 --- 開頭）')
  const [, head, body] = m
  const out = {}
  const lines = head.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) { i++; continue }
    const [, key, rest] = kv
    if (rest.trim() === '|' || rest.trim() === '|-') {
      const buf = []
      i++
      while (i < lines.length && (lines[i].startsWith('  ') || !lines[i].trim())) {
        buf.push(lines[i].replace(/^ {2}/, ''))
        i++
      }
      out[key] = buf.join('\n').trim()
      continue
    }
    if (rest.trim() === '') {
      const child = {}
      i++
      while (i < lines.length && /^ {2}\S/.test(lines[i])) {
        const ckv = lines[i].match(/^ {2}([A-Za-z_][\w-]*):\s*(.*)$/)
        if (ckv) child[ckv[1]] = scalar(ckv[2])
        i++
      }
      out[key] = child
      continue
    }
    out[key] = scalar(rest)
    i++
  }
  return { frontmatter: out, body: body.trim() }
}

function scalar(v) {
  const t = v.trim().replace(/\s+#.*$/, '')
  if (t.startsWith('[') && t.endsWith(']')) {
    return t.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }
  const unq = t.replace(/^["']|["']$/g, '')
  if (unq === 'true') return true
  if (unq === 'false') return false
  return unq
}

function validateDevlog(fm) {
  const errs = []
  if (fm.makeclass !== 'devlog/v1') errs.push(`makeclass 必須是 "devlog/v1"（目前：${fm.makeclass ?? '缺'}）`)
  for (const k of REQUIRED) {
    if (k === 'makeclass') continue
    if (!fm[k] || String(fm[k]).trim() === '') errs.push(`缺必填欄位：${k}`)
  }
  if (fm.title && String(fm.title).length > 120) errs.push('title 超過 120 字')
  if (fm.category && fm.category !== 'vibecoding') errs.push(`category 目前只接受 "vibecoding"（目前：${fm.category}）`)
  if (!fm.source?.agent) errs.push('缺必填欄位：source.agent（claude-code / codex / cursor…）')
  return errs
}

function scanSecrets(text) {
  const hits = []
  const lines = text.split(/\r?\n/)
  for (const [re, label] of SECRET_PATTERNS) {
    lines.forEach((line, idx) => {
      const probe = new RegExp(re.source, re.flags.replace('m', ''))
      if (probe.test(line)) hits.push({ line: idx + 1, label, text: line.trim().slice(0, 80) })
    })
  }
  return hits
}

function maskClients(text) {
  let out = text
  const hit = []
  for (const [re, rep] of CLIENT_MASKS) {
    if (re.test(out)) hit.push(rep)
    out = out.replace(re, rep)
  }
  return { text: out, masked: [...new Set(hit)] }
}

function fingerprint(text) {
  const t = String(text || '')
  return {
    chars: t.replace(/\s/g, '').length,
    headings: (t.match(/^##+ /gm) || []).length,
    tableRows: (t.match(/^\s*\|/gm) || []).length,
    codeFences: Math.floor((t.match(/^```/gm) || []).length / 2),
  }
}

async function cmdDevlog(argv) {
  const file = argv.find((a) => !a.startsWith('-'))
  const has = (f) => argv.includes(f)
  const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null }

  if (!file) die('用法：mcpost devlog <devlog.md> [--dry-run] [--yes] [--no-mask-clients] [--token <t>]')

  const raw = readFileSync(file, 'utf8')
  let parsed
  try {
    parsed = parseFrontmatter(raw)
  } catch (e) {
    die(e.message)
  }
  const { frontmatter: fm } = parsed
  let { body } = parsed

  const errs = validateDevlog(fm)
  if (errs.length) {
    console.error('✗ DevLog v1 格式不合：')
    errs.forEach((e) => console.error(`   · ${e}`))
    process.exit(1)
  }

  const secrets = scanSecrets(raw)
  if (secrets.length) {
    console.error(`\n🚨 偵測到 ${secrets.length} 處疑似機密，已中止（不會送出）：\n`)
    secrets.forEach((h) => console.error(`   L${h.line}  [${h.label}]  ${h.text}`))
    console.error('\n請先移除或改寫這幾行再送。這道閘門沒有 --force。\n')
    process.exit(1)
  }

  let maskedNames = []
  if (!has('--no-mask-clients')) {
    const r = maskClients(body)
    body = r.text
    maskedNames = r.masked
  }

  const visibility = fm.visibility === 'public' ? 'public' : 'unlisted'

  // 正文裡的本地圖片：路徑相對於 devlog 檔案本身，不是你站在哪個目錄
  const localImages = has('--no-images') ? [] : findLocalImages(body, dirname(resolvePath(file)))
  const tooBig = oversizedImages(localImages)
  if (tooBig.length) {
    die(`圖片太大：${tooBig.map((i) => `${i.raw}（${(i.bytes / 1024 / 1024).toFixed(1)} MB）`).join('、')}`,
      `單張上限 ${MAX_IMAGE_BYTES / 1024 / 1024} MB，請先壓縮`)
  }

  console.log('\n─────────── MakeClass DevLog preview ───────────')
  console.log(`標題      ${fm.title}`)
  if (fm.subtitle) console.log(`副標      ${fm.subtitle}`)
  console.log(`專區      ${fm.category}`)
  console.log(`來源      ${fm.source.agent}${fm.source.model ? ` / ${fm.source.model}` : ''}`)
  if (fm.tags?.length) console.log(`標籤      ${[].concat(fm.tags).join(', ')}`)
  console.log(`能見度    ${visibility}${visibility === 'unlisted' ? '（不進公開牆）' : '  ⚠️ 公開'}`)
  console.log(`字數      ${body.length}`)
  if (localImages.length) console.log(`圖片      ${localImages.length} 張本地圖片，送出後自動上傳`)
  if (maskedNames.length) console.log(`已遮罩    ${maskedNames.join(', ')}`)
  if (has('--no-mask-clients')) console.log('⚠️ 客戶名遮罩已關閉（--no-mask-clients）')
  console.log('────────────────────────────────────────────────\n')
  console.log(body.split('\n').slice(0, 12).join('\n'))
  console.log(body.split('\n').length > 12 ? '\n…（略）\n' : '')

  if (has('--dry-run')) {
    console.log('✓ 格式合規、無機密。--dry-run 未送出。')
    return
  }

  const token = resolveToken(argOf('--token'))
  if (!token) {
    die('找不到 token', '跑 `mcpost token` 設定一次，或 export MAKECLASS_TOKEN=mck_xxx')
  }

  if (!has('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ans = await rl.question('確認送出？(y/N) ')
    rl.close()
    if (!/^y(es)?$/i.test(ans.trim())) { console.log('已取消。'); return }
  }

  const res = await fetch(`${API_BASE}/v1/makeclass/devlog/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ frontmatter: { ...fm, visibility }, body }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) {
    die(`送出失敗 (${res.status})：${json.error || res.statusText}`)
  }
  console.log(`\n✓ 已送進 MakeClass：${json.url || json.pushId}`)
  const pushId = json.pushId || String(json.url || '').split('/').pop()

  // 圖片要掛在某一篇底下，所以跟 post 一樣是「先建 → 傳圖 → 用網址更新正文」。
  // devlog/ingest 一次就建好整篇、沒有「先拿 id」這一步，所以只能事後補 PATCH。
  // ⚠️ PATCH 走的是一般內容端點，權杖除了 devlog:write 還要有 pusher:write。
  if (localImages.length) {
    const recover = `草稿已建立但圖片沒補上：${json.url || pushId}（正文的圖仍指向本機路徑，站上不顯示）`
    console.log(`\n找到 ${localImages.length} 張本地圖片，開始上傳：`)
    const map = await uploadImagesOrDie(localImages, pushId, token, recover)
    body = rewriteImageUrls(body, map)
    const r2 = await fetch(`${API_BASE}/v1/makeclass/pusher/${encodeURIComponent(pushId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ articleBody: body }),
    }).catch((e) => die(`連不上 API：${e.message}`, recover))
    const j2 = await r2.json().catch(() => ({}))
    // 這裡失敗不能默默略過：草稿會留著一堆指向本機路徑的圖，發布出去就是一篇沒有圖的文章
    if (!r2.ok || j2.success === false) {
      die(`圖片已上傳，但正文更新失敗（HTTP ${r2.status}）：${j2.error || '（伺服器沒說原因）'}`,
        (r2.status === 403 ? '權杖要同時有 devlog:write 與「發表內容」(pusher:write)\n  ' : '') + recover)
    }
  }

  if (!has('--no-verify')) {
    process.stdout.write('  回讀驗證中… ')
    let remote = null
    for (let i = 0; i < 3 && !remote; i++) {
      if (i) await new Promise((r) => setTimeout(r, 1500))
      const g = await fetch(`${API_BASE}/v1/makeclass/pusher/${pushId}`).catch(() => null)
      if (g?.ok) remote = (await g.json().catch(() => null))?.data ?? null
    }
    if (!remote) {
      die('回讀失敗：伺服器回報成功，但這篇讀不到，請不要當成已送出。',
        `${API_BASE}/v1/makeclass/pusher/${pushId} 取不到內容。`)
    }
    const src = fingerprint(body)
    const got = fingerprint(remote.articleBody)
    const charOk = got.chars >= src.chars * 0.95
    const diffs = []
    if (!charOk) diffs.push(`字數 ${src.chars} → ${got.chars}`)
    for (const k of ['headings', 'tableRows', 'codeFences']) {
      if (src[k] !== got[k]) diffs.push(`${k} ${src[k]} → ${got[k]}`)
    }
    if (diffs.length) {
      console.error('\n✗ 回讀驗證不通過——存進去的內容與原檔對不上：')
      diffs.forEach((d) => console.error(`    ${d}`))
      die(`請先看過 ${json.url} 再決定是否重送。`)
    }
    console.log(`OK（正文 ${got.chars} 字｜標題 ${got.headings}｜表格 ${got.tableRows} 列｜程式碼 ${got.codeFences} 塊）`)
  }

  console.log('  預設為草稿 + unlisted，請到 MakeClass 確認內容後再按發布。')
}

// ─────────────────────────────────────────────────────────────────────────
// post 子指令：一般文章 / 觀點文（原 scripts/mc-post.mjs 邏輯）
// ─────────────────────────────────────────────────────────────────────────
function readTake(spec, extraWords) {
  if (!spec || spec === true) return null
  if (spec === '-') {
    let t = ''
    try { t = readFileSync(0, 'utf8') } catch { t = '' }
    if (!t.trim()) die('--take - 沒讀到任何內容', '用管線：echo "想法" | mcpost post --take -')
    return t
  }
  if (existsSync(spec)) return readFileSync(spec, 'utf8')
  if (/^[.~/]|\.(md|txt)$/.test(spec)) die(`找不到檔案：${spec}`)
  return [spec, ...(extraWords || [])].join(' ')
}

// 圖片的辨識、上傳、換網址都在 ./images.mjs（post／devlog／mcslide 共用）。
// 這裡只包一層：上傳失敗一律 die——走到這一步草稿已經建了，要把下一步講清楚。
async function uploadImagesOrDie(images, pushId, token, recoverHint) {
  try {
    return await uploadImages(images, { pushId, token, apiBase: API_BASE })
  } catch (e) {
    if (e instanceof ImageUploadError) die(e.message, [e.hint, recoverHint].filter(Boolean).join('\n  '))
    throw e
  }
}

function parseArgsLoose(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else { out[key] = next; i++ }
    } else out._.push(a)
  }
  return out
}

/** 送出後回讀比對，抓「API 說成功但東西其實不在／被剝光」。失敗就直接 die，不算成功。 */
async function verifyPostPersisted({ pushId, headers, expectedBody }) {
  process.stdout.write('  回讀驗證中… ')
  let remote = null
  for (let i = 0; i < 3 && !remote; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1500))
    const g = await fetch(`${API_BASE}/v1/makeclass/pusher/${pushId}`, { headers }).catch(() => null)
    if (g?.ok) remote = (await g.json().catch(() => null))?.data ?? null
  }
  if (!remote) {
    die('回讀失敗：伺服器回報成功，但這篇讀不到，請不要當成已送出。',
      `${API_BASE}/v1/makeclass/pusher/${pushId} 取不到內容。`)
  }
  if (!expectedBody) { console.log('OK（沒有可比對的正文欄位，只確認資料存在）'); return }

  const src = fingerprint(expectedBody)
  const got = fingerprint(remote.articleBody)
  const charOk = got.chars >= src.chars * 0.95
  const diffs = []
  if (!charOk) diffs.push(`字數 ${src.chars} → ${got.chars}`)
  for (const k of ['headings', 'tableRows', 'codeFences']) {
    if (src[k] !== got[k]) diffs.push(`${k} ${src[k]} → ${got[k]}`)
  }
  if (diffs.length) {
    console.error('\n✗ 回讀驗證不通過——存進去的內容與原檔對不上：')
    diffs.forEach((d) => console.error(`    ${d}`))
    die(`請先看過 https://makeclass.me/pusher/${pushId}/review 再決定是否重送。`)
  }
  console.log(`OK（正文 ${got.chars} 字｜標題 ${got.headings}｜表格 ${got.tableRows} 列｜程式碼 ${got.codeFences} 塊）`)
}

/**
 * --channel 接受兩種寫法：cuid（原樣當 channelId 用）或 @handle（先查出 id 再用）。
 * by-handle 是公開端點，不用帶 token——查錯字或頻道不存在時要講清楚，
 * 不要讓一個打錯的 handle 靜靜地變成「不分類」送出去。
 */
async function resolveChannel(spec) {
  if (typeof spec !== 'string' || !spec.startsWith('@')) return spec
  const handle = spec.slice(1)
  const r = await fetch(`${API_BASE}/v1/makeclass/channels/by-handle/${encodeURIComponent(handle)}`)
    .catch((e) => die(`連不上 API：${e.message}`))
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.success) die(`找不到頻道 @${handle}`, '確認 handle 有沒有打對（頻道頁網址 /c/@xxx 那一段）')
  return j.data.id
}

/** 文章網址或 pushId → pushId。認 /learn/<id>、/pusher/<id>(/review)，或直接給 id */
export function pushIdFrom(input) {
  const s = String(input || '').trim()
  const m = s.match(/\/(?:learn|pusher)\/([a-z0-9]{20,40})(?:[/?#]|$)/i)
  if (m) return m[1]
  return /^[a-z0-9]{20,40}$/i.test(s) ? s : null
}

async function cmdPost(argv) {
  const args = parseArgsLoose(argv)
  const token = resolveToken(typeof args.token === 'string' ? args.token : null)
  if (!token) die('找不到 token', '跑 `mcpost token` 設定一次，或 export MAKECLASS_TOKEN=mck_xxx')
  if (!token.startsWith('mck_')) die('token 格式不對（應以 mck_ 開頭）')

  // ── --from：拿站上一篇當參考，加上我的觀點，交給站上的 AI 寫成 Post 草稿（扣 3 點）──
  // 跟網頁 learn 頁的「發成 Post」打同一支 /to-post。產出一律是 unlisted 草稿，人審完才發布。
  if (typeof args.from === 'string') {
    const id = pushIdFrom(args.from)
    if (!id) die(`看不懂 --from：${args.from}`, '給 MakeClass 文章網址（https://makeclass.me/learn/<id>）或 pushId')
    const take = readTake(args.take, args._)
    if (!take || take.trim().length < 10) die('缺少 --take（你的觀點，至少 10 個字）', '這篇 Post 的主角是你的想法；--take 可以是文字、檔案路徑或 -（從 stdin 讀）')
    console.log('\n交給站上的 AI 寫（約半分鐘，會使用 3 點）…')
    const r = await fetch(`${API_BASE}/v1/makeclass/pusher/${encodeURIComponent(id)}/to-post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ take }),
    }).catch((e) => die(`連不上 API：${e.message}`))
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.success) {
      if (j.code === 'INSUFFICIENT') die(j.error, '到 makeclass.me 的「點數」頁儲值後再試')
      die(`失敗（${r.status}）：${j.error || ''}`, r.status === 403 ? '權杖要勾「發表內容」（pusher:write）' : '')
    }
    const d = j.data || {}
    console.log(`✓ 已寫成草稿：${d.title || ''}（參考素材：${d.sourceKind}）`)
    console.log(`  ${d.reviewUrl}`)
    console.log(`  扣 ${d.cost} 點${d.balance != null ? `，餘額 ${d.balance}` : ''}　到上面的網址看過、改過再按發布`)
    return
  }

  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!title && typeof args.update !== 'string') die('缺少 --title')

  const channelId = typeof args.channel === 'string' ? await resolveChannel(args.channel) : null

  const take = readTake(args.take, args._)
  const articleBody = readTake(args.body, args.take ? [] : args._)
  // 正文裡的相對路徑要相對於「正文那個檔案」，不是相對於你現在站在哪個目錄
  const bodyDir = typeof args.body === 'string' && existsSync(args.body) ? dirname(resolvePath(args.body)) : process.cwd()
  const localImages = articleBody && !args['no-images'] ? findLocalImages(articleBody, bodyDir) : []
  const body = {
    title,
    ...(typeof args.subtitle === 'string' ? { subtitle: args.subtitle } : {}),
    ...(typeof args.source === 'string' ? { sourceUrl: args.source } : {}),
    ...(channelId ? { channelId } : {}),
    ...(take ? { contentSummary: take } : {}),
    ...(articleBody ? { articleBody } : {}),
    ...(args.post ? { contentType: 'post' } : {}),
    // 不送 visibility：後端對 PAT 一律 unlisted（functions/utils/visibilityPolicy.js）。
    // 以前這裡寫死 'public'，看程式碼會以為發出去就是公開的——實際上那是
    // 後端當時漏了強制，不是這支的權限。
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const updateId = typeof args.update === 'string' ? args.update.trim() : ''
  if (updateId) {
    const patch = {}
    if (title) patch.title = title
    if (typeof args.subtitle === 'string') patch.subtitle = args.subtitle
    if (articleBody) patch.articleBody = articleBody
    if (channelId) patch.channelId = channelId
    if (take) patch.contentSummary = take
    if (Object.keys(patch).length === 0) die('--update 沒有指定要改什麼', '至少給 --title / --body / --take 其中一個')

    // 已經有 pushId，圖片可以先傳完再送正文，一次 PATCH 就定案
    if (localImages.length && patch.articleBody) {
      console.log(`\n找到 ${localImages.length} 張本地圖片，先上傳：`)
      patch.articleBody = rewriteImageUrls(patch.articleBody, await uploadImagesOrDie(localImages, updateId, token))
    }

    const r = await fetch(`${API_BASE}/v1/makeclass/pusher/${encodeURIComponent(updateId)}`, {
      method: 'PATCH', headers, body: JSON.stringify(patch),
    }).catch((e) => die(`連不上 API：${e.message}`))
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.success === false) {
      die(`更新失敗（HTTP ${r.status}）：${j.error || '（伺服器沒說原因）'}`,
        r.status === 403 ? '只有作者本人可以改，且權杖要有 pusher:write'
          : r.status === 404 ? '找不到這個 pushId' : undefined)
    }
    if (!args['no-verify']) {
      await verifyPostPersisted({ pushId: updateId, headers, expectedBody: articleBody || undefined })
    }

    const url = `https://makeclass.me/learn/${updateId}`
    console.log(`\n✓ 已更新：${Object.keys(patch).join('、')}`)
    console.log(`  ${url}`)
    return
  }

  const res = await fetch(`${API_BASE}/v1/makeclass/pusher/create`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }).catch((e) => die(`連不上 API：${e.message}`))
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) {
    die(`建立失敗（HTTP ${res.status}）：${json.error || '（伺服器沒說原因）'}`,
      res.status === 401 ? '權杖無效或已撤銷 → 到 /settings/tokens 重新建一支'
        : res.status === 403 ? '這支權杖沒有 pusher:write 權限 → 建立時要勾「發表內容」' : undefined)
  }
  const pushId = json.pushId

  // 圖片要掛在某一篇底下，所以順序是「先建草稿拿 pushId → 傳圖 → 用網址更新正文」。
  // 中間那一瞬間草稿裡的圖連結還是本機路徑（站上不顯示），但它是草稿、還沒發布，不影響讀者。
  let finalBody = articleBody
  if (localImages.length) {
    console.log(`\n找到 ${localImages.length} 張本地圖片，開始上傳：`)
    finalBody = rewriteImageUrls(articleBody, await uploadImagesOrDie(localImages, pushId, token, `草稿還在 https://makeclass.me/pusher/${pushId}/review —— 重跑：mcpost post --update ${pushId} --body <檔案>`))
    const r2 = await fetch(`${API_BASE}/v1/makeclass/pusher/${encodeURIComponent(pushId)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ articleBody: finalBody }),
    }).catch((e) => die(`連不上 API：${e.message}`))
    const j2 = await r2.json().catch(() => ({}))
    // ⚠️ 這裡失敗不能默默略過：草稿會留著一堆指向本機路徑的圖，發布出去就是一篇沒有圖的文章
    if (!r2.ok || j2.success === false) {
      die(`圖片已上傳，但正文更新失敗（HTTP ${r2.status}）：${j2.error || '（伺服器沒說原因）'}`,
        `草稿還在 https://makeclass.me/pusher/${pushId}/review —— 重跑：mcpost post --update ${pushId} --body <檔案>`)
    }
  }

  if (!args['no-verify']) {
    await verifyPostPersisted({ pushId, headers, expectedBody: finalBody || undefined })
  }

  const url = `https://makeclass.me/pusher/${pushId}/review`
  console.log(`\n✓ 已建立草稿：${url}`)
  console.log('  草稿、不進公開牆——到上面的連結看過內容，確認後自己按發布')
}

// ─────────────────────────────────────────────────────────────────────────
// channels：列出自己有哪些頻道（含 handle），發文前不用先去網頁查
// ─────────────────────────────────────────────────────────────────────────
async function cmdChannels(argv) {
  const args = parseArgsLoose(argv)
  const token = resolveToken(typeof args.token === 'string' ? args.token : null)
  if (!token) die('找不到 token', '跑 `mcpost token` 設定一次，或 export MAKECLASS_TOKEN=mck_xxx')
  if (!token.startsWith('mck_')) die('token 格式不對（應以 mck_ 開頭）')

  const r = await fetch(`${API_BASE}/v1/makeclass/channels/mine-for-token`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch((e) => die(`連不上 API：${e.message}`))
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.success) {
    die(`查詢失敗（HTTP ${r.status}）：${j.error || '（伺服器沒說原因）'}`,
      r.status === 401 ? '權杖無效或已撤銷 → 到 /settings/tokens 重新建一支'
        : r.status === 403 ? '這支權杖沒有 pusher:read 權限 → 建立時要勾「讀取內容」' : undefined)
  }
  const channels = j.data || []
  if (channels.length === 0) {
    console.log('你還沒有任何頻道，去 https://makeclass.me 開一個吧')
    return
  }
  console.log(`\n你的頻道（${channels.length}）：\n`)
  for (const c of channels) {
    const tags = [c.isDefault ? '預設' : null, c.role === 'editor' ? '共編' : null].filter(Boolean)
    console.log(`  @${c.handle}${tags.length ? `（${tags.join('、')}）` : ''} — ${c.displayName}`)
  }
  console.log('\n發文時帶：mcpost post --channel @<handle> ...')
}

// ─────────────────────────────────────────────────────────────────────────
// 版本檢查與 doctor
//
// 為什麼只在 install-skill / doctor 查，不是每個指令都查：
//   每次都查等於每次多一個網路請求，離線就卡住。而使用者在意「我的環境對不對」
//   就是這兩個時機。其餘指令該做什麼做什麼，不要被檢查拖慢。
//
// ⚠️ 查不到一律靜默略過 —— 網路不通不該讓安裝失敗。
// ─────────────────────────────────────────────────────────────────────────
// localVersion／userAgent／latestVersion／isOlder／nudgeIfOutdated 在 ./update-check.mjs（與 mcslide 共用）

async function warnIfOutdated() {
  const mine = localVersion(), latest = await latestVersion()
  if (!isOlder(mine, latest)) return false
  console.log(`\n⚠️  你裝的是 ${mine}，最新是 ${latest}`)
  console.log('   升級：npm install -g mcpost')
  console.log('   升級後跑 mcpost doctor 確認——一般升級 skill 捷徑不受影響；用 npx 或換了 Node 版本才要重跑 install-skill')
  return true
}

/** skill symlink 現在指到哪（不存在回 null） */
function skillTarget(root, name) {
  const p = join(homedir(), root, 'skills', name)
  try { return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : `（不是 symlink）${p}` } catch { return null }
}

async function cmdDoctor() {
  const mine = localVersion()
  console.log('mcpost doctor\n')
  console.log(`套件版本   ${mine}`)
  console.log(`安裝位置   ${PKG_DIR}`)

  const latest = await latestVersion()
  if (latest === null) console.log('registry   （查不到，可能是離線）')
  else if (isOlder(mine, latest)) console.log(`registry   ${latest}  ← 你落後了`)
  else console.log(`registry   ${latest}  ✓`)

  console.log(`\n權杖       ${existsSync(TOKEN_FILE) || process.env.MAKECLASS_TOKEN ? '已設定' : '缺（跑 mcpost token）'}`)

  console.log('\nSkill 安裝狀況：')
  let stale = false, missing = false
  for (const [root, label] of [['.claude', 'Claude Code'], ['.codex', 'Codex']]) {
    if (!existsSync(join(homedir(), root))) { console.log(`  ${label.padEnd(12)}（沒偵測到，略過）`); continue }
    for (const name of ['mcpost', 'mcslide']) {
      const t = skillTarget(root, name)
      if (!t) { console.log(`  ${label.padEnd(12)}/${name.padEnd(8)} ✗ 沒安裝`); missing = true; continue }
      // symlink 指的是套件目錄或它底下 —— 不一致代表指著另一份安裝
      const ok = t === PKG_DIR || t.startsWith(PKG_DIR + '/')
      console.log(`  ${label.padEnd(12)}/${name.padEnd(8)} ${ok ? '✓' : '⚠️ 指向別處：' + t}`)
      if (!ok) stale = true
    }
  }

  if (stale || missing) {
    console.log('\n→ 跑 `mcpost install-skill` 重新指向這一份安裝')
    if (stale) console.log('   （指向別處＝你有兩份程式碼，改了其中一份另一份不會變）')
  } else {
    console.log('\n✓ 都指向這一份安裝')
  }
  if (isOlder(mine, latest)) await warnIfOutdated()
}

// ─────────────────────────────────────────────────────────────────────────
// install-skill：幫 Claude Code 裝 /mcpost 與 /mcslide（需要先 npm install -g mcpost）
//
// 兩個 skill、一個套件：使用者記的是動作（發文／做簡報），裝的只有一包。
// ⚠️ /mcpost 的 symlink 指向套件根目錄（根目錄的 SKILL.md 就是它），
//    這是為了**相容舊版**——已經裝過的人不用重裝。/mcslide 指向 skills/mcslide。
// ─────────────────────────────────────────────────────────────────────────
function linkSkill(root, name, target) {
  const dest = join(homedir(), root, 'skills', name)
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest) || (() => { try { return !!lstatSync(dest) } catch { return false } })()) {
    const isLink = (() => { try { return lstatSync(dest).isSymbolicLink() } catch { return false } })()
    if (!isLink) die(`${dest} 已存在且不是 symlink，請先手動處理`)
    unlinkSync(dest)
  }
  symlinkSync(target, dest)
  console.log(`✓ ${dest}`)
}

function cmdInstallSkill() {
  // Claude Code 與 Codex 的 skill 格式相同（SKILL.md + frontmatter），
  // 差別只有放哪個目錄 → 同一份 symlink 兩邊都能用。
  // Codex 只在它裝過（~/.codex 存在）時才裝，免得在沒用 Codex 的機器上亂建目錄。
  const roots = [['.claude', 'Claude Code']]
  if (existsSync(join(homedir(), '.codex'))) roots.push(['.codex', 'Codex'])

  for (const [root, label] of roots) {
    console.log(`\n${label}：`)
    linkSkill(root, 'mcpost', PKG_DIR)
    linkSkill(root, 'mcslide', join(PKG_DIR, 'skills', 'mcslide'))
  }
  if (roots.length === 1) console.log('\n（沒偵測到 ~/.codex，略過 Codex）')
  console.log('\n驗證：開 Claude Code 或 Codex，輸入 /mcpost 或 /mcslide')
  console.log('   有問題就跑 `mcpost doctor`')
  console.log('\n⚠️ symlink 指向全域 npm 安裝位置，之後跑 `npm update -g mcpost` 會自動生效。')
  console.log('   如果是用 npx（沒有全域安裝），symlink 之後可能失效，建議改用 `npm install -g mcpost`。')
}

// ─────────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
mcpost — 把開發對話或觀點文直接發到 MakeClass（不需要 clone 主程式）

指令：
  mcpost token [value]                    設定 Personal Access Token
  mcpost devlog <file.md> [options]       送 DevLog（進 Vibe Coding 專區）
  mcpost post [options]                   送一般文章 / 觀點文
  mcpost channels                         列出我的頻道（含 handle，供 --channel 用）
  mcpost install-skill                    幫 Claude Code 與 Codex 裝 /mcpost 與 /mcslide
  mcpost doctor                           檢查版本、權杖、skill 指到哪（環境不對時先跑這個）

devlog 選項：--dry-run  --yes  --no-mask-clients  --no-verify  --no-images  --token <t>
post 選項：  --title <t>  --subtitle <t>  --source <url>  --take <文字|檔案|->
             --body <檔案>  --channel <id 或 @handle>  --post  --update <pushId>
             --from <文章網址或 pushId> --take <觀點>：拿站上一篇當參考，AI 寫成你的 Post 草稿（3 點）
             --no-verify  --no-images（不要自動上傳正文裡的本地圖片）

圖文並茂：正文裡寫 ![說明](./img/a.png) 就好，post／devlog／mcslide 都會自動把本地圖片
上傳到 MakeClass 再換成 https 網址（站上只顯示 https 的圖）。路徑相對於正文那個檔案。

做簡報用另一個指令（同一包、同一支權杖）：
  mcslide <file.md> [--source <pushId>] [--channel @handle] [--dry-run]
  mcslide from <pushId> [--pages 20]      交給站上的 AI 讀那篇來做

Token 讀取順序：--token > $MAKECLASS_TOKEN > ~/.makeclass/token
環境變數 MAKECLASS_API_BASE 可覆寫 API 位址（預設正式站）
`)
}

// 測試要 import 這支拿純函式，但這個檔案同時是 CLI 入口。
//
// 🚨 1.4.0 這裡用 `import.meta.url === pathToFileURL(process.argv[1]).href` 判斷「是不是被
//    直接執行」，結果**全域安裝的 mcpost 完全不會動**：npm 的 bin 是 symlink，
//    process.argv[1] 是 symlink 路徑、import.meta.url 是解析後的真實路徑，兩者永遠不相等
//    → 每一個指令都靜默什麼都不做，連錯誤訊息都沒有。
//
//    改用環境變數：CLI 是這支的主要身分，**預設一定執行**，只有測試明確關掉
//    （package.json 的 test script 帶 MCPOST_NO_MAIN=1）。路徑長什麼樣都不影響。
export { findLocalImages, rewriteImageUrls, IMG_MIME, MAX_IMAGE_BYTES }

if (!process.env.MCPOST_NO_MAIN) {

const [, , cmd, ...rest] = process.argv
switch (cmd) {
  case 'token': await cmdToken(rest); break
  // 這幾支跑完順手提醒版本落後（一天查一次，查不到就靜默略過）。
  // 以前只有 install-skill 會提醒，等於裝完就再也不會被告知有新版。
  case 'devlog': await cmdDevlog(rest); await nudgeIfOutdated(); break
  case 'post': await cmdPost(rest); await nudgeIfOutdated(); break
  case 'channels': await cmdChannels(rest); await nudgeIfOutdated(); break
  case 'install-skill': cmdInstallSkill(); await warnIfOutdated(); break
  case 'doctor': await cmdDoctor(); break
  case '--version': case '-v': console.log(localVersion() || '(讀不到版本)'); break
  case '--help': case '-h': case undefined: printHelp(); break
  default: die(`不認得的指令：${cmd}`, '跑 mcpost --help 看用法')
}

}
