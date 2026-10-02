/**
 * See other: the browser follows a write with a GET, so a reload of the page
 * that lands never re-submits it. Spelled out here because a route may not
 * reach into common/status-codes.ts.
 */
export const seeOther = 303
