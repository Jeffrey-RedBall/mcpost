// 旗標白名單：不認得的 --xxx 直接中止，不再靜默忽略。
//
// 為什麼：1.10.1 以前 parseArgsLoose 對不認得的旗標是「收下來沒人用」。說明書（SKILL／AGENTS／網頁）
// 跟著最新版寫，裝舊版的人照著打 --attach、--cover、--shot，附件和封面就無聲消失，指令照樣回成功。
// 這違反「失敗必須講話」。白名單放這裡一份，mcpost 與 mcslide 共用。
export const KNOWN = {
  // mcpost <cmd>
  token: [],
  devlog: ['dry-run', 'yes', 'no-mask-clients', 'no-verify', 'no-images', 'cover', 'attach', 'token'],
  post: ['title', 'subtitle', 'source', 'take', 'body', 'channel', 'post', 'update', 'cover', 'attach',
    'no-images', 'no-verify', 'no-mask-clients', 'token', 'from'],
  channels: ['token'],
  'install-skill': [],
  doctor: [],
  call: null,            // JSON 參數裡可能有任何東西，不檢查
  shot: ['out', 'size'],
  upgrade: ['dry-run', 'force'],
  // mcslide（整支一份）
  mcslide: ['title', 'source', 'channel', 'cover', 'attach', 'narration', 'gap', 'pages', 'focus', 'update', 'dry-run', 'no-images', 'token'],
}

const ALWAYS = new Set(['help', 'h', 'version', 'v'])

/** argv 裡不在白名單的 --旗標（去掉 =值）。known 為 null → 不檢查 */
export function unknownFlags(argv, known) {
  if (!known) return []
  const ok = new Set(known)
  const out = []
  for (const a of argv) {
    if (a === '--') break
    if (!a.startsWith('--')) continue
    const name = a.slice(2).split('=')[0]
    if (!name || ok.has(name) || ALWAYS.has(name)) continue
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** 組錯誤訊息；回 null 表示都認得 */
export function unknownFlagMessage(argv, cmd, { version = '?', tool = 'mcpost' } = {}) {
  const bad = unknownFlags(argv, KNOWN[cmd])
  if (!bad.length) return null
  const list = bad.map((b) => `--${b}`).join('、')
  return {
    msg: `不認得的選項：${list}（${tool} ${version} 沒有這個功能）`,
    hint: `你照的說明可能比裝的版本新。先升級：mcpost upgrade（或 npm install -g mcpost@latest），再跑一次；打錯字的話看 ${tool} --help`,
  }
}
