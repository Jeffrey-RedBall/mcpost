#!/usr/bin/env node
/**
 * mcslide — 把一份 Slides Markdown 送上 MakeClass，變成站上可播的簡報草稿。
 *
 *   mcslide <檔.md> --title "…" [--source <pushId>] [--channel @handle] [--cover 封面.jpg] [--attach 檔案]… [--dry-run]
 *   mcslide <檔.md> --update <pushId>            改既有簡報（也可只 --cover／--attach／--narration）
 *   mcslide <檔.md> --narration ./音檔/           導讀（1.8.0）：一頁一檔 01.mp3…，串成一支、每頁起點自動算
 *   mcslide narration <pushId> ./音檔/           既有簡報補導讀（或換聲音）
 *   （正文裡的 ![](./img/a.png) 會自動上傳再換成網址；不要就加 --no-images）
 *   mcslide from <pushId> [--pages 20]           讓站上的 AI 讀那篇做一份（使用點數）
 *
 * 跟 slides-html 的差別：那支產**本機 HTML 檔**（自用、可放 SVG），這支送**站上**
 * （讀者看得到、可分享、有可見度）。站內渲染刻意不解析 HTML，所以這裡會擋下 <svg>／<figure>。
 * 跟 mcpost 同一包、同一支權杖（~/.makeclass/token）——裝一次兩個指令都有。
 */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { homedir } from "node:os"
import { findLocalImages, oversizedImages, uploadImages, rewriteImageUrls, ImageUploadError, MAX_IMAGE_BYTES, resolveCoverFile, setCover, resolveAttachFile, attachFiles } from "./images.mjs"
import { installApiFetch, nudgeIfOutdated } from "./update-check.mjs"
import { resolveNarrationDir, checkNarrationCount, buildNarration, attachNarration, DEFAULT_GAP_SEC } from "./narration.mjs"

const API = process.env.MAKECLASS_API || "https://asia-east1-makeclass-prod.cloudfunctions.net/api"


// 跟 mcpost 同一套（./update-check.mjs）：所有打 MakeClass 的請求帶上版本，並印出後端的升級提醒。
// ⚠️ 1.5.0 以前這裡只送版本、不印提醒，也不查新版——只用 mcslide 的人永遠不知道有新版。
installApiFetch(API, { tool: "mcslide" })

/** 成功結束：先順手提醒版本落後（一天查一次），再離開 */
async function done() { await nudgeIfOutdated(); process.exit(0) }

const die = (msg, hint) => { console.error(`✗ ${msg}${hint ? `\n  ${hint}` : ""}`); process.exit(1) }

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
/** 同一個旗標的每一個值（--attach a --attach b） */
const vals = (n) => argv.flatMap((a, i) => (a === n && argv[i + 1] && !argv[i + 1].startsWith("--") ? [argv[i + 1]] : []))
const file = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true)

function token() {
    const t = (process.env.MAKECLASS_TOKEN || "").trim()
        || (() => { try { return readFileSync(resolve(homedir(), ".makeclass/token"), "utf8").trim() } catch { return "" } })()
    if (!t) die("找不到 token", "設 MAKECLASS_TOKEN，或把 mck_… 存進 ~/.makeclass/token")
    return t
}

