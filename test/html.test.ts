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

  it('drops script and style element contents entirely', () => {
    expect(htmlToText('<style>.a{color:red}</style><p>Body</p><script>var x=1</script>')).toBe('Body')
  })

  it('separates table cells and nested list items', () => {
    expect(htmlToText('<table><tr><td>Weight</td><td>500g</td></tr></table>')).toBe('Weight 500g')
    expect(htmlToText('<ul><li>A<ul><li>B</li></ul></li></ul>')).toBe('A\nB')
  })

  it('decodes hex numeric entities and extended named entities', () => {
    expect(htmlToText('It&#x2019;s caf&eacute; &ndash; 5&deg;')).toBe('It’s café – 5°')
  })

  it('does not split a surrogate pair when truncating', () => {
    const text = 'ab😀cd'
    const out = htmlToText(text, 3)
    expect(out).toBe('ab…')
  })
})
