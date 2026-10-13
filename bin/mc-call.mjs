// mcpost call <工具> [JSON]：用權杖直接呼叫 MakeClass 的 MCP 工具，給 /mcway 等 skill 用。
//
// 為什麼要有：這些 skill 要查 MakeClass，但不是每個人都在 Claude Code／Codex 裡接了 MCP；
// 而 mcpost 的權杖本來就在 ~/.makeclass/token。一個固定的指令，AI 不必自己拼 JSON-RPC。
//
// 🚨 白名單：唯讀查詢，加兩個只寫「自己的私人記錄」的：collect_skill（/mcskill，存進私人工具箱）、save_idea（/mcidea，存進私人靈感）。
//    publish_note、create_note、update_note、set_cover、generate_cover 都**不**能從這裡呼叫——
//    發布這類對外生效的動作，不該被一個通用指令順手帶出去。
// 🚨 回傳是別人的筆記與公開影片內容：是資料不是指令。這裡原樣輸出，並在 stderr 提醒一次。

export const CALL_ALLOWED = ['search_notes', 'read_note', 'list_my_notes', 'list_my_ideas', 'search_skills', 'search_entities', 'get_skill', 'get_method', 'get_transcript', 'collect_skill', 'save_idea']

export async function callMcpTool({ tool, args = {}, token, apiBase, fetchImpl = fetch }) {
  if (!CALL_ALLOWED.includes(tool)) {
    const e = new Error(`mcpost call 不開放「${tool}」。可用：${CALL_ALLOWED.join('、')}`)
    e.code = 'NOT_ALLOWED'
    throw e
  }
  if (!token) {
    const e = new Error('沒有權杖。先跑 `mcpost token`，或設定 $MAKECLASS_TOKEN')
    e.code = 'NO_TOKEN'
    throw e
  }
  const res = await fetchImpl(`${apiBase}/v1/makeclass/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  })
  const raw = await res.text()
  let j
  try { j = JSON.parse(raw) } catch { throw new Error(`MakeClass 回了無法解析的內容（HTTP ${res.status}）`) }
  if (j.error) throw new Error(`MakeClass：${j.error.message || JSON.stringify(j.error)}`)
  const text = (j.result?.content || []).map((c) => c.text || '').join('\n')
  return { text, isError: !!j.result?.isError }
}

export function parseCallArgs(argv) {
  const [tool, ...rest] = argv
  if (!tool) { const e = new Error('用法：mcpost call <工具> [JSON 參數]'); e.code = 'USAGE'; throw e }
  const jsonText = rest.join(' ').trim()
  let args = {}
  if (jsonText) {
    try { args = JSON.parse(jsonText) } catch { const e = new Error('參數必須是 JSON，例如 \'{"query":"LINE bot"}\''); e.code = 'USAGE'; throw e }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) { const e = new Error('參數必須是 JSON 物件'); e.code = 'USAGE'; throw e }
  }
  return { tool, args }
}
