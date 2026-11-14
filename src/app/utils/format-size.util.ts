/** "1,1 GB" / "850 MB", in the interface's language. */
export function formatSize(bytes: number, lang = 'pt'): string {
  const gb = bytes / 1e9;
  const fmt = (n: number, digits: number) =>
    new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
  if (gb >= 1) return `${fmt(gb, 1)} GB`;
  return `${fmt(Math.max(1, Math.round(bytes / 1e6)), 0)} MB`;
}

/** Room left free on top of a download, so the device is never filled to the brim. */
export const SPACE_MARGIN_BYTES = 300e6;
