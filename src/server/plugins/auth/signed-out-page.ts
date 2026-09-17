import { loginPath } from './paths.ts'

/**
 * Signing in again has to be a link the user chooses, never a redirect: Entra
 * ID keeps its own session after ./index.ts clears ours, so anything automatic
 * here signs them straight back in and sign out achieves nothing.
 *
 * Built as a string rather than through the nunjucks view layer, as
 * ./continue-page.ts is, so the whole of what a signed out browser receives —
 * no inline script or style, nothing of the cleared session — reads here.
 */
export const signedOutPage = () => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Signed out</title>
  </head>
  <body>
    <h1>Signed out</h1>
    <p>You are signed out of this service.</p>
    <p><a href="${loginPath}">Sign in again</a></p>
  </body>
</html>
`