/** 解析 front matter 與頁面結構——只為了驗證與預覽，真正的渲染在站上 */
function inspect(md) {
    const fm = md.match(/^---\n([\s\S]*?)\n---\n?/)
    const meta = {}
    if (fm) for (const line of fm[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "") }
    const body = fm ? md.slice(fm[0].length) : md
    const pages = [...body.matchAll(/^(#{1,2})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, title: m[2].trim() }))
    const notes = (md.match(/<!--\s*notes:/g) || []).length
    return { meta, pages, notes, hasFrontMatter: !!fm }
}

function validate(md, info) {
    const bad = md.match(/<\s*(svg|figure|div|table|script|iframe|style)\b/i)
    if (bad) die(`站內不收 HTML（偵測到 <${bad[1]}>）`,
        "圖表請先存成 PNG，再用 ![說明](https://… \"caption\") 插入。這不是格式偏好——公開頁會渲染給其他讀者看。")
    if (!info.hasFrontMatter) die("缺少 front matter", "檔案開頭要有 --- title: … --- 區塊，封面才有東西")
    if (info.pages.length === 0) die("沒有任何頁", "一個 ## 一頁、# 是章名頁")
    if (md.length > 200000) die(`正文 ${md.length} 字元，超過 200,000 上限`)
}

async function resolveChannel(handle) {
    const h = handle.replace(/^@/, "")
    const r = await fetch(`${API}/v1/makeclass/channels/mine-for-token`, { headers: { Authorization: `Bearer ${token()}` } })
    const j = await r.json().catch(() => ({}))
    const ch = (j?.data || []).find((c) => c.handle === h)
    if (!ch) die(`你的頻道裡沒有 @${h}`, `可用：${(j?.data || []).map((c) => "@" + c.handle).join(" ") || "（查不到）"}`)
    return ch.id
}

// ── mcslide from <pushId>：交給站上的 AI 產（自己不寫 Markdown）──────────────────
// 權杖打得動 /to-slides（scope 需 pusher:write）。
if (argv[0] === "from") {
    const id = argv[1]
    if (!id || id.startsWith("--")) die("用法：mcslide from <pushId> [--pages 20]")
    const pages = parseInt(val("--pages") || "15", 10)
    console.log(`\n交給站上的 AI 產 ${pages} 頁（約一分鐘，會使用點數）…`)
    const r = await fetch(`${API}/v1/makeclass/pusher/${id}/to-slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ pages }),
    }).catch((e) => die(`連不上 API：${e.message}`))
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.success) {
        if (j.code === "INSUFFICIENT") die(j.error, "到 makeclass.me 的「點數」頁儲值後再試")
        die(`失敗（${r.status}）：${j.error || ""}`, r.status === 403 ? "權杖要勾「發表內容」（pusher:write）" : "")
    }
    const d = j.data || {}
    console.log(`✓ ${d.pageCount} 頁草稿，${d.notesCount} 頁有講者備註（素材：${d.sourceKind}）`)
    console.log(`  ${d.url}`)
    console.log(`  扣 ${d.cost} 點${d.balance != null ? `，餘額 ${d.balance}` : ""}　看過內容後到 makeclass.me/slides 按發布`)
    await done()
}

// ── mcslide narration <pushId> <資料夾>：既有簡報補導讀（或換聲音）────────────────
// 頁數從站上那篇的正文算（跟播放器一樣：封面 1 ＋ # 與 ## 各一頁），檔數不對就停，不上傳。
if (argv[0] === "narration") {
    const id = argv[1]; const dir = argv[2]
    if (!id || id.startsWith("--") || !dir || dir.startsWith("--")) die("用法：mcslide narration <pushId> <音檔資料夾> [--gap 0.6] [--dry-run]", "資料夾裡放 01.mp3、02.mp3 …（封面＝01，# 章名頁也算一頁）")
    const r = await fetch(`${API}/v1/makeclass/pusher/${id}`, { headers: { Authorization: `Bearer ${token()}` } }).catch((e) => die(`連不上 API：${e.message}`))
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.success) die(`讀不到這篇（${r.status}）：${j.error || ""}`)
    if (j.data?.contentType !== "slides") die(`這篇不是簡報（${j.data?.contentType}）`, "導讀只能掛在簡報上")
    const pageCount = inspect(j.data.articleBody || "").pages.length + 1
    const files = orDieN(() => resolveNarrationDir(dir, process.cwd()))
    orDieN(() => checkNarrationCount(files, pageCount))
    const built = orDieN(() => buildNarration(files, { gapSec: gapSec(), concat: !flag("--dry-run") }))
    printNarration(j.data.title, built)
    if (flag("--dry-run")) { console.log("（--dry-run，沒有送出）"); await done() }
    try { await attachNarration({ pushId: id, token: token(), apiBase: API, built }) }
    catch (e) { if (e instanceof ImageUploadError) die(e.message, e.hint); throw e }
    console.log(`✓ 導讀已掛上：https://makeclass.me/learn/${id}　（打開簡報，底部導讀列按播放）`)
    await done()
}

const src = file || argv.find((a) => a.endsWith(".md"))
if (!src) die("用法：mcslide <檔.md> --title \"…\" [--source <pushId>] [--channel @handle] [--cover 封面.jpg] [--attach 檔案]… [--narration 音檔資料夾] [--dry-run]\n  或：mcslide from <pushId> [--pages 20]\n  或：mcslide narration <pushId> <音檔資料夾>（既有簡報補導讀）\n  權杖：先跑 mcpost token 設定一次")
const md = readFileSync(resolve(src), "utf8")
const info = inspect(md)
validate(md, info)

const title = val("--title") || info.meta.title
if (!title) die("缺少標題", "用 --title，或在 front matter 寫 title:")
const updateId = val("--update")
const sourcePushId = val("--source")

// 正文裡的本地圖片：路徑相對於這份 .md，不是你站在哪個目錄
const localImages = flag("--no-images") ? [] : findLocalImages(md, dirname(resolve(src)))
// 封面與附件（1.7.0）：--cover／--attach 相對於你站的目錄；front matter 的 cover:／attach: 相對於這份 .md
function orDie(fn) { try { return fn() } catch (e) { if (e instanceof ImageUploadError) die(e.message, e.hint); throw e } }
const cover = val("--cover") ? orDie(() => resolveCoverFile(val("--cover"), process.cwd()))
    : info.meta.cover ? orDie(() => resolveCoverFile(info.meta.cover, dirname(resolve(src)))) : null
function orDieN(fn) { try { return fn() } catch (e) { if (e instanceof ImageUploadError) die(e.message, e.hint); throw e } }
function gapSec() { const g = val("--gap"); if (g == null) return DEFAULT_GAP_SEC; const n = Number(g); if (!Number.isFinite(n) || n < 0 || n > 5) die("--gap 要是 0 到 5 之間的秒數"); return n }
function printNarration(title, built) {
    console.log(`\n導讀：${title}`)
    console.log(`  ${built.perPage.length} 頁 · 共 ${(built.durationSec / 60).toFixed(1)} 分鐘${built.transcript ? ` · 字幕 ${built.transcript.length} 句` : " · 沒有字幕（旁邊放同名 .txt 就有）"}`)
    for (const [k, p] of built.perPage.slice(0, 6).entries()) console.log(`   ${String(k + 1).padStart(2, "0")}  ${built.starts[k].toFixed(1).padStart(7)}s  ${p.name}（${p.sec.toFixed(1)}s）`)
    if (built.perPage.length > 6) console.log(`   … 還有 ${built.perPage.length - 6} 頁，最後一頁從 ${built.starts.at(-1).toFixed(1)}s 開始`)
}
// 導讀（1.8.0）：--narration 相對於你站的目錄；front matter 的 narration: 相對於這份 .md。檔數要＝頁數，不對就連草稿都不建。
const narrDir = val("--narration") || info.meta.narration || null
const narrFiles = narrDir ? orDieN(() => resolveNarrationDir(narrDir, val("--narration") ? process.cwd() : dirname(resolve(src)))) : null
if (narrFiles) orDieN(() => checkNarrationCount(narrFiles, info.pages.length + 1))
const narrBuilt = narrFiles ? orDieN(() => buildNarration(narrFiles, { gapSec: gapSec(), concat: !flag("--dry-run"), log: () => {} })) : null
const attachArgs = vals("--attach")
const attachments = attachArgs.length ? attachArgs.map((a) => orDie(() => resolveAttachFile(a, process.cwd())))
    : info.meta.attach ? String(info.meta.attach).replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean).map((a) => orDie(() => resolveAttachFile(a, dirname(resolve(src))))) : []
async function coverAndAttachOrDie(pushId, recover) {
    try {
        if (cover) { console.log("設定封面："); await setCover({ pushId, token: token(), apiBase: API, cover }) }
        if (attachments.length) { console.log(`掛 ${attachments.length} 個附件：`); await attachFiles(attachments, { pushId, token: token(), apiBase: API }) }
        if (narrBuilt) { console.log("掛導讀："); await attachNarration({ pushId, token: token(), apiBase: API, built: narrBuilt }) }
    } catch (e) {
        if (e instanceof ImageUploadError) die(e.message, [e.hint, recover].filter(Boolean).join("\n  "))
        throw e
    }
}
const tooBig = oversizedImages(localImages)
if (tooBig.length) die(`圖片太大：${tooBig.map((i) => `${i.raw}（${(i.bytes / 1024 / 1024).toFixed(1)} MB）`).join("、")}`,
    `單張上限 ${MAX_IMAGE_BYTES / 1024 / 1024} MB，請先壓縮`)

/** 傳圖失敗一律 die：走到這裡草稿已經在了，把下一步講清楚 */
async function uploadOrDie(pushId, recover) {
    try {
        return await uploadImages(localImages, { pushId, token: token(), apiBase: API })
    } catch (e) {
        if (e instanceof ImageUploadError) die(e.message, [e.hint, recover].filter(Boolean).join("\n  "))
        throw e
    }
}

console.log(`\n${title}`)
console.log(`  ${info.pages.length + 1} 頁（含封面）· 講者備註 ${info.notes} 頁 · ${md.length} 字元`)
for (const [k, p] of info.pages.slice(0, 12).entries()) console.log(`   ${String(k + 2).padStart(2)}. ${p.level === 1 ? "▍章 " : "   "}${p.title}`)
if (info.pages.length > 12) console.log(`   … 還有 ${info.pages.length - 12} 頁`)
if (sourcePushId) console.log(`  來源：${sourcePushId}`)
if (localImages.length) console.log(`  圖片：${localImages.length} 張本地圖片，送出後自動上傳`)
if (cover) console.log(`  封面：${cover.raw}`)
if (attachments.length) console.log(`  附件：${attachments.map((a) => a.name).join("、")}`)
if (narrBuilt) console.log(`  導讀：${narrFiles.length} 個音檔，共 ${(narrBuilt.durationSec / 60).toFixed(1)} 分鐘${narrBuilt.transcript ? `，字幕 ${narrBuilt.transcript.length} 句` : "，沒有字幕"}`)
console.log()

if (flag("--dry-run")) { console.log("（--dry-run，沒有送出）"); await done() }

const channelId = val("--channel") ? await resolveChannel(val("--channel")) : null
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token()}` }

if (updateId) {
    // 已經有 pushId：圖先傳完、換好網址，一次 PATCH 定案
    let body = md
    if (localImages.length) {
        console.log(`找到 ${localImages.length} 張本地圖片，先上傳：`)
        body = rewriteImageUrls(md, await uploadOrDie(updateId, "簡報內容還沒動，修好後重跑同一個指令即可"))
    }
    const r = await fetch(`${API}/v1/makeclass/pusher/${updateId}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ title, articleBody: body, ...(channelId ? { channelId } : {}) }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.success) die(`更新失敗（${r.status}）：${j.error || ""}`)
    await coverAndAttachOrDie(updateId, `簡報內容已更新；修好後只重跑 --cover／--attach 那部分${narrBuilt ? `，導讀用：mcslide narration ${updateId} ${narrDir}` : ""}`)
    console.log(`✓ 已更新：https://makeclass.me/learn/${updateId}`)
    await done()
}

