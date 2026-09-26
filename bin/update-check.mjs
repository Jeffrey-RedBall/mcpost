// ─────────────────────────────────────────────────────────────────────────
// 版本與升級提醒：mcpost 與 mcslide 共用
//
// 兩條提醒管道：
//   1. 伺服器提醒——每個打 MakeClass 的請求都帶 User-Agent（含版本），後端可以在回應裡
//      塞 clientNotice（「你這一版有已知問題」「有新版，理由是…」）。每次呼叫都即時。
//   2. 本機提醒——指令跑完後查一次 npm registry，一天最多查一次（快取）。
//
// 為什麼獨立成一支：1.5.0 以前這兩段只寫在 mcpost.mjs 裡，mcslide 送了版本卻不印提醒、
// 也不查新版——只用 mcslide 的人永遠不知道有新版。放一份共用，兩邊就不會一個有一個沒有。
//
// ⚠️ 提醒絕對不能影響主流程：查不到、逾時、寫不了快取一律靜默略過。
//    使用者是來發文、做簡報的，不是來等版本檢查的。
// ⚠️ 只提醒、不自動升級：自動升級會在使用者不知情下改掉他電腦上的程式。
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

export function localVersion() {
  try { return JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version } catch { return null }
}

/**
 * 所有 API 呼叫都帶這個 UA，後端才知道對面是哪一版。
 * 格式不能改：後端用 /\bmcpost\/(\d+)\.(\d+)\.(\d+)/ 認版本（functions/utils/clientVersion.js）。
 */
export function userAgent(tool = 'mcpost') {
  const v = localVersion() || '0.0.0'
  return tool === 'mcpost'
    ? `mcpost/${v} (node ${process.versions.node})`
    : `mcpost/${v} (${tool}; node ${process.versions.node})`
}

/**
 * 包一層 globalThis.fetch：打 apiBase 的請求自動帶版本，並印出後端給的 clientNotice。
 * 在這一層做而不是逐個 fetch 補：逐處補一定會漏，之後新增的也會忘記。
 * 只對 apiBase 開頭的請求動手，不碰打 registry 那支。
 */
export function installApiFetch(apiBase, { tool = 'mcpost', log = (s) => console.log(s) } = {}) {
  const _fetch = globalThis.fetch
  const shown = new Set()
  globalThis.fetch = async (url, init = {}) => {
    if (typeof url !== 'string' || !url.startsWith(apiBase)) return _fetch(url, init)
    init = { ...init, headers: { ...(init.headers || {}), 'User-Agent': userAgent(tool) } }
    const res = await _fetch(url, init)
    // 用 clone() 讀一份，呼叫端的 body 不受影響；同一則訊息只印一次。
    try {
      if ((res.headers.get('content-type') || '').includes('application/json')) {
        const j = await res.clone().json()
        const n = j && typeof j.clientNotice === 'string' ? j.clientNotice.trim() : ''
        if (n && !shown.has(n)) { shown.add(n); log(`\n⚠️  ${n}`) }
      }
    } catch { /* 讀不到就算了，不影響主流程 */ }
    return res
  }
}

/** 1.2.0 vs 1.10.0 不能用字串比 —— 逐段比數字 */
export function isOlder(a, b) {
  if (!a || !b) return false
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return true
    if ((pa[i] || 0) > (pb[i] || 0)) return false
  }
  return false
}

export async function latestVersion() {
  try {
    // ⚠️ 不要帶 `accept: application/vnd.npm.install-v1+json` —— 那個精簡格式
    //    只支援完整 package document，打 /latest 會回 406，而 406 被當成
    //    「離線」靜默略過，檢查就永遠是綠的（2026-09-22 實測抓到）。
    const res = await fetch('https://registry.npmjs.org/mcpost/latest', {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    return (await res.json()).version || null
  } catch { return null }
}

// ── 版本檢查的快取：一天查一次就夠，不要每個指令都打 registry ──
const VERSION_CACHE_MS = 24 * 60 * 60 * 1000
const versionCache = () => join(homedir(), '.makeclass', 'version-check.json')

function cachedLatest() {
  try {
    const c = JSON.parse(readFileSync(versionCache(), 'utf8'))
    if (Date.now() - c.at < VERSION_CACHE_MS) return c.latest
  } catch { /* 沒快取或壞掉就當作沒有 */ }
  return undefined
}
function putCachedLatest(latest) {
  try {
    mkdirSync(dirname(versionCache()), { recursive: true })
    writeFileSync(versionCache(), JSON.stringify({ at: Date.now(), latest }))
  } catch { /* 寫不進去不影響功能 */ }
}

/** 指令跑完後順手提醒版本落後。MCPOST_NO_UPDATE_CHECK=1 可關（測試、CI 用）。 */
export async function nudgeIfOutdated() {
  if (process.env.MCPOST_NO_UPDATE_CHECK) return
  try {
    const mine = localVersion()
    if (!mine) return
    let latest = cachedLatest()
    if (latest === undefined) { latest = await latestVersion(); putCachedLatest(latest) }
    if (!latest || !isOlder(mine, latest)) return
    console.log(`\n⚠️  有新版 ${latest}（你的是 ${mine}）：在終端機打 npm install -g mcpost，再打 mcpost doctor 確認`)
  } catch { /* 提醒失敗不是錯誤 */ }
}
