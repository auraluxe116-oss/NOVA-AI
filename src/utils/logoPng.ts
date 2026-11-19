export type LogoBackdrop = 'transparent' | 'dark' | 'light';

/**
 * Converts a vector SVG logo into a real high-resolution 1024x1024 PNG image (data URL)
 * using an HTML5 Canvas so it can be previewed as an actual PNG <img> and downloaded as .png.
 */
export async function renderSvgLogoToPng(
  svgMarkup: string,
  backdrop: LogoBackdrop = 'transparent',
  size = 1024
): Promise<string> {
  if (!svgMarkup || !svgMarkup.includes('<svg')) {
    throw new Error('Aucun logo SVG valide à convertir en PNG.');
  }

  const sanitized = svgMarkup
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*(['"])[\s\S]*?\1/gi, '');

  const svgBlob = new Blob([sanitized], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Impossible de charger le logo vectoriel.'));
      image.src = blobUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Contexte Canvas 2D indisponible.');
    }

    if (backdrop === 'dark') {
      ctx.fillStyle = '#08080B';
      ctx.fillRect(0, 0, size, size);
    } else if (backdrop === 'light') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, size);
    } else {
      ctx.clearRect(0, 0, size, size);
    }

    const pad = Math.round(size * 0.08);
    ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);

    const pngDataUrl = canvas.toDataURL('image/png');
    if (!pngDataUrl.startsWith('data:image/png')) {
      throw new Error('La conversion en image PNG a échoué.');
    }
    return pngDataUrl;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

export function downloadTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
