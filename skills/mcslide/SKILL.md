---
name: mcslide
description: 把一篇 Note／Post／教材／這次對話，做成 MakeClass 站上可播的簡報草稿。使用者說「做成簡報放上去」「發成 slide」「把這篇變投影片」「/mcslide」時觸發。產 Slides Markdown 後用 PAT 建 contentType='slides' 的草稿，回傳可播的連結。與 /slides-html 的差別：那支產本機 HTML 自己看，這支送站上給別人看。安裝：npm install -g mcpost（mcpost 與 mcslide 同一包）。
---

# mcslide — 把知識送上台

`/mcpost` 把對話變成一篇文章；`/mcslide` 把一篇內容變成一份**站上可播的簡報**。
跟 `/mcpost` 同一個套件、同一支權杖（`~/.makeclass/token`）——`npm install -g mcpost` 裝一次，兩個指令都有。

| | `/slides-html` | `/mcslide` |
| :--- | :--- | :--- |
| 產出 | 本機單檔 HTML | MakeClass 上的簡報草稿 |
| 誰看 | 自己、投影、轉 PDF | 站上讀者，可分享連結 |
| 圖表 | SVG 隨便放 | **只能圖片**（站內不解析 HTML） |
| 講者備註 | 都看得到 | 只有作者與有權限的讀者看得到 |

---

## 兩條路：自己寫，或交給站上的 AI

| | `mcslide from <pushId>` | `mcslide <檔.md>` |
| :--- | :--- | :--- |
| 誰寫 | 站上的 AI 讀逐字稿寫 | 你（照約定寫 Slides Markdown） |
| 成本 | 使用點數 | 免費 |
| 適合 | 「把那篇做成 20 頁」這種直接需求 | 要精準控制頁序、要混合多份素材、要改既有簡報 |

```bash
mcslide from cmu018xn60007f2hielnyic2w --pages 20
```

權杖打得動這支（scope 要有 **發表內容 pusher:write**），產出一律是 unlisted 草稿，代理發不出去。
這支有自己的速率限制，比一般建立緊；撞到就等一下再跑。

自己寫的流程往下看。

---

## 執行流程（自己寫）

### 1. 決定素材

| 使用者給的 | 做法 |
| :--- | :--- |
| MakeClass 網址或 pushId | 用 PAT 抓那篇：先 `GET /pusher/:id` 拿 `articleBody`／`aiSummary`，有逐字稿就 `GET /:id/transcript`（原話最值錢）。**記下 pushId，等下要當 `--source`** |
| 本機 `.md`（教材、逐字稿、筆記） | 直接讀 |
| 「把剛剛這段做成簡報」 | 用這次對話的結論，但先講清楚你要收哪一段 |

```bash
TOKEN=$(cat ~/.makeclass/token)
API=https://asia-east1-makeclass-prod.cloudfunctions.net/api/v1/makeclass/pusher
curl -s "$API/<pushId>" -H "Authorization: Bearer $TOKEN" | jq -r '.data.articleBody'
curl -s "$API/<pushId>/transcript" -H "Authorization: Bearer $TOKEN" | jq -r '.data.transcriptArticle // .data.srt'
```

### 2. 寫成 Slides Markdown

約定跟 `/slides-html` 完全一樣（`## ` 一頁、`# ` 章名頁、`::: pair`、`::: steps`、
`> 意思是：`／`> 注意：`、`> 「金句」 — 出處`、`<!-- notes: -->`），
但**站內版多三條限制**：

1. **不能有任何 HTML**——`<svg>`、`<figure>`、`<div>` 都會被 CLI 擋下。圖表先存成 PNG，
   用 `![說明](https://… "caption")`；圖片網址必須是 https。
2. **本機圖片直接寫相對路徑**——`![說明](./img/a.png "caption")`，路徑相對於這份 .md。
   mcslide（1.5.0 起）會先建草稿、把圖傳上去、再換成 https 網址；`--dry-run` 會列出抓到幾張。
   不想自動上傳就加 `--no-images`。SVG 不收，請先轉成 PNG；單張上限 9 MB。
3. **front matter 一定要有 `title`**，封面才有東西；`seal` 兩個字（例：教材、提案），
   `speaker` 不填會用你的預設頻道。
4. **封面與附件（1.7.0 起）**：`--cover 封面.jpg` 自己給封面（不讓網頁請 AI 畫）；`--attach 檔案` 掛可編輯的 PPTX、PDF、影片（可重複，單檔 500 MB）。
   也可寫在 front matter：`cover: ./封面.jpg`、`attach: [./deck.pptx, ./deck.pdf]`。

改寫原則（同 `/slides-html`）：一頁一件事、模組開頭給 `#` 章名頁、每頁都寫
`<!-- notes: -->`（講者要說的話）、金句獨立成頁、數字附出處、
收尾兩頁（練習／帶走三句話）。頁數沒指定就 15–25 頁。

### 3. 預覽再送

```bash
mcslide <檔.md> --dry-run
```

會印出頁數、每頁標題、有幾頁備註。**先把這份清單給使用者看**，確認頁序與頁數再送。

```bash
mcslide <檔.md> --source <來源 pushId> --channel @bigred
```

- `--source`：這份簡報是從哪篇轉出來的。有填的話，來源會顯示在列表卡上，之後素材庫也靠它串來源鏈。
- `--channel`：發到哪個頻道，不填走預設頻道。
- `--update <pushId>`：改既有的簡報（會覆蓋整份正文）。

送出後一律是**草稿 + 不公開**，回傳 `https://makeclass.me/learn/<id>` 可直接播。

### 4. 回報

給使用者：可播連結、頁數、備註頁數、來源是哪篇。提醒他到 `/slides` 看過再按發布。
**不要自己改成公開。**

---

## 鐵則

1. **預設草稿 + unlisted**——公開與否是人的決定
2. **`--dry-run` 的頁面清單一定給人看過**再送
3. **站內不收 HTML**——被擋下就把圖表換成 PNG，不要想繞過（公開頁會渲染給其他讀者看）
4. **數字要有出處**——來自逐字稿的附時間碼；素材沒有的不要編；講者觀點、示範試算用 `> 注意：` 標明
5. **對外發布版不可出現客戶名稱或企業代號**
6. **寧缺勿濫**——沒有實質內容的東西不要做成簡報

## 常見錯誤

| 訊息 | 意思 |
| :--- | :--- |
| `站內不收 HTML（偵測到 <svg>）` | 圖表換成 PNG |
| `缺少 front matter` | 檔案開頭要有 `---\ntitle: …\n---` |
| `找不到來源 pushId` | `--source` 指到你看不到的內容（別人的私人或訂閱限定），或 id 打錯 |
| `你的頻道裡沒有 @xxx` | 用 `mcpost channels` 看有哪些 |
| `403` on `from` | 權杖沒勾「發表內容」（pusher:write） |
| 點數不足 | 到 makeclass.me 的「點數」頁儲值 |
