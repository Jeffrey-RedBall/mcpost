# MakeClass DevLog — 給 Codex / Cursor / 其他 AI Agent

Claude Code 走 [SKILL.md](SKILL.md)；其他平台走這份。**兩邊產出的檔案格式完全相同**，
差別只在各家怎麼載入提示。

---

## 安裝（一次性，不需要 clone MakeClass 主程式）

```bash
npm install -g mcpost
mcpost token    # 到 https://makeclass.me/settings/tokens 建一支 token（勾 devlog:write）貼上
```

零 npm 依賴、跨平台。有 Node 18+ 就能跑。

---

## Codex 用法

把這段放進專案根目錄的 `AGENTS.md`：

```markdown
## 存開發知識到 MakeClass

當使用者說「存進 MakeClass」「發成 blog」「寫成 mcpost」時：

1. 把這次對話的提問與結論寫成 DevLog v1 格式的 .md（格式見下）
2. 跑 `mcpost devlog <檔> --dry-run`
3. 把 preview 給使用者看，他說可以才拿掉 --dry-run

規則：
- 只記有實質結論的內容（判準、踩坑原因、架構決策）
- 不記純操作指令（ls / git status）、失敗的嘗試過程、閒聊
- `question` 欄位要**原文照抄**使用者的提問，不要改寫
- 預設 `visibility: unlisted`，不要自己改成 public
- 掃到機密會直接中止，**沒有 --force**；被擋下就回去改寫那幾行
```

## Cursor 用法

同樣內容存成 `.cursor/rules/mcpost.mdc`，加 `description` 讓它按需載入：

```yaml
---
description: 把開發對話存成 MakeClass DevLog 文章
globs:
alwaysApply: false
---
```

## 其他平台

只要能做到兩件事就能接：
1. 產出符合下面格式的 `.md`
2. 執行 `mcpost devlog <檔>`

---

## DevLog v1 格式

```markdown
---
makeclass: devlog/v1
title: <≤120 字，寫「答案」不是「主題」>
subtitle: <一句話>
category: vibecoding
tags: [tag1, tag2]
question: |
  <使用者原始提問，照抄>
source:
  agent: codex          # 改成你的平台識別
  model: <model id>
  repo: <選填>
  commit: <選填>
visibility: unlisted
---

<正文 Markdown>
```

必填：`makeclass` / `title` / `question` / `category` / `source.agent`。
缺任一項 CLI 會直接擋下，不會浪費一趟往返。

### 為什麼 `question` 一定要照抄

DevLog 的檢索入口是「**我當時卡在什麼**」，不是標題。
三個月後你會搜「worktree 什麼時候開」，不會搜「五層隔離粒度」。

---

## 非互動情境（CI／agent 自動跑）

加 `--yes` 跳過確認：

```bash
mcpost devlog <檔> --yes
```

⚠️ **只給 CI 用。**互動情境一定要讓人看過 preview 再送。

---

## 安全要求（所有平台一致）

CLI 會硬擋這些，**沒有 `--force`**：
API key、私鑰、含密碼的 DB 連線字串、Bearer token、`.env` 形式的賦值。

**被擋下＝回去改寫那幾行，不是想辦法繞過。**

## 送出後

一律是**草稿 + unlisted**，回傳 `https://makeclass.me/learn/<id>`。
**要公開得由人自己去按**——agent 不做這個決定。
