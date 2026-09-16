import { continuePage } from './continue-page.ts'

describe('continuePage', () => {
  test('sends the browser on, with a link for one that will not go', () => {
    const page = continuePage('/dev-ops')

    expect(page).toEqual(
      expect.stringContaining(
        '<meta http-equiv="refresh" content="0;url=/dev-ops">'
      )
    )
    expect(page).toEqual(
      expect.stringContaining('<a href="/dev-ops">Continue</a>')
    )
  })

  // On the `query` response mode the url this page is served at carries the
  // authorisation code, which the navigation would otherwise pass on.
  test('sends no referrer to the destination', () => {
    expect(continuePage('/dev-ops')).toEqual(
      expect.stringContaining('<meta name="referrer" content="no-referrer">')
    )
  })

  test('names the page and declares its language', () => {
    const page = continuePage('/dev-ops')

    expect(page).toEqual(expect.stringContaining('<html lang="en">'))
    expect(page).toEqual(
      expect.stringContaining('<title>Signing you in</title>')
    )
  })

  // ../content-security-policy.ts blocks every one of these, so any that crept
  // in would leave the page with no way onward but the link.
  test.each(['<script', '<style', 'onload'])(
    'reaches the destination without %s',
    (inlined) => {
      expect(continuePage('/dev-ops')).not.toEqual(
        expect.stringContaining(inlined)
      )
    }
  )

  test('escapes the destination rather than letting it close the attribute', () => {
    const page = continuePage('/events?q="><x onload=alert(1)')

    expect(page).toEqual(
      expect.stringContaining(
        '<a href="/events?q=&#34;&#62;&#60;x onload=alert(1)">'
      )
    )
    expect(page).not.toEqual(expect.stringContaining('<x '))
  })
})
