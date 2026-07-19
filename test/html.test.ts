import { describe, it, expect } from 'vitest'
import { htmlToText } from '../src/html.js'

describe('htmlToText', () => {
  it('strips tags and keeps text', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('turns block-level closers and <br> into newlines', () => {
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one\ntwo')
    expect(htmlToText('one<br>two')).toBe('one\ntwo')
  })

  it('decodes common entities', () => {
    expect(htmlToText('Tom &amp; Jerry &euro;5 &lt;ok&gt;')).toBe('Tom & Jerry €5 <ok>')
    expect(htmlToText('&#8364;10')).toBe('€10')
  })

  it('collapses runs of whitespace', () => {
    expect(htmlToText('a   b\n\n\nc')).toBe('a b\nc')
  })

  it('truncates to maxLength with an ellipsis', () => {
    expect(htmlToText('x'.repeat(50), 10)).toBe('x'.repeat(10) + '…')
  })
})
