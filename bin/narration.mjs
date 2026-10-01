// 導讀（1.8.0）：一頁一個音檔 → 串成一支 → 每頁起點 → 掛到簡報（POST /pusher/:id/narration）。
//
// 資料夾規則：01.mp3、02.mp3 … 照**播放器頁序**（封面＝01，# 章名頁也算一頁），檔數＝頁數。
// 旁邊若有同名 .txt（01.txt）或 ../講稿/01.txt，就當字幕（逐句、按字數比例分時間）。
// 串接用 ffmpeg（系統要裝）；起點＝前面各檔長度累加＋頁間空白，零誤差，站上不用再跑 AI 對齊。
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, resolve as resolvePath, isAbsolute, basename, dirname, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { ImageUploadError, attachFiles } from './images.mjs'

export const NARRATION_EXTS = ['.mp3', '.m4a', '.wav', '.aac']
export const DEFAULT_GAP_SEC = 0.6

/** ffmpeg／ffprobe 在不在；不在就丟 ImageUploadError（訊息給人看，含安裝法） */
export function requireFfmpeg() {
  for (const bin of ['ffmpeg', 'ffprobe']) {
    const r = spawnSync(bin, ['-version'], { stdio: 'ignore' })
    if (r.error || r.status !== 0) {
      throw new ImageUploadError(`需要 ${bin} 來串接音檔，但系統裡找不到`, 'macOS：brew install ffmpeg　Ubuntu：sudo apt install ffmpeg　Windows：winget install ffmpeg')
    }
  }
}

/** 讀資料夾：回傳 [{ n, abs, name, size, text? }]，依頁序 1..N；缺號、跳號、空資料夾都擋 */
export function resolveNarrationDir(raw, baseDir) {
  const r = String(raw || '').trim()
  if (!r) throw new ImageUploadError('--narration 後面要接資料夾路徑')
  const abs = isAbsolute(r) ? r : resolvePath(baseDir, r)
  let st
  try { st = statSync(abs) } catch { throw new ImageUploadError(`找不到導讀資料夾：${r}`, `找的位置：${abs}`) }
  if (!st.isDirectory()) throw new ImageUploadError(`導讀要給資料夾，不是檔案：${r}`, '資料夾裡放 01.mp3、02.mp3 …，一頁一檔，照播放器頁序（封面＝01）')
  const files = readdirSync(abs)
    .map((name) => { const m = name.match(/^(\d{1,3})\.([a-z0-9]+)$/i); return m && NARRATION_EXTS.includes('.' + m[2].toLowerCase()) ? { n: parseInt(m[1], 10), name } : null })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n)
  if (!files.length) throw new ImageUploadError(`資料夾裡沒有音檔：${r}`, `檔名要是 01.mp3、02.mp3 …（收 ${NARRATION_EXTS.join(' ')}）`)
  const missing = []
  for (let i = 1; i <= files[files.length - 1].n; i++) if (!files.some((f) => f.n === i)) missing.push(i)
  if (files[0].n !== 1 || missing.length) throw new ImageUploadError(`音檔編號要從 01 連號到最後一頁，${files[0].n !== 1 ? '沒有 01' : `缺 ${missing.map((n) => String(n).padStart(2, '0')).join('、')}`}`)
  const dup = files.filter((f, i) => i > 0 && f.n === files[i - 1].n)
  if (dup.length) throw new ImageUploadError(`同一頁有兩個音檔：${dup.map((f) => f.name).join('、')}`, '一頁只能一檔，刪掉多的那個')
  return files.map((f) => {
    const p = join(abs, f.name)
    const size = statSync(p).size
    if (!size) throw new ImageUploadError(`音檔是空檔：${f.name}`)
    // 字幕：同名 .txt，或 ../講稿/NN.txt
    const nn = String(f.n).padStart(2, '0')
    const cands = [join(abs, `${nn}.txt`), join(abs, f.name.replace(extname(f.name), '.txt')), join(dirname(abs), '講稿', `${nn}.txt`), join(abs, '講稿', `${nn}.txt`)]
    const t = cands.find((c) => existsSync(c))
    return { n: f.n, abs: p, name: f.name, size, text: t ? readFileSync(t, 'utf8').trim() : '' }
  })
}

/** 檔數要＝頁數（含封面）；不對就擋，連草稿都不要建 */
export function checkNarrationCount(files, pageCount) {
  if (files.length !== pageCount) {
    throw new ImageUploadError(`導讀音檔 ${files.length} 個，簡報 ${pageCount} 頁（含封面與章名頁），要一頁一檔`,
      files.length < pageCount ? `少 ${pageCount - files.length} 個：封面是 01、每個 # 章名頁也算一頁` : `多 ${files.length - pageCount} 個：確認沒有多餘的編號檔`)
  }
}

