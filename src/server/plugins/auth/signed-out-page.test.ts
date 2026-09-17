import { signedOutPage } from './signed-out-page.ts'

describe('signedOutPage', () => {
  test('says the user is signed out and offers the way back in', () => {
    const page = signedOutPage()

    expect(page).toEqual(expect.stringContaining('<h1>Signed out</h1>'))
    expect(page).toEqual(
      expect.stringContaining('<a href="/auth/login">Sign in again</a>')
    )
  })

  // Anything that navigates on its own returns to Entra ID, which still holds
  // its own session, and signs the user back in without them asking.
  test.each(['<meta http-equiv="refresh"', '<script', '<style', 'onload'])(
    'leaves the browser where it is, without %s',
    (inlined) => {
      expect(signedOutPage()).not.toEqual(expect.stringContaining(inlined))
    }
  )

  test('names the page and declares its language', () => {
    const page = signedOutPage()

    expect(page).toEqual(expect.stringContaining('<html lang="en">'))
    expect(page).toEqual(expect.stringContaining('<title>Signed out</title>'))
  })
})
