const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)

/**
 * A page that starts the next navigation itself. Entra ID returns the user by
 * posting a form cross-site, so a redirect from the callback would be a
 * cross-site initiated navigation and the browser would withhold the
 * SameSite=Strict session cookie set alongside it; a navigation begun by a
 * document of ours is same-site, so the cookie rides it.
 *
 * A meta refresh rather than a script because ../content-security-policy.ts
 * allows no inline script, and `no-referrer` because on the `query` response
 * mode the url this page is served at carries the authorisation code.
 *
 * Built as a string rather than through the nunjucks view layer so the whole
 * page — no inline script or style, nothing of the session — is readable here.
 */
export const continuePage = (destination: string) => {
  const target = escapeHtml(destination)

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="referrer" content="no-referrer">
    <meta http-equiv="refresh" content="0;url=${target}">
    <title>Signing you in</title>
  </head>
  <body>
    <h1>Signing you in</h1>
    <p><a href="${target}">Continue</a></p>
  </body>
</html>
`
}