function probeSec(abs) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', abs], { encoding: 'utf8' })
  const d = Number(String(r.stdout || '').trim())
  if (r.status !== 0 || !Number.isFinite(d) || d <= 0) throw new ImageUploadError(`讀不到音檔長度：${basename(abs)}`, String(r.stderr || '').trim().slice(0, 200))
  return d
}

/** 字幕逐句切，按字數比例分到 [t0, t0+dur) */
function sentences(text, t0, dur) {
  const parts = String(text || '').split(/(?<=[。！？!?…])\s*|\n+/).map((x) => x.trim()).filter(Boolean)
  const total = parts.reduce((a, x) => a + x.length, 0) || 1
  let st = t0
  return parts.map((x) => { const d = dur * x.length / total; const seg = { t: +st.toFixed(2), end: +(st + d).toFixed(2), text: x }; st += d; return seg })
}

/** 量長度、串成一支 mp3（64k mono）。回 { mp3, starts, durationSec, transcript, perPage } */
export function buildNarration(files, { gapSec = DEFAULT_GAP_SEC, log = (s) => process.stdout.write(s), concat = true } = {}) {
  requireFfmpeg()
  const perPage = files.map((f) => ({ ...f, sec: probeSec(f.abs) }))
  let t = 0
  const starts = []
  const transcript = []
  for (const p of perPage) {
    starts.push(+t.toFixed(2))
    if (p.text) transcript.push(...sentences(p.text, t, p.sec))
    t += p.sec + gapSec
  }
  const durationSec = +(t - gapSec).toFixed(2)
  if (!concat) return { mp3: null, starts, durationSec, transcript: transcript.length ? transcript : null, perPage }
  const work = mkdtempSync(join(tmpdir(), 'mcslide-narr-'))
  const gap = join(work, 'gap.wav')
  let r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(gapSec), gap])
  if (r.status !== 0) throw new ImageUploadError('ffmpeg 產不出頁間空白', String(r.stderr || '').slice(0, 200))
  const list = join(work, 'list.txt')
  const esc = (p) => p.replace(/'/g, "'\\''")
  writeFileSync(list, perPage.flatMap((p) => [`file '${esc(p.abs)}'`, `file '${esc(gap)}'`]).join('\n'))
  const mp3 = join(work, 'narration.mp3')
  log(`  串接 ${files.length} 個音檔（頁間 ${gapSec} 秒）… `)
  r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '22050', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', mp3], { encoding: 'utf8' })
  if (r.status !== 0) { log('✗\n'); throw new ImageUploadError('ffmpeg 串接失敗', String(r.stderr || '').slice(0, 300)) }
  log(`OK，${(durationSec / 60).toFixed(1)} 分鐘\n`)
  return { mp3, starts, durationSec, transcript: transcript.length ? transcript : null, perPage }
}

/** 上傳串好的音檔、掛到簡報。回 { pushId, pageCount, durationSec } */
export async function attachNarration({ pushId, token, apiBase, built, log = (s) => process.stdout.write(s) }) {
  const name = 'narration.mp3'
  const [asset] = await attachFiles([{ raw: built.mp3, abs: built.mp3, name, size: statSync(built.mp3).size, mime: 'audio/mpeg' }], { pushId, token, apiBase, log })
  // attachFiles 回的是 fileUrl；導讀端點要 assetId → 用 GET 找這支（同名、AUDIO、最新）
  const r0 = await fetch(`${apiBase}/v1/makeclass/pusher/${encodeURIComponent(pushId)}`, { headers: { Authorization: `Bearer ${token}` } })
  const j0 = await r0.json().catch(() => ({}))
  const audio = (j0?.data?.assets || []).filter((a) => a.type === 'AUDIO' && a.fileUrl === asset.fileUrl).pop()
  if (!audio) throw new ImageUploadError('音檔傳上去了，但在附件清單裡找不到它', '重跑一次同一個指令即可（已傳的檔會再傳一次）')
  log('  寫入每頁起點… ')
  const r = await fetch(`${apiBase}/v1/makeclass/pusher/${encodeURIComponent(pushId)}/narration`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioAssetId: audio.id, timings: built.starts.map((startSec) => ({ startSec })), transcript: built.transcript, durationSec: built.durationSec }),
  }).catch((e) => { throw new ImageUploadError(`連不上 API：${e.message}`) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.success) {
    log('✗\n')
    throw new ImageUploadError(`掛導讀失敗（HTTP ${r.status}）：${j.error || '（伺服器沒說原因）'}`,
      r.status === 404 ? '伺服器還沒更新到支援導讀（需要 2026-10-01 之後的版本）' : undefined)
  }
  log('OK\n')
  return j
}
