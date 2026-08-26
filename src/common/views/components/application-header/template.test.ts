import { render } from '#test/utils.ts'

const params = {
  title: 'Elmwood Land Co',
  summary: [
    { label: 'Scheme', text: 'Woodland Management Plan' },
    { label: 'Application ID', text: 'wood-1001' },
    { label: 'SBI', text: '113598882' }
  ]
}

describe('application header component', () => {
  test('titles the page with what it was given', () => {
    const $header = render('application-header', params)

    expect(
      $header('h1[data-testid="application-header-title"]').text().trim()
    ).toBe('Elmwood Land Co')
  })

  // The component names no field: which ones appear, and in what order, is the
  // grant definition's decision. The colon between label and value is drawn by
  // css, so it is absent here and unannounced by a screen reader.
  test('shows each summary field in the order it was given', () => {
    const $header = render('application-header', params)

    expect(
      $header('[data-testid="application-header-field"]')
        .map((_, field) => $header(field).text().replace(/\s+/g, ' ').trim())
        .get()
    ).toEqual([
      'Scheme Woodland Management Plan',
      'Application ID wood-1001',
      'SBI 113598882'
    ])
  })

  test('pairs each value with its label', () => {
    const $header = render('application-header', params)
    const $first = $header('[data-testid="application-header-field"]').first()

    expect($first.find('dt').text().trim()).toBe('Scheme')
    expect($first.find('dd').text().trim()).toBe('Woodland Management Plan')
  })

  test('shows a value that has no label', () => {
    const $header = render('application-header', {
      title: 'wood-1001',
      summary: [{ text: 'No label here' }]
    })

    expect($header('[data-testid="application-header-field"] dt')).toHaveLength(
      0
    )
    expect(
      $header('[data-testid="application-header-field"] dd').text().trim()
    ).toBe('No label here')
  })

  test('renders a title on its own', () => {
    const $header = render('application-header', { title: 'wood-1001' })

    expect(
      $header('h1[data-testid="application-header-title"]').text().trim()
    ).toBe('wood-1001')
    expect($header('[data-testid="application-header-summary"]')).toHaveLength(
      0
    )
  })
})
