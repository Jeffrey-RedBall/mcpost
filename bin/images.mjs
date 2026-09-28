// ─────────────────────────────────────────────────────────────────────────
// 圖片：把正文裡的本地圖片上傳到 MakeClass，再把路徑換成 https 網址
//
// 為什麼要做這個：站上正文**只顯示 https 的圖片**（http 與 data: 一律不渲染，
// 那是混合內容與夾帶 HTML 的防線）。所以本機寫好的圖文並茂文章，光靠正文
// 送上去圖一張都不會出現——以前只能自己先把圖搬到某個空間拿網址。
//
// 為什麼獨立成一支：mcpost post／mcpost devlog／mcslide 三條路都要用。
// 1.4.x 只有 post 有，devlog 與 mcslide 送出的圖全是本機路徑、站上一張都不顯示。
// 這支**沒有任何副作用**（不讀 argv、不 patch fetch、不 exit），誰 import 都安全。
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs'
import { resolve as resolvePath, isAbsolute, basename, extname } from 'node:path'

export const IMG_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
}
/** CF Gen 1 的 HTTP body 上限是 10 MB，超過會被閘道擋掉而且錯誤訊息很難懂 */
export const MAX_IMAGE_BYTES = 9 * 1024 * 1024

/** 找出正文裡「指向本機檔案」的圖片。已經是網址的、找不到檔案的都跳過。 */
export function findLocalImages(markdown, baseDir) {
  const out = []
  const seen = new Set()
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m
  while ((m = re.exec(markdown))) {
    const raw = m[1]
    if (/^(https?:|data:|\/\/)/i.test(raw) || seen.has(raw)) continue
    seen.add(raw)
    const abs = isAbsolute(raw) ? raw : resolvePath(baseDir, raw)
    if (!existsSync(abs)) continue
    const ext = extname(abs).toLowerCase()
    if (!IMG_MIME[ext]) continue
    out.push({ raw, abs, ext })
  }
  return out
}

/** 送出前就擋太大的圖——不要等草稿建好、傳到一半才失敗 */
export function oversizedImages(images) {
  return images
    .map((img) => ({ ...img, bytes: readFileSync(img.abs).length }))
    .filter((img) => img.bytes > MAX_IMAGE_BYTES)
}

/** 上傳失敗的錯誤：message 給人看，hint 是下一步 */
export class ImageUploadError extends Error {
  constructor(message, hint) { super(message); this.hint = hint }
}

/**
 * 逐張上傳到 /pusher/:id/upload-asset，回傳 { 原路徑 → https 網址 }。
 * 失敗就丟 ImageUploadError——由呼叫端決定怎麼收尾（通常是 die，因為草稿已經建了）。
 */
export async function uploadImages(images, { pushId, token, apiBase, log = (s) => process.stdout.write(s) }) {
  const map = new Map()
  for (const [i, img] of images.entries()) {
    const buf = readFileSync(img.abs)
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new ImageUploadError(`圖片太大：${img.raw}（${(buf.length / 1024 / 1024).toFixed(1)} MB）`,
        `單張上限 ${MAX_IMAGE_BYTES / 1024 / 1024} MB，請先壓縮`)
    }
    const fd = new FormData()
    // ⚠️ 不要自己設 Content-Type，讓 fetch 帶 multipart 的 boundary
    fd.append('file', new Blob([buf], { type: IMG_MIME[img.ext] }), basename(img.abs))
    log(`  上傳圖片 ${i + 1}/${images.length}：${img.raw} … `)
    let r
    try {
      r = await fetch(`${apiBase}/v1/makeclass/pusher/${encodeURIComponent(pushId)}/upload-asset`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      })
    } catch (e) {
      log('✗\n')
      throw new ImageUploadError(`連不上 API：${e.message}`)
    }
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.success || !j.fileUrl) {
      log('✗\n')
      throw new ImageUploadError(`圖片上傳失敗（HTTP ${r.status}）：${j.error || '（伺服器沒說原因）'}`,
        r.status === 403 ? '權杖要有「發表內容」(pusher:write)，而且只有作者本人能傳'
          : r.status === 413 ? '檔案太大，請先壓縮' : undefined)
    }
    log('OK\n')
    map.set(img.raw, j.fileUrl)
  }
  return map
}

