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

## 兩個指令，一次安裝

| 指令 | 做什麼 |
| :--- | :--- |
| `mcpost` | 開發對話存成 DevLog、發一篇文章 |
| `mcslide` | 把一篇內容做成站上可播的簡報（含講者備註） |

```bash
npm install -g mcpost
mcpost token            # 兩個指令共用同一支權杖，設定一次
mcpost install-skill    # 幫 Claude Code 裝 /mcpost 與 /mcslide
```

權杖 scope：發 DevLog 勾 `devlog:write`，做簡報勾 `pusher:write`。

```bash
mcslide from <pushId> --pages 20   # 交給站上的 AI 讀那篇來做
mcslide <檔.md> --dry-run          # 自己寫好，先看頁面清單
```

## 用法

```bash
# 一般文章 / 觀點文
mcpost post --title "標題" --post --body 正文.md

# 自己做封面（1200×630，本機 jpg／png／webp）；不給的話網頁會請 AI 自動畫
mcpost post --title "標題" --post --body 正文.md --cover 封面.jpg

# 換掉已經發出那篇的封面
mcpost post --update <pushId> --cover 新封面.jpg

# 掛附件（影片、PPT、PDF、ZIP…可重複；單檔 500 MB，直接進儲存空間）
mcpost post --title "標題" --post --body 正文.md --attach 影片.mp4 --attach 教材包.zip
mcslide 簡報.md --cover 封面.jpg --attach 授課簡報.pptx
mcslide 簡報.md --narration ./音檔/        # 導讀（1.8.0）：一頁一檔 01.mp3…，聲音講到哪翻到哪
mcslide narration <pushId> ./音檔/         # 既有簡報補導讀

# 或把標題、封面、附件寫在正文檔開頭（--- title: / cover: / attach: [a, b] ---），指令只剩 --body

# 開發知識（DevLog，進 Vibe Coding 專區）
mcpost devlog 我的devlog.md --dry-run   # 先預覽，會做機密掃描
mcpost devlog 我的devlog.md             # 確認沒問題再送

# 給 Claude Code / Codex 裝 /mcpost 與 /mcslide（說明見下一節）
mcpost install-skill
```

## Claude Code / Codex 安裝

```bash
mcpost install-skill
```

建兩個 symlink，之後輸入 `/mcpost`、`/mcslide` 就會出現：

| 建立 | 指向 |
| :--- | :--- |
| `~/.claude/skills/mcpost` | 套件根目錄 |
| `~/.claude/skills/mcslide` | 套件的 `skills/mcslide/` |

偵測到 `~/.codex` 會一併裝到 `~/.codex/skills/`。

- 一定要 `npm install -g`，用 `npx` 的話 symlink 會失效
- `npm update -g mcpost` 之後不用重裝，symlink 指向全域安裝位置
- 目標已存在且不是 symlink 會中止，不會蓋掉你的東西

驗證：重開 Claude Code，輸入 `/mcpost`。

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
