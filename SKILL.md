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
  <使用者的原始提問，原文照抄不要改寫>
source:
  agent: claude-code
  model: <當前 model id>
  repo: <repo 名，選填>
  commit: <當前 HEAD 短 hash，選填>
visibility: unlisted
---

<正文 Markdown>
```

**`question` 一定要原文照抄。** DevLog 的檢索入口是「我當時卡在什麼」，
不是標題——三個月後你會搜「worktree 什麼時候開」，不會搜「五層隔離粒度」。

正文寫作原則：
- 開頭直接給結論，不要鋪陳
- 保留**判準**（「怎麼決定要不要開」）勝過保留步驟
- 有具體數字／檔案路徑就寫進去
- 反例跟正例一樣重要——寫清楚「什麼時候不要這樣做」

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