const r = await fetch(`${API}/v1/makeclass/pusher/create`, {
    method: "POST", headers,
    body: JSON.stringify({
        title, contentType: "slides", articleBody: md, visibility: "unlisted",
        ...(info.meta.subtitle ? { subtitle: info.meta.subtitle } : {}),
        ...(sourcePushId ? { sourcePushId } : {}),
        ...(channelId ? { channelId } : {}),
    }),
})
const j = await r.json().catch(() => ({}))
if (!r.ok || !j.success) die(`建立失敗（${r.status}）：${j.error || ""}`)

// 圖片要掛在某一篇底下，所以是「先建草稿拿 pushId → 傳圖 → 用網址更新正文」。
// 中間那一瞬間草稿裡的圖還是本機路徑（站上不顯示），但它是不公開的草稿，不影響讀者。
if (localImages.length) {
    const recover = `草稿已建立但圖片沒補上：https://makeclass.me/learn/${j.pushId}\n  修好後重跑：mcslide ${src} --update ${j.pushId}`
    console.log(`找到 ${localImages.length} 張本地圖片，開始上傳：`)
    const body = rewriteImageUrls(md, await uploadOrDie(j.pushId, recover))
    const r2 = await fetch(`${API}/v1/makeclass/pusher/${j.pushId}`, {
        method: "PATCH", headers, body: JSON.stringify({ articleBody: body }),
    }).catch((e) => die(`連不上 API：${e.message}`, recover))
    const j2 = await r2.json().catch(() => ({}))
    // 失敗不能默默略過：草稿會留著指向本機路徑的圖，播放時一張都不顯示
    if (!r2.ok || j2.success === false) die(`圖片已上傳，但正文更新失敗（HTTP ${r2.status}）：${j2.error || "（伺服器沒說原因）"}`, recover)
}
await coverAndAttachOrDie(j.pushId, `草稿已建立：https://makeclass.me/learn/${j.pushId}\n  修好後重跑：mcslide ${src} --update ${j.pushId} --cover … --attach …${narrBuilt ? `\n  導讀用：mcslide narration ${j.pushId} ${narrDir}` : ""}`)
console.log(`✓ 已建立草稿：https://makeclass.me/learn/${j.pushId}`)
console.log(`  管理：https://makeclass.me/slides　（看過內容，確認後按發布）`)
await done()
