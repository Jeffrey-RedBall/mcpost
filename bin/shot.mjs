// mcpost shot：把一頁 HTML 截成 PNG（封面 1200×630、插圖 1200×675）。
// 只是把 headless Chrome 那行長指令包起來，找不到 Chrome 就把原指令印給人看。
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'

export const SIZES = { cover: [1200, 630], figure: [1200, 675] }

export function parseSize(s) {
  if (!s) return SIZES.cover
  if (SIZES[s]) return SIZES[s]
  const m = String(s).match(/^(\d{2,5})[x×](\d{2,5})$/i)
  if (!m) throw new Error(`看不懂 --size：${s}（用 cover、figure 或 1200x630）`)
  return [Number(m[1]), Number(m[2])]
}

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
}

/** 找 Chrome：環境變數 MCPOST_CHROME 優先，再看平台慣用路徑；都沒有回 null */
export function findChrome({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  if (env.MCPOST_CHROME && exists(env.MCPOST_CHROME)) return env.MCPOST_CHROME
  for (const p of CANDIDATES[platform] || []) if (exists(p)) return p
  return null
}

export function chromeArgs({ html, out, size }) {
  const [w, h] = size
  return [
    '--headless=new', '--hide-scrollbars', '--disable-gpu',
    `--window-size=${w},${h}`, '--virtual-time-budget=8000',
    `--screenshot=${out}`, pathToFileURL(resolvePath(html)).href,
  ]
}

export async function runShot({ html, out, size, chrome = findChrome() }) {
  if (!existsSync(html)) throw new Error(`找不到 HTML：${html}`)
  const args = chromeArgs({ html, out, size })
  if (!chrome) {
    const err = new Error('找不到 Chrome／Chromium')
    err.hint = `裝 Google Chrome，或 export MCPOST_CHROME=<chrome 執行檔路徑>。手動指令：\n  "<chrome>" ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`
    throw err
  }
  await new Promise((ok, bad) => execFile(chrome, args, { timeout: 30000 }, (e) => (e ? bad(e) : ok())))
  if (!existsSync(out)) throw new Error(`Chrome 跑完了但沒有產生 ${out}`)
  return out
}
