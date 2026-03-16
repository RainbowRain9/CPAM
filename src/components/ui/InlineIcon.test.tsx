import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InlineIcon } from './InlineIcon'

describe('InlineIcon', () => {
  it('renders newly supported download and upload icons', () => {
    const { container: download } = render(<InlineIcon name="download" />)
    const { container: upload } = render(<InlineIcon name="upload" />)

    expect(download.querySelectorAll('path')).toHaveLength(2)
    expect(upload.querySelectorAll('path')).toHaveLength(2)
  })
})
