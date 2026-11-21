// 送出前的兩道閘門：掃機密（掃到就中止）、遮客戶名。
// devlog 從 1.0 就有；post 到 1.10.0 都沒接——標題、副標、正文、--take 全部直接送出去。
// 1.10.1 起兩條路共用這一份，之後要加 pattern 只改這裡。
export const SECRET_PATTERNS = [
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

export const CLIENT_MASKS = [
  [/CMC01|中華汽車/g, '<客戶A>'],
  [/裕隆/g, '<客戶B>'],
  [/TD-?VIP/gi, '<客戶C>'],
  [/百思客/g, '<客戶D>'],
  [/荷風/g, '<客戶E>'],
]

export function scanSecrets(text) {
  const hits = []
  const lines = String(text || '').split(/\r?\n/)
  for (const [re, label] of SECRET_PATTERNS) {
    lines.forEach((line, idx) => {
      const probe = new RegExp(re.source, re.flags.replace('m', ''))
      if (probe.test(line)) hits.push({ line: idx + 1, label, text: line.trim().slice(0, 80) })
    })
  }
  return hits
}

export function maskClients(text) {
  let out = String(text || '')
  const hit = []
  for (const [re, rep] of CLIENT_MASKS) {
    re.lastIndex = 0
    if (re.test(out)) hit.push(rep)
    re.lastIndex = 0
    out = out.replace(re, rep)
  }
  return { text: out, masked: [...new Set(hit)] }
}

/**
 * 一次檢查多個要送出去的欄位。
 * 回傳 { secrets: [{field,line,label,text}], fields: {同鍵、已遮罩}, masked: [遮了誰] }
 * 純函式，不印、不 exit——讓 CLI 自己決定怎麼報。
 */
export function guardFields(fields, { mask = true } = {}) {
  const secrets = []
  const out = {}
  const masked = new Set()
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !value) { out[field] = value; continue }
    for (const h of scanSecrets(value)) secrets.push({ field, ...h })
    if (mask) {
      const r = maskClients(value)
      out[field] = r.text
      r.masked.forEach((m) => masked.add(m))
    } else out[field] = value
  }
  return { secrets, fields: out, masked: [...masked] }
}
