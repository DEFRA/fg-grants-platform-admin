import { load } from 'cheerio'

/**
 * Both destinations ./continue-page.ts offers: the refresh that takes the
 * browser onward, and the link behind it for one that will not follow. A guard
 * on where the user may be sent has to hold for both.
 */
export const destinationsOf = (payload: string) => {
  const $ = load(payload)

  return {
    refresh: $('meta[http-equiv="refresh"]')
      .attr('content')
      ?.slice('0;url='.length),
    link: $('a').attr('href')
  }
}
