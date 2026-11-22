// Opens or downloads a file a bot wrote. Images are stored as data URLs; everything else is
// downloaded/opened as plain text, so an HTML file written by a bot never runs with access to your keys.
export function openArtifactFile(a, download = false) {
  let blob;
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(a.content);
  if (m && m[1].startsWith('image/')) {
    const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
    blob = new Blob([bytes], { type: download ? m[1] : 'text/plain' });
    download = true; // never open bot-made SVG as a page
  } else blob = new Blob([a.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  if (download) link.download = a.name; else link.target = '_blank';
  link.rel = 'noopener';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
