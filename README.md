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

## 疑難排解

**指令表現跟預期不一樣**（例如 `mcpost token` 沒有問你要不要貼 token，反而報 `缺少 --title` 之類跟 token 無關的錯誤）：

先跑：

```bash
which -a mcpost
```

如果列出來的路徑不是 npm 全域安裝的位置，而是指向別的檔案，代表你的 shell 設定裡有一條**同名的 alias 或 function** 蓋掉了 `mcpost` 這個指令（`type mcpost` 可以看得更清楚，會直接顯示「aliased to …」）。到 `~/.zshrc`（或 `~/.bashrc`）裡找到那條 `alias mcpost=...` 或 `mcpost() { ... }`，刪掉或改名，重開一個新終端機分頁（或 `source ~/.zshrc`）再試一次。

## 安全

- 送出前一律跑機密掃描（API key、私鑰、DB 連線字串、`.env` 賦值），**掃到直接中止，沒有 `--force`**
- 送出後預設**草稿 + unlisted**，公開與否由你自己到 MakeClass 網站上按

## License

MIT
