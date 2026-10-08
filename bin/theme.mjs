/**
 * 簡報主題（1.9.0）：只做「預覽與檢查」，真正的渲染在站上播放器。
 *
 * ⚠️ 判斷規則必須跟 makeclass repo 的 apps/makeclass/src/components/slides/slideTheme.ts 一致——
 *    這裡預告「哪幾頁會變大字報」，站上卻沒變（或反過來），使用者會以為壞了。改一邊就同步另一邊。
 *
 *   theme 沒寫     → 青瓷墨字（預設）
 *   theme: 講堂    → 講堂（也收 lecture）
 *   其他值         → 站上會當成沒寫，這裡提醒一下（常見：「講堂風」「lecture-theme」打錯）
 */

const LECTURE = new Set(["講堂", "lecture"])

/** front matter 的 theme 值 → { theme: 'default'|'lecture', unknown?: 原值 } */
export function resolveTheme(raw) {
    const t = String(raw ?? "").trim()
    if (!t) return { theme: "default" }
    if (LECTURE.has(t.toLowerCase())) return { theme: "lecture" }
    return { theme: "default", unknown: t }
}

/** 標題拿掉 `{#key}` 與 `[小引言]`，跟站上 parser 的 splitHead 同一套 */
function cleanTitle(raw) {
    return String(raw).replace(/\s*\{#[^}\s]+\}\s*$/, "").replace(/^\[[^\]]+\]\s*/, "").trim()
}

/** 大字報：內容頁（##）標題 ≤ 6 字、沒有空白、沒有標點（「重點：一句話」是強調色標題，不是大字報） */
export function isBigWord(page) {
    if (page.level !== 2) return false
    const t = cleanTitle(page.title)
    return t.length > 0 && t.length <= 6 && !/[\s：:｜|，,、。？?！!]/.test(t)
}

/** 強調色：標題用「｜」或「：」切得出兩段 */
export function hasAccent(page) {
    const m = cleanTitle(page.title).match(/^(.+?)[｜:：](.+)$/)
    return !!(m && m[1].trim() && m[2].trim())
}

/** 給 --dry-run 印的摘要：哪幾頁會變大字報、哪幾頁標題有強調色（頁碼含封面，從 2 起算） */
export function lecturePreview(pages) {
    const big = [], accent = []
    pages.forEach((p, k) => {
        if (isBigWord(p)) big.push(k + 2)
        else if (hasAccent(p)) accent.push(k + 2)
    })
    return { big, accent }
}
