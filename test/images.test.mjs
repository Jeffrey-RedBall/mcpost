// 正文裡的本地圖片辨識與網址替換。跑法：node --test test/
//
// 為什麼要測：這兩支決定「哪些檔案會被上傳」與「正文被改成什麼」。
// 認錯了會把不該傳的檔案送上公開儲存空間，換錯了會讓整篇文章的圖全掛。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findLocalImages, rewriteImageUrls } from '../bin/images.mjs'

const dir = mkdtempSync(join(tmpdir(), 'mcpost-img-'))
mkdirSync(join(dir, 'img'), { recursive: true })
writeFileSync(join(dir, 'img', 'a.png'), 'x')
writeFileSync(join(dir, 'img', 'b.jpg'), 'x')
writeFileSync(join(dir, 'img', 'c.svg'), 'x')
writeFileSync(join(dir, 'notes.txt'), 'x')

test('抓得到本地圖片，路徑相對於正文檔案', () => {
  const md = '前言\n\n![甲](./img/a.png)\n\n![乙](img/b.jpg)\n'
  const got = findLocalImages(md, dir).map((i) => i.raw)
  assert.deepEqual(got, ['./img/a.png', 'img/b.jpg'])
})

test('已經是網址的不碰', () => {
  const md = '![x](https://e.com/a.png)\n![y](http://e.com/b.png)\n![z](//e.com/c.png)\n![w](data:image/png;base64,AAA)'
  assert.equal(findLocalImages(md, dir).length, 0)
})

test('找不到檔案、不是圖片副檔名的都跳過', () => {
  const md = '![a](./img/missing.png)\n![b](./notes.txt)\n![c](./img/c.svg)'
  // svg 刻意不收：它可以夾帶 script，站上本來就不通過任何 HTML
  assert.equal(findLocalImages(md, dir).length, 0)
})

test('同一張圖出現兩次只上傳一次', () => {
  const md = '![一](./img/a.png)\n\n說明\n\n![二](./img/a.png)'
  assert.equal(findLocalImages(md, dir).length, 1)
})

test('帶 title 的語法也認得', () => {
  const md = '![甲](./img/a.png "這是圖說")'
  assert.equal(findLocalImages(md, dir)[0]?.raw, './img/a.png')
})

test('替換只動 ![]() 裡的那一份，內文提到同樣的字串不受影響', () => {
  const md = '檔案放在 ./img/a.png 這個位置。\n\n![甲](./img/a.png)'
  const out = rewriteImageUrls(md, new Map([['./img/a.png', 'https://s.googleapis.com/b/1_a.png']]))
  assert.match(out, /!\[甲\]\(https:\/\/s\.googleapis\.com\/b\/1_a\.png\)/)
  assert.match(out, /檔案放在 \.\/img\/a\.png 這個位置。/, '內文那一處不可以被換掉')
})

test('多張圖一起換', () => {
  const md = '![甲](./img/a.png)\n![乙](img/b.jpg)'
  const out = rewriteImageUrls(md, new Map([
    ['./img/a.png', 'https://s/1.png'],
    ['img/b.jpg', 'https://s/2.jpg'],
  ]))
  assert.equal(out, '![甲](https://s/1.png)\n![乙](https://s/2.jpg)')
})

test('帶說明的圖也要換（1.4.2 以前漏掉）', () => {
  const md = '![甲](./img/a.png "說明文字")\n![乙](./img/a.png)'
  const out = rewriteImageUrls(md, new Map([['./img/a.png', 'https://cdn/a.png']]))
  assert.equal(out, '![甲](https://cdn/a.png "說明文字")\n![乙](https://cdn/a.png)')
})
