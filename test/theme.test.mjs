// 簡報主題（1.9.0）：預覽規則要跟站上 slideTheme.ts 一致。跑法：node --test test/
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { resolveTheme, isBigWord, hasAccent, lecturePreview } from '../bin/theme.mjs'

test('resolveTheme：沒寫＝預設；講堂／lecture＝講堂；其他值標出來', () => {
  assert.deepEqual(resolveTheme(undefined), { theme: 'default' })
  assert.deepEqual(resolveTheme('講堂'), { theme: 'lecture' })
  assert.deepEqual(resolveTheme('Lecture'), { theme: 'lecture' })
  assert.deepEqual(resolveTheme('講堂風'), { theme: 'default', unknown: '講堂風' })
})

test('大字報：只有 ## 內容頁、≤ 6 字、無空白；章名頁不算', () => {
  assert.equal(isBigWord({ level: 2, title: 'GEO' }), true)
  assert.equal(isBigWord({ level: 2, title: 'GEO {#geo}' }), true)
  assert.equal(isBigWord({ level: 2, title: '[四個 O] GEO' }), true)
  assert.equal(isBigWord({ level: 2, title: '為什麼要做工具' }), false) // 7 字
  assert.equal(isBigWord({ level: 2, title: 'AI 工具' }), false)        // 有空白
  assert.equal(isBigWord({ level: 1, title: 'GEO' }), false)
})

test('強調色：「：」或「｜」切得出兩段才算', () => {
  assert.equal(hasAccent({ level: 2, title: '五個核心模組：輸入條件' }), true)
  assert.equal(hasAccent({ level: 2, title: '網站正在成為｜人與 AI 的交流站' }), true)
  assert.equal(hasAccent({ level: 2, title: '結尾冒號：' }), false)
  assert.equal(hasAccent({ level: 2, title: '沒有分隔' }), false)
})

test('lecturePreview：頁碼含封面（第一頁內容是 2）；大字報不重複算進強調色', () => {
  const pv = lecturePreview([{ level: 1, title: '一、開始' }, { level: 2, title: 'GEO' }, { level: 2, title: '重點：一句話' }])
  assert.deepEqual(pv, { big: [3], accent: [4] })
})

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'mcslide.mjs')
function dry(md) {
  const dir = mkdtempSync(join(tmpdir(), 'mcslide-theme-'))
  const f = join(dir, 'deck.md'); writeFileSync(f, md)
  return spawnSync(process.execPath, [BIN, f, '--dry-run'], { encoding: 'utf8',
    env: { ...process.env, MCPOST_NO_UPDATE_CHECK: '1', MAKECLASS_TOKEN: 'mck_test', HOME: tmpdir(), MAKECLASS_API: 'http://127.0.0.1:9' } })
}

test('mcslide --dry-run：講堂主題印出大字報頁與強調色頁數', () => {
  const r = dry('---\ntitle: 測試\ntheme: 講堂\n---\n\n# 一、開始\n\n## GEO\n副標\n\n## 重點：一句話\n- a\n')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /主題：講堂 · 大字報頁 3 · 強調色標題 1 頁/)
})

test('mcslide --dry-run：主題名打錯會提醒', () => {
  const r = dry('---\ntitle: 測試\ntheme: 講堂風\n---\n\n## 第一頁\n- a\n')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /主題「講堂風」站上不認得/)
})

test('mcslide --dry-run：沒寫主題就不印主題行（舊行為不變）', () => {
  const r = dry('---\ntitle: 測試\n---\n\n## 第一頁\n- a\n')
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stdout, /主題/)
})
