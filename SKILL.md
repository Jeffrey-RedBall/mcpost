---
name: mcpost
description: 把這次對話的開發知識（提問 + 解法 + 決策理由）整理成一篇 MakeClass DevLog 文章，送進「Vibe Coding 專區」累積知識；也能發一般觀點文。使用者說「存進 MakeClass」「發成 blog」「這段記下來」「寫成 mcpost」「/mcpost」時觸發。
---

# MakeClass DevLog — 把對話變成知識資產

AI 輔助開發最貴的產出不是 code，是「為什麼這樣做」。這支 Skill 把它從 scrollback 裡撈出來，
變成 MakeClass 上一篇可搜尋、可分享的文章。

`git push` 之於程式碼 = 這支 Skill 之於開發知識。

---

## 執行流程

### 1. 決定要記什麼

預設抓**最近一輪有實質結論的 Q&A**。使用者若指定範圍就依指定。

**不要記**：純操作指令（ls / git status）、失敗的嘗試過程、閒聊。
**要記**：判斷準則、踩坑原因、架構決策、「為什麼不選另一條路」。

> 判準：三個月後的自己會不會想再看一次？不會就別記。寧缺勿濫——
> 知識庫的價值來自密度，不是篇數。

### 2. 寫成 DevLog v1 檔

寫到 `<scratchpad>/makeclass-devlog-<slug>.md`，格式：

```markdown
---
makeclass: devlog/v1
title: <≤120 字，是「答案」不是「主題」>
subtitle: <一句話補充>
category: vibecoding
tags: [claude-code, git-worktree]
question: |
  <使用者原本的問法，去掉專案名／客戶名／內部代號／路徑>
source:
  agent: claude-code
  model: <當前 model id>
  repo: <repo 名，選填——填了會印在公開頁面>
  commit: <當前 HEAD 短 hash，選填——填了會印在公開頁面>
visibility: unlisted
---

<正文 Markdown>
```

**`question` 保留使用者原本的問法，但要去識別。** DevLog 的檢索入口是「我當時卡在什麼」，
不是標題——三個月後你會搜「worktree 什麼時候開」，不會搜「五層隔離粒度」，所以問法要留著。
但這欄**會顯示在公開頁面上**：專案名、客戶名、內部代號、路徑、網址一律拿掉。
保留「卡在什麼」，拿掉「在哪裡卡」。

正文寫作原則：
- 開頭直接給結論，不要鋪陳
- 保留**判準**（「怎麼決定要不要開」）勝過保留步驟
- 有具體數字／檔案路徑就寫進去
- 反例跟正例一樣重要——寫清楚「什麼時候不要這樣做」

正文排版（MakeClass 會依 Markdown **形狀**自動排成卡片，不要寫 HTML）：

| 內容是… | 這樣寫 |
|---|---|
| 幾個並列重點 | 無序列表 **3–4 項**，每項 `- **標題**：一句說明` → 小卡格 |
| 有順序的幾點 | `1. **標題。** 說明 1–3 句` → 編號卡 |
| 過去 vs 現在 | 兩個緊鄰引用框 `> 以前：…` 接 `> 現在：…`（或 之前／之後、常見做法／建議）→ 對照卡 |
| 流程、循環 | 單獨一段 `提問 → 找資料 → 回答`，每步短、不帶標點，循環結尾加 ` ↻` → 流程串 |
| 一個具體例子 | `> 例如：…` |
| 一句提煉／一個風險 | `> 意思是：…` ／ `> 注意：…` |
| 概念對照 | 剛好兩欄的表格 |

- **一節（`##`）最多一個元件，一篇 2–5 個**。整篇都是卡片跟整篇都是條列一樣單調
- 內容本身是那個形狀才用，不要為了用元件硬拆
- 每節 2–5 段就換 `##`；第一個 `##` 之前那段會被放大當導言，寫成一句話的結論

### 3. 驗證 + 預覽（一定要跑）

```bash
mcpost devlog <檔案> --dry-run
```

它會：驗 frontmatter 必填 → **掃機密（掃到直接中止）** → 遮客戶名 → 印 preview。

⚠️ **掃到機密沒有 --force。** 開發對話天然含 `.env` 值、API key、DB 連線字串，
少擋一個就是一次外洩。被擋下就回去改寫那幾行，不要想繞過。

### 4. 送出

```bash
mcpost devlog <檔案>
```

需要 token（跑過 `mcpost token` 或設 `$MAKECLASS_TOKEN`）。權杖 scope 要有 `devlog:write`
（**不是預設值**，建權杖時要自己勾）；非互動情境（CI／agent 自動跑）要加 `--yes`。
送出後一律是**草稿 + unlisted**，回傳 `https://makeclass.me/learn/<id>`，要公開得人自己去按。

### 5. 一般觀點文（不進 Vibe Coding 專區）

