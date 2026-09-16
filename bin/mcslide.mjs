#!/usr/bin/env node
/**
 * mcslide — 把一份 Slides Markdown 送上 MakeClass，變成站上可播的簡報草稿。
 *
 *   mcslide <檔.md> --title "…" [--source <pushId>] [--channel @handle] [--dry-run]
 *   mcslide <檔.md> --update <pushId>            改既有簡報
 *   mcslide from <pushId> [--pages 20]           讓站上的 AI 讀那篇做一份（使用點數）
 *
 * 跟 slides-html 的差別：那支產**本機 HTML 檔**（自用、可放 SVG），這支送**站上**
 * （讀者看得到、可分享、有可見度）。站內渲染刻意不解析 HTML，所以這裡會擋下 <svg>／<figure>。
 * 跟 mcpost 同一包、同一支權杖（~/.makeclass/token）——裝一次兩個指令都有。
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"

const API = process.env.MAKECLASS_API || "https://asia-east1-makeclass-prod.cloudfunctions.net/api"
const die = (msg, hint) => { console.error(`✗ ${msg}${hint ? `\n  ${hint}` : ""}`); process.exit(1) }

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
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
    process.exit(0)
}

const src = file || argv.find((a) => a.endsWith(".md"))
if (!src) die("用法：mcslide <檔.md> --title \"…\" [--source <pushId>] [--channel @handle] [--dry-run]\n  或：mcslide from <pushId> [--pages 20]\n  權杖：先跑 mcpost token 設定一次")
const md = readFileSync(resolve(src), "utf8")
const info = inspect(md)
validate(md, info)

const title = val("--title") || info.meta.title
if (!title) die("缺少標題", "用 --title，或在 front matter 寫 title:")
const updateId = val("--update")
const sourcePushId = val("--source")

console.log(`\n${title}`)
console.log(`  ${info.pages.length + 1} 頁（含封面）· 講者備註 ${info.notes} 頁 · ${md.length} 字元`)
for (const [k, p] of info.pages.slice(0, 12).entries()) console.log(`   ${String(k + 2).padStart(2)}. ${p.level === 1 ? "▍章 " : "   "}${p.title}`)
if (info.pages.length > 12) console.log(`   … 還有 ${info.pages.length - 12} 頁`)
if (sourcePushId) console.log(`  來源：${sourcePushId}`)
console.log()

if (flag("--dry-run")) { console.log("（--dry-run，沒有送出）"); process.exit(0) }

const channelId = val("--channel") ? await resolveChannel(val("--channel")) : null
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token()}` }

if (updateId) {
    const r = await fetch(`${API}/v1/makeclass/pusher/${updateId}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ title, articleBody: md, ...(channelId ? { channelId } : {}) }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.success) die(`更新失敗（${r.status}）：${j.error || ""}`)
    console.log(`✓ 已更新：https://makeclass.me/learn/${updateId}`)
    process.exit(0)
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
console.log(`✓ 已建立草稿：https://makeclass.me/learn/${j.pushId}`)
console.log(`  管理：https://makeclass.me/slides　（看過內容，確認後按發布）`)
