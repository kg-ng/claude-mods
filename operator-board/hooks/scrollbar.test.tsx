import { expect, test } from 'claude-code/testing'
import { scrollbar } from './extras'

test('no bar when the content fits', async () => {
  expect(scrollbar(0, 40, 40)).toBeUndefined()
  expect(scrollbar(0, 40, 10)).toBeUndefined()
  expect(scrollbar(0, 40, 0)).toBeUndefined()
})

test('thumb is sized to the window and moves from top to bottom', async () => {
  expect(scrollbar(0, 40, 120)).toEqual({ top: 0, thumb: 13, start: 0 })
  expect(scrollbar(40, 40, 120)).toEqual({ top: 40, thumb: 13, start: 14 })
  expect(scrollbar(80, 40, 120)).toEqual({ top: 80, thumb: 13, start: 27 })
})

test('a stale offset past the end is clamped, and a huge tree keeps a 1-row thumb', async () => {
  expect(scrollbar(500, 40, 120)).toEqual({ top: 80, thumb: 13, start: 27 })
  expect(scrollbar(0, 10, 5000)).toEqual({ top: 0, thumb: 1, start: 0 })
})
