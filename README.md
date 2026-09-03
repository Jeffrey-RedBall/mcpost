# mcpost

把開發對話或觀點文，從任何終端機直接發到 [MakeClass](https://makeclass.me)——不需要
`clone` MakeClass 主程式，只需要一支 Personal Access Token。

MakeClass 的後端 API 本來就是用 Token 驗證身分，跟原始碼存取權限完全無關——就像
`@notionhq/client` 不需要 clone Notion 自己的原始碼一樣，這支套件把「發文」這個能力
獨立出來發布。

## 安裝

```bash
npm install -g mcpost
mcpost token          # 去 https://makeclass.me/settings/tokens 建一支 token 貼上
```

## 用法

```bash
# 一般文章 / 觀點文
mcpost post --title "標題" --post --body 正文.md

# 開發知識（DevLog，進 Vibe Coding 專區）
mcpost devlog 我的devlog.md --dry-run   # 先預覽，會做機密掃描
mcpost devlog 我的devlog.md             # 確認沒問題再送

# 給 Claude Code 裝 /mcpost 指令
mcpost install-skill
```

## 給 AI Agent 用

- Claude Code：見 [SKILL.md](SKILL.md)
- Codex／Cursor／其他：見 [AGENTS.md](AGENTS.md)

## 安全

- 送出前一律跑機密掃描（API key、私鑰、DB 連線字串、`.env` 賦值），**掃到直接中止，沒有 `--force`**
- 送出後預設**草稿 + unlisted**，公開與否由你自己到 MakeClass 網站上按

## License

MIT
