import { useState } from 'react';

const styles = ['Minimal', 'Premium', 'Tech'] as const;

export function BrandLogoGenerator() {
  const [name, setName] = useState('NOVA');
  const [slogan, setSlogan] = useState('INNOVATION & BUSINESS');
  const [color, setColor] = useState('#8B5CF6');
  const [background, setBackground] = useState('#111117');
  const [style, setStyle] = useState<(typeof styles)[number]>('Tech');

  const initial = (name.trim()[0] || 'N').toUpperCase();

  const escapeXml = (value: string) =>
    value.replace(/[<>&"']/g, (char) =>
      (
        {
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&apos;',
        } as Record<string, string>
      )[char] || char
    );

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="900" height="450" viewBox="0 0 900 450">
    <rect width="900" height="450" rx="28" fill="${background}"/>
    <g transform="translate(450 145)">
      ${
        style === 'Premium'
          ? `<path d="M0 -75 L75 0 L0 75 L-75 0 Z" fill="none" stroke="${color}" stroke-width="9"/>
             <text x="0" y="20" text-anchor="middle" font-size="58" font-family="Georgia" font-weight="bold" fill="${color}">${escapeXml(initial)}</text>`
          : style === 'Minimal'
            ? `<circle r="67" fill="none" stroke="${color}" stroke-width="8"/>
               <text x="0" y="23" text-anchor="middle" font-size="76" font-family="Arial" font-weight="bold" fill="${color}">${escapeXml(initial)}</text>`
            : `<rect x="-67" y="-67" width="134" height="134" rx="28" fill="${color}"/>
               <path d="M-30 30 L0 -35 L30 30" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
               <text x="0" y="18" text-anchor="middle" font-size="48" font-family="Arial" font-weight="bold" fill="#FFFFFF">${escapeXml(initial)}</text>`
      }
    </g>
    <text x="450" y="285" text-anchor="middle" font-size="62" font-family="Arial, sans-serif" font-weight="bold" letter-spacing="3" fill="#FFFFFF">${escapeXml(name || 'VOTRE MARQUE')}</text>
    <text x="450" y="335" text-anchor="middle" font-size="20" font-family="Arial, sans-serif" letter-spacing="4" fill="${color}">${escapeXml(slogan)}</text>
  </svg>`;

  const download = (format: 'svg' | 'png') => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    if (format === 'svg') {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mon-logo.svg';
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1800;
      canvas.height = 900;
      const context = canvas.getContext('2d');

      if (context) {
        context.drawImage(image, 0, 0, 1800, 900);
        canvas.toBlob((png) => {
          if (png) {
            const pngUrl = URL.createObjectURL(png);
            const link = document.createElement('a');
            link.href = pngUrl;
            link.download = 'mon-logo.png';
            link.click();
            URL.revokeObjectURL(pngUrl);
          }
        }, 'image/png');
      }
      URL.revokeObjectURL(url);
    };

    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  };

  return (
    <section className="space-y-5 rounded-xl border border-[#232332] bg-[#111117] p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Générateur de logos</h2>
        <p className="mt-1 text-sm text-[#A8A8BE]">
          Créez et personnalisez votre identité visuelle gratuitement.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-[#C8C8DA]">
          Nom de la marque
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] p-3 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-[#C8C8DA]">
          Slogan
          <input
            value={slogan}
            onChange={(e) => setSlogan(e.target.value)}
            maxLength={45}
            className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] p-3 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-[#C8C8DA]">
          Style
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value as typeof style)}
            className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] p-3 text-sm text-white"
          >
            {styles.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs text-[#C8C8DA]">
          Couleur principale
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-11 w-full cursor-pointer rounded-lg border border-[#262638] bg-[#0B0B10] p-1"
          />
        </label>

        <label className="space-y-1 text-xs text-[#C8C8DA]">
          Couleur du fond
          <input
            type="color"
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            className="h-11 w-full cursor-pointer rounded-lg border border-[#262638] bg-[#0B0B10] p-1"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#303044]">
        <svg
          viewBox="0 0 900 450"
          className="block w-full"
          role="img"
          aria-label={`Aperçu du logo ${name}`}
          dangerouslySetInnerHTML={{
            __html: svg.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/, ''),
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => download('png')}
          className="rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9]"
        >
          Télécharger PNG
        </button>
        <button
          type="button"
          onClick={() => download('svg')}
          className="rounded-lg border border-[#39394D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#20202C]"
        >
          Télécharger SVG
        </button>
      </div>
    </section>
  );
}
