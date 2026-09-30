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
import { readFileSync, existsSync, statSync } from 'node:fs'
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

// ─────────────────────────────────────────────────────────────────────────
// 附件（--attach，1.7.0）：任何檔案（影片、PPT、PDF、ZIP…）掛成文章／簡報的附件，出現在站上的附件區
//
// 走「直傳」三步（後端 #374，2026-10-01）：
//   1. POST /pusher/:id/upload-url → 拿到一個只對這個路徑有效的上傳網址（GCS 可續傳 session）
//   2. 把檔案 PUT 到那個網址——直接進 Storage，不經 Cloud Functions 的 10 MB 限制
//   3. POST /pusher/:id/register-asset → 登記成附件（後端會先確認檔案真的在）
// 以前只能用 upload-asset（≤ 9 MB）而且登記那一步只認網頁登入，檔案傳上去也不會出現在附件區。
// ─────────────────────────────────────────────────────────────────────────
export const MAX_ATTACH_BYTES = 500 * 1024 * 1024
const ATTACH_MIME = {
  ...IMG_MIME,
  '.pdf': 'application/pdf',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.key': 'application/vnd.apple.keynote',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.html': 'text/html', '.csv': 'text/csv',
}

/** 檢查附件檔：存在、是檔案、不超過上限。回傳 { raw, abs, name, size, mime }；不合格丟 ImageUploadError */
export function resolveAttachFile(raw, baseDir) {
  const r = String(raw || '').trim()
  if (!r) throw new ImageUploadError('--attach 後面要接檔案路徑')
  if (/^(https?:|data:|\/\/)/i.test(r)) throw new ImageUploadError(`附件只收本機檔案：${r}`, '先下載到電腦再給路徑')
  const abs = isAbsolute(r) ? r : resolvePath(baseDir, r)
  let st
  try { st = statSync(abs) } catch { throw new ImageUploadError(`找不到附件：${r}`, `找的位置：${abs}`) }
  if (!st.isFile()) throw new ImageUploadError(`附件不是檔案：${r}`)
  if (st.size === 0) throw new ImageUploadError(`附件是空檔：${r}`)
  if (st.size > MAX_ATTACH_BYTES) {
    throw new ImageUploadError(`附件太大：${r}（${(st.size / 1024 / 1024).toFixed(1)} MB）`, `單檔上限 ${MAX_ATTACH_BYTES / 1024 / 1024} MB`)
  }
  const ext = extname(abs).toLowerCase()
  return { raw: r, abs, name: basename(abs), size: st.size, mime: ATTACH_MIME[ext] || 'application/octet-stream' }
}

/** 逐個上傳並登記。回傳 [{ name, fileUrl, type }]；失敗丟 ImageUploadError（已完成的不會重傳，由呼叫端決定怎麼收尾） */
export async function attachFiles(files, { pushId, token, apiBase, log = (s) => process.stdout.write(s) }) {
  const out = []
  const auth = { Authorization: `Bearer ${token}` }
  const jsonHeaders = { ...auth, 'Content-Type': 'application/json' }
  for (const [i, f] of files.entries()) {
    log(`  附件 ${i + 1}/${files.length}：${f.name}（${(f.size / 1024 / 1024).toFixed(1)} MB）… `)
    // 1. 要上傳網址
    let r = await fetch(`${apiBase}/v1/makeclass/pusher/${encodeURIComponent(pushId)}/upload-url`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ fileName: f.name, mimeType: f.mime, fileSize: f.size }),
    }).catch((e) => { throw new ImageUploadError(`連不上 API：${e.message}`) })
    let j = await r.json().catch(() => ({}))
    if (!r.ok || !j.success || !j.uploadUrl) {
      log('✗\n')
      throw new ImageUploadError(`要上傳網址失敗（HTTP ${r.status}）：${j.error || '（伺服器沒說原因）'}`,
        r.status === 404 ? '伺服器還沒更新到支援直傳（需要 2026-10-01 之後的版本）'
          : r.status === 403 ? '權杖要有「發表內容」(pusher:write)，而且只有作者本人能傳' : undefined)
    }
    // 2. 直傳（單次 PUT 整個檔；session 網址只對這一個路徑有效）
    const put = await fetch(j.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': j.contentType || f.mime, 'Content-Length': String(f.size) },
      body: readFileSync(f.abs),
    }).catch((e) => { throw new ImageUploadError(`上傳失敗：${e.message}`) })
    if (!put.ok) { log('✗\n'); throw new ImageUploadError(`上傳失敗（HTTP ${put.status}）：${f.name}`) }
    // 3. 登記成附件
    r = await fetch(`${apiBase}/v1/makeclass/pusher/${encodeURIComponent(pushId)}/register-asset`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ type: j.type, fileUrl: j.fileUrl, fileName: f.name, mimeType: f.mime, fileSize: f.size }),
    }).catch((e) => { throw new ImageUploadError(`連不上 API：${e.message}`) })
    j = await r.json().catch(() => ({}))
    if (!r.ok || !j.success) {
      log('✗\n')
      throw new ImageUploadError(`檔案已上傳，但登記附件失敗（HTTP ${r.status}）：${j.error || '（伺服器沒說原因）'}`)
    }
    log('OK\n')
    out.push({ name: f.name, fileUrl: j.asset?.fileUrl, type: j.asset?.type })
  }
  return out
}
