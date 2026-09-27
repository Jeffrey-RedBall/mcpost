// mcpost post --from：文章網址／pushId 的解析
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushIdFrom } from '../bin/mcpost.mjs'

test('learn 網址（有無尾斜線、帶 query）', () => {
  assert.equal(pushIdFrom('https://makeclass.me/learn/cmuj85hmb0001xlv2w1ged815'), 'cmuj85hmb0001xlv2w1ged815')
  assert.equal(pushIdFrom('https://makeclass.me/learn/cmuj85hmb0001xlv2w1ged815/'), 'cmuj85hmb0001xlv2w1ged815')
  assert.equal(pushIdFrom('https://makeclass.me/learn/cmuj85hmb0001xlv2w1ged815?x=1'), 'cmuj85hmb0001xlv2w1ged815')
})

test('review 網址與純 pushId', () => {
  assert.equal(pushIdFrom('https://makeclass.me/pusher/cmuj85hmb0001xlv2w1ged815/review'), 'cmuj85hmb0001xlv2w1ged815')
  assert.equal(pushIdFrom('cmuj85hmb0001xlv2w1ged815'), 'cmuj85hmb0001xlv2w1ged815')
})

test('看不懂的輸入回 null', () => {
  assert.equal(pushIdFrom('https://youtube.com/watch?v=abc'), null)
  assert.equal(pushIdFrom('hello'), null)
  assert.equal(pushIdFrom(''), null)
})
