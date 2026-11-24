import { getFontEmbedCSS, toBlob } from 'html-to-image'

let fontCSS: Promise<string> | null = null

/** PNG of a 1080×1920 story node (rendered off-screen at full size). */
export async function storyPng(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready
  // Embedding the fonts is the slow part; do it once per page load.
  fontCSS ??= getFontEmbedCSS(node)
  const blob = await toBlob(node, { pixelRatio: 1, width: 1080, height: 1920, fontEmbedCSS: await fontCSS })
  if (!blob) throw new Error('Could not render the image')
  return blob
}

export function fileName(tournament: string, story: string) {
  const slug = `${tournament}-${story}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${slug || 'wsf-story'}.png`
}

/** Tablets and phones: the share sheet (Instagram, Photos…). Elsewhere: download the files. Must run
 *  straight from a tap, so the PNGs are rendered beforehand. */
export async function shareOrDownload(files: File[], title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      throw e
    }
  }
  for (const f of files) {
    const url = URL.createObjectURL(f)
    const a = Object.assign(document.createElement('a'), { href: url, download: f.name })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return 'downloaded'
}
