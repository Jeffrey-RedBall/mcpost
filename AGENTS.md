# MakeClass CLI — 給 Claude Code / Codex / Cursor / 其他 AI Agent

一個套件、兩個指令：

| 指令 | 做什麼 |
| :--- | :--- |
| `mcpost` | 把開發對話存成 DevLog，或發一篇文章 |
| `mcslide` | 把一篇內容做成**站上可播的簡報**（含講者備註） |

**安裝各平台都看這份。** 裝完之後怎麼用則分兩邊：Claude Code 讀
[SKILL.md](SKILL.md) 與 [skills/mcslide/SKILL.md](skills/mcslide/SKILL.md)（`install-skill` 會自動接上），
沒有 skill 機制的平台把本文的設定段落貼進自己的規則檔。
**兩邊產出的檔案格式完全相同**，差別只在各家怎麼載入提示。

---

## 安裝（一次性，不需要 clone MakeClass 主程式）

```bash
npm install -g mcpost
mcpost token    # 到 https://makeclass.me/settings/tokens 建一支 token 貼上
                #   發 DevLog 要勾 devlog:write
                #   做簡報要勾 pusher:write（mcslide 用）
                #   兩個指令共用同一支權杖（~/.makeclass/token），設定一次就好
```

用 Claude Code 的話**還要多跑一步** `mcpost install-skill`，見下一節。
Codex / Cursor 不需要，改成貼設定檔（本文後段）。

零 npm 依賴、跨平台。有 Node 18+ 就能跑。

---

## Claude Code 用法

Claude Code 不用你寫任何設定檔，跑一次 `install-skill` 就會出現 `/mcpost` 與 `/mcslide`：

```bash
npm install -g mcpost
mcpost token            # 同上，兩個指令共用同一支權杖
mcpost install-skill    # 建 symlink 到 ~/.claude/skills/
```

它做的事只有建兩個 symlink：

| 建立 | 指向 |
| :--- | :--- |
| `~/.claude/skills/mcpost` | 套件根目錄（根目錄的 `SKILL.md` 就是它） |
| `~/.claude/skills/mcslide` | 套件的 `skills/mcslide/` |

偵測到 `~/.codex` 時會一併裝到 `~/.codex/skills/`，沒有就略過——
兩邊的 skill 格式相同（`SKILL.md` + frontmatter），差別只有放哪個目錄。

**驗證**：重開 Claude Code，輸入 `/mcpost` 或 `/mcslide`，或直接說「存進 MakeClass」。

**三個要知道的**

- symlink 指向**全域** npm 安裝位置，之後 `npm update -g mcpost` 會自動生效，不用重裝
- 用 `npx` 而沒有全域安裝時，symlink 會在暫存目錄被清掉後失效 → 一定要 `npm install -g`
- 目標路徑已存在且**不是** symlink 時會直接中止，不會覆蓋你原本的東西

裝完之後 Claude Code 讀的是 [SKILL.md](SKILL.md) 與
[skills/mcslide/SKILL.md](skills/mcslide/SKILL.md)，不是這份。
這份是給沒有 skill 機制的平台看的。

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
- `question` 保留使用者**原本的問法**，但去掉專案名、客戶名、內部代號、路徑與網址——這欄會顯示在公開頁面上
- 預設 `visibility: unlisted`，不要自己改成 public
- 掃到機密會直接中止，**沒有 --force**；被擋下就回去改寫那幾行
```

## Codex 用法：做簡報（mcslide）

把這段放進專案根目錄的 `AGENTS.md`：

```markdown
## 把內容做成 MakeClass 簡報

當使用者說「做成簡報」「發成 slide」「把這篇變投影片」時，先分辨要走哪條：

**A. 讓站上的 AI 做**（他只給一個 MakeClass 連結或 pushId，沒有指定內容）
    mcslide from <pushId> --pages 20
  會讀那篇的逐字稿來寫，數字附得出時間碼。約一分鐘。

**B. 自己寫**（他給了本機 .md、或要精準控制頁序、或要改既有簡報）
  1. 照下面的 Slides Markdown 約定寫成 .md
  2. 跑 `mcslide <檔> --dry-run`，把頁面清單給使用者看過
  3. 他說可以才拿掉 --dry-run，加 `--source <來源 pushId>` 記來源

規則：
- 產出一律是草稿 + 不公開，**不要自己改成公開**
- 站內不接受任何 HTML（`<svg>`／`<figure>` 會被 CLI 擋下）；圖表先存成 PNG 用 ![]()
- 數字要有出處；素材沒有的不要編；講者觀點、示範試算用 `> 注意：` 標明
- 每頁都要寫 `<!-- notes: -->`，講者要說的話放這裡
```

### Slides Markdown 約定

```markdown
---
title: 主標
subtitle: 副標
seal: 教材                 # 封面右上印記，兩字
eyebrow: Courseware · 商業個案
lead: 封面的一句話
notes: 開場前講者要做的事
---

## [單元 1-1] 一般內容頁
- 條列
> 意思是：提煉框
> 注意：提醒框（風險、限制、講者觀點）
<!-- notes: 這頁的講者話術 -->

# 章名頁
一句話說明

## 金句
> 「一句原話」 — 講者 · 12:34

## 對照
::: pair
### [常見做法] 甲
內容
### [建議] 乙
內容
:::

## 步驟
::: steps
1. **第一步** 說明
2. **第二步** 說明
:::
```

一個 `##` 一頁、`#` 是章名頁。金句頁**一定要先有 `## ` 標題**，沒有的話那段會被併進上一頁。
頁與頁之間不要加 `---`（那只用在最上面的 front matter）。

---

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
2. 執行 `mcpost devlog <檔>`（DevLog）或 `mcslide <檔>`（簡報）

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
  <使用者原本的問法，去掉專案名／客戶名／內部代號>
source:
  agent: codex          # 改成你的平台識別
  model: <model id>
  repo: <選填，填了會印在公開頁面>
  commit: <選填，填了會印在公開頁面>
visibility: unlisted
---

<正文 Markdown>
```

必填：`makeclass` / `title` / `question` / `category` / `source.agent`。
缺任一項 CLI 會直接擋下，不會浪費一趟往返。

### 為什麼 `question` 要保留原本的問法

DevLog 的檢索入口是「**我當時卡在什麼**」，不是標題。
三個月後你會搜「worktree 什麼時候開」，不會搜「五層隔離粒度」——所以**問法要留著**。

但這欄**會顯示在公開頁面上**，所以要去掉可識別的東西：專案名、客戶名、內部代號、
檔案路徑、網址。保留的是「卡在什麼」，拿掉的是「在哪裡卡」。

| ❌ 照抄 | ✅ 保留問法、去識別 |
| :--- | :--- |
| 「acme-crm 的 /api/orders 為什麼 500」 | 「訂單 API 突然 500 怎麼查」 |
| 「幫客戶王總的案子決定要不要開 worktree」 | 「什麼時候該開 worktree」 |

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
