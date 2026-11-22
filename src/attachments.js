// Reads files you attach to a message. Images and PDFs are sent to the model as files;
// text files (txt, md, csv, json, code…) are pasted into the message as text.
export const MAX_FILES = 5;
const MAX_BINARY = 8 * 1024 * 1024; // 8 MB per image/PDF
const MAX_TEXT = 200_000; // characters per text file

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|cs|php|sql|ya?ml|toml|ini|env|log|sh|bat|ps1|srt|vtt)$/i;

const readAs = (file, how) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r[how](file);
});

export async function readAttachment(file) {
  const base = { name: file.name || 'archivo', size: file.size, mime: file.type || '' };
  if (file.type.startsWith('image/')) {
    if (file.size > MAX_BINARY) throw new Error(`${file.name}: la imagen pesa más de 8 MB`);
    return { ...base, kind: 'image', dataUrl: await readAs(file, 'readAsDataURL') };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_BINARY) throw new Error(`${file.name}: el PDF pesa más de 8 MB`);
    return { ...base, kind: 'pdf', mime: 'application/pdf', dataUrl: await readAs(file, 'readAsDataURL') };
  }
  if (file.type.startsWith('text/') || TEXT_EXT.test(file.name) || file.type === 'application/json') {
    const text = await readAs(file, 'readAsText');
    return { ...base, kind: 'text', text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(recortado)` : text };
  }
  throw new Error(`${file.name}: este tipo de archivo no se puede adjuntar (usa imágenes, PDF o archivos de texto)`);
}

// Text files go inside the message; images/PDFs travel as attachments (text files keep only their name).
export function packMessage(text, attachments) {
  const textFiles = attachments.filter((a) => a.kind === 'text');
  const body = [text, ...textFiles.map((a) => `[Archivo adjunto: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\``)].filter(Boolean).join('\n\n');
  const files = attachments.map(({ text: _t, ...a }) => a);
  return { body, files };
}