/** 把正文裡的本地路徑換成上傳後的網址 */
export function rewriteImageUrls(markdown, map) {
  let out = markdown
  for (const [from, to] of map) {
    // 只換「在 ![]( ) 裡面」的那一份，避免把內文提到的同名字串也換掉。
    // 兩種收尾都要認：`](a.png)` 與帶說明的 `](a.png "說明")`——
    // 1.4.2 以前只認前者，有寫說明的圖一張都沒換到，送上去全是本機路徑。
    out = out.replaceAll(`](${from})`, `](${to})`).replaceAll(`](${from} "`, `](${to} "`)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// 封面（--cover，1.6.0）：上傳一張本機圖，設成這篇的封面
//
// 為什麼要有：沒有封面的草稿，作者在網頁打開審閱頁時會自動請 AI 畫一張，
// AI 會畫錯（2026-09-28 品牌標誌那篇，標誌被畫成別的樣子）。
// 審閱頁的條件是「還沒有封面才畫」——所以只要發文當下就把封面設好，就不會被蓋掉。
// 只收本機檔：外部網址會斷、也可能被拿去盜連，一律傳到 MakeClass 上。
// ─────────────────────────────────────────────────────────────────────────
export const COVER_EXTS = ['.jpg', '.jpeg', '.png', '.webp']

/** 檢查封面檔：存在、格式對、不超過大小。回傳 { raw, abs, ext }；不合格丟 ImageUploadError（送出前就擋） */
export function resolveCoverFile(raw, baseDir) {
  const r = String(raw || '').trim()
  if (/^(https?:|data:|\/\/)/i.test(r)) {
    throw new ImageUploadError(`封面只收本機圖片檔：${r}`, '把圖下載到電腦，再給檔案路徑（.jpg／.png／.webp）')
  }
  const abs = isAbsolute(r) ? r : resolvePath(baseDir, r)
  if (!existsSync(abs)) throw new ImageUploadError(`找不到封面圖：${r}`, `找的位置：${abs}`)
  const ext = extname(abs).toLowerCase()
  if (!COVER_EXTS.includes(ext)) {
    throw new ImageUploadError(`封面格式不支援：${ext || '（沒有副檔名）'}`, '請用 .jpg、.png 或 .webp；建議 1200×630（分享到 LINE、FB 的比例）')
  }
  const bytes = readFileSync(abs).length
  if (bytes > MAX_IMAGE_BYTES) {
    throw new ImageUploadError(`封面太大：${(bytes / 1024 / 1024).toFixed(1)} MB`, `上限 ${MAX_IMAGE_BYTES / 1024 / 1024} MB，請先壓縮`)
  }
  return { raw: r, abs, ext }
}

/** 上傳封面並設成這篇的 coverUrl。回傳封面網址；失敗丟 ImageUploadError */
export async function setCover({ pushId, token, apiBase, cover, log = (s) => process.stdout.write(s) }) {
  const map = await uploadImages([cover], { pushId, token, apiBase, log })
  const url = map.get(cover.raw)
  let r
  try {
    r = await fetch(`${apiBase}/v1/makeclass/pusher/${encodeURIComponent(pushId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ coverUrl: url }),
    })
  } catch (e) {
    throw new ImageUploadError(`連不上 API：${e.message}`)
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) {
    throw new ImageUploadError(`封面圖已上傳，但設定封面失敗（HTTP ${r.status}）：${j.error || '（伺服器沒說原因）'}`,
      r.status === 403 ? '權杖要有「發表內容」(pusher:write)，而且只有作者本人能改' : undefined)
  }
  return url
}
