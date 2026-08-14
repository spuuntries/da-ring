export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')        // Replace spaces with -
    .replace(/[^\w\-]+/g, '')    // Remove all non-word chars
    .replace(/\-\-+/g, '-')      // Replace multiple - with single -
    .replace(/^-+/, '')          // Trim - from start of text
    .replace(/-+$/, '')          // Trim - from end of text
}

export function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '')
}

export function urlMatch(a: string, b: string): boolean {
  try {
    const uA = new URL(a)
    const uB = new URL(b)
    return uA.hostname === uB.hostname
  } catch {
    return normalizeUrl(a) === normalizeUrl(b)
  }
}