如果要發的不是開發知識，是一篇一般的觀點文／心得，用 `mcpost post` 而不是 `mcpost devlog`：

```bash
mcpost post --title "標題" --post --body 正文.md
```

`--post` 是「人寫的觀點文」，不加就是 AI Note。兩支指令走不同端點，不要混用。

**拿站上一篇當參考、加上自己的觀點寫成 Post**：不用自己寫正文，交給站上的 AI 寫：

```bash
mcpost post --from https://makeclass.me/learn/<id> --take "我的觀點…"   # 扣 3 點，失敗自動退
```

`--take` 是這篇 Post 的主軸（至少 10 個字，可以是文字、檔案路徑或 `-`）；那篇文章是引用素材。
產出是 unlisted 草稿，回傳審閱網址，人看過才發布。跟網頁文章頁的「發成 Post」是同一個功能。

**圖文並茂**：正文裡直接寫 `![說明](./img/a.png)`，路徑相對於正文那個檔案。
`mcpost post`、`mcpost devlog`（1.5.0 起）、`mcslide`（1.5.0 起）都會自動把本地圖片上傳到 MakeClass 再換成 https 網址——站上正文**只顯示
https 的圖片**（http 與 `data:` 一律不渲染），所以不先上傳的話一張都不會出現。
不想自動上傳就加 `--no-images`。SVG 不收（可夾帶 script），請先轉成 PNG。
devlog 補圖走一般內容端點，權杖除了 `devlog:write` 還要勾「發表內容」（`pusher:write`）。

**封面（1.6.0 起）**：加 `--cover 封面.jpg`（devlog 也可以寫在 front matter 的 `cover: ./封面.jpg`）。
**沒給封面的話**，作者在網頁打開審閱頁時系統會請 AI 自動畫一張——常常畫錯（標誌、人物、文字都可能走樣）。
重要的文章建議自己做：

- 規格：**1200×630**（分享到 LINE、FB 的比例），`.jpg`／`.png`／`.webp`，9 MB 以內；只收本機檔，不收網址
- 做法：寫一頁 1200×630 的 HTML（標題＋一張主視覺；中文用 Noto Serif TC／Noto Sans TC），用 headless Chrome 截圖：
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1200,630 --virtual-time-budget=8000 --screenshot=cover.png file:///絕對路徑/cover.html`
- 系列文章用同一個版型、每篇換顏色或編號，一眼看得出是一套但不是同一篇
- 換已發出那篇的封面：`mcpost post --update <pushId> --cover 新封面.jpg`
- ⚠️ 截完**自己看一次**再送（文字是否被切掉、有沒有斷行斷在奇怪的地方）

**附件（1.7.0 起）**：影片、PPT、PDF、ZIP 這類「給讀者下載」的檔案，用 `--attach 檔案`（可重複）掛成附件，
會出現在文章的附件區；單檔 500 MB，直接傳進儲存空間不經 API 的 10 MB 限制。
不要再把下載網址手寫進正文——那是 1.6 以前的權宜做法。

**正文檔開頭可以放設定區**，一份檔案就把標題、封面、附件交代完（旗標優先於設定區）：

```markdown
---
title: 從 AI 封面縮圖，到自己的工作流程
subtitle: 世新大學 AI 課程完整講義
cover: ./cover.jpg
attach:
  - ./影片/01.mp4
  - ./教材包.zip
---
正文…
```

**講義 → 簡報**（同一份教材要同時發講義與簡報時）：講義若是「每頁一節＋講師講稿」的格式
（例：`## 投影片 N｜標題`、條列、圖、然後一段講稿），轉成 Slides Markdown 的規則是：
`# 段落名` 當章名頁、每個投影片節變一頁 `## 標題`＋條列＋圖、**講稿整段放進 `<!-- notes: -->`**（上台就是講者備註），
附錄不進簡報。做好用 `mcslide 簡報.md --source <講義 pushId> --cover 封面.jpg` 送上，兩篇互連。

### 6. 回報

把 preview 的重點（標題／能見度／遮罩了誰）講給使用者聽，附上檔案路徑或回傳的 URL。
**不要自作主張改成 public。**

---

## 鐵則

1. **預設 unlisted + 草稿**——公開與否是人的決定，不是 agent 的
2. **機密掃描不可繞過**——這是最後一道防線
3. **preview 一定給人看過**——`--yes` 只給 CI 用，互動情境不准用
4. **寧缺勿濫**——沒有實質結論的對話不要記

---

## 安裝（一次性）

```bash
npm install -g mcpost
mcpost token          # 到 https://makeclass.me/settings/tokens 建一支 token 貼上
mcpost install-skill  # 讓 Claude Code 出現 /mcpost 指令
```

不需要 clone MakeClass 主程式——這支套件跟 MakeClass 後端 API 一樣，只靠 Token 驗證身分。

## 給其他 AI 平台

Codex / Cursor 的接法見同目錄 [AGENTS.md](AGENTS.md)。
