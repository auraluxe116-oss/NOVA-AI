import { jsPDF } from 'jspdf';
import type { CompanyCreationResult } from '../types/nova';

function slugFilename(raw: string): string {
  return (
    raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document-nova'
  );
}

/**
 * Generates and downloads a real PDF from Markdown/plain text with clean pagination.
 */
export function exportMarkdownToPdf(title: string, markdownContent: string, subtitle?: string): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = 56;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 54) {
      doc.addPage();
      y = 52;
    }
  };

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 35);
  const titleLines = doc.splitTextToSize(title || 'Document NOVA AI PRO', maxWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 22 + 4;

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 105, 130);
    doc.text(subtitle, margin, y);
    y += 18;
  }

  doc.setDrawColor(124, 58, 237);
  doc.setLineWidth(1.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 22;

  const lines = markdownContent.replace(/\r\n/g, '\n').split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      y += 8;
      continue;
    }

    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      ensureSpace(34);
      y += 6;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(trimmed.startsWith('# ') ? 14 : 12.5);
      doc.setTextColor(35, 30, 80);
      const heading = trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      const wrapped = doc.splitTextToSize(heading, maxWidth);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 16 + 6;
    } else if (trimmed.startsWith('### ')) {
      ensureSpace(26);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(55, 65, 110);
      const heading = trimmed.replace(/^###\s*/, '').replace(/\*\*/g, '');
      const wrapped = doc.splitTextToSize(heading, maxWidth);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 15 + 4;
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(35, 38, 48);
      const clean = trimmed
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^[-*]\s+/, '• ');
      const wrapped = doc.splitTextToSize(clean, maxWidth);
      ensureSpace(wrapped.length * 14 + 6);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 14 + 3;
    }
  }

  doc.save(`${slugFilename(title)}.pdf`);
}

/**
 * Generates and downloads a real formatted French Invoice or Quote PDF.
 */
export function exportInvoiceOrQuotePdf(params: {
  docType: 'FACTURE' | 'DEVIS';
  docNumber: string;
  issuerName: string;
  issuerSiret: string;
  clientName: string;
  itemLabel: string;
  qty: number;
  unitHt: number;
  vatRate: '0' | '20';
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const today = new Date().toLocaleDateString('fr-FR');
  const totalHt = params.qty * params.unitHt;
  const vatPct = params.vatRate === '20' ? 0.2 : 0;
  const totalVat = totalHt * vatPct;
  const totalTtc = totalHt + totalVat;

  doc.setFillColor(17, 17, 25);
  doc.rect(0, 0, pageWidth, 96, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text(params.docType, margin, 48);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(196, 181, 253);
  doc.text(`N° ${params.docNumber || '[À COMPLÉTER]'}  ·  Émis le ${today}`, margin, 68);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(params.issuerName || '[ÉMETTEUR À COMPLÉTER]', pageWidth - margin, 48, {
    align: 'right',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(200, 200, 220);
  doc.text(
    params.issuerSiret ? `SIRET : ${params.issuerSiret}` : 'SIRET : [À COMPLÉTER]',
    pageWidth - margin,
    66,
    { align: 'right' }
  );

  let y = 136;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(90, 95, 115);
  doc.text('DESTINATAIRE', margin, y);
  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(20, 22, 32);
  doc.text(params.clientName || '[NOM DU CLIENT À COMPLÉTER]', margin, y);

  y += 38;
  doc.setFillColor(244, 244, 250);
  doc.rect(margin, y, pageWidth - margin * 2, 26, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(40, 42, 60);
  doc.text('Désignation', margin + 10, y + 17);
  doc.text('Qté', pageWidth - 210, y + 17, { align: 'right' });
  doc.text('PU HT', pageWidth - 135, y + 17, { align: 'right' });
  doc.text('Total HT', pageWidth - margin - 10, y + 17, { align: 'right' });

  y += 44;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(25, 25, 35);
  const labelLines = doc.splitTextToSize(params.itemLabel || 'Prestation', 260);
  doc.text(labelLines, margin + 10, y);
  doc.text(String(params.qty), pageWidth - 210, y, { align: 'right' });
  doc.text(`${params.unitHt.toFixed(2)} €`, pageWidth - 135, y, { align: 'right' });
  doc.text(`${totalHt.toFixed(2)} €`, pageWidth - margin - 10, y, { align: 'right' });

  y += Math.max(28, labelLines.length * 16) + 12;
  doc.setDrawColor(220, 222, 234);
  doc.line(margin, y, pageWidth - margin, y);

  y += 28;
  const boxX = pageWidth - margin - 210;
  doc.setFontSize(10.5);
  doc.text('Total HT', boxX, y);
  doc.text(`${totalHt.toFixed(2)} €`, pageWidth - margin - 10, y, { align: 'right' });
  y += 20;
  doc.text(`TVA (${params.vatRate}%)`, boxX, y);
  doc.text(`${totalVat.toFixed(2)} €`, pageWidth - margin - 10, y, { align: 'right' });
  y += 24;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Total TTC', boxX, y);
  doc.text(`${totalTtc.toFixed(2)} €`, pageWidth - margin - 10, y, { align: 'right' });

  y += 54;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(95, 100, 120);
  const mention =
    params.vatRate === '0'
      ? 'TVA non applicable, article 293 B du CGI. Règlement à réception / selon conditions convenues.'
      : 'TVA 20 % applicable. Règlement sous 30 jours à compter de la date d’émission.';
  doc.text(mention, margin, y);
  doc.text('Coordonnées bancaires / IBAN : [À COMPLÉTER]', margin, y + 16);

  doc.save(`${params.docType.toLowerCase()}-${slugFilename(params.docNumber || 'nova')}.pdf`);
}

/**
 * Exports the complete Company Creation Dossier (Brand Identity + Offer + Business Plan) to PDF.
 */
export function exportCompanySuiteToPdf(suite: CompanyCreationResult): void {
  const b = suite.brandIdentity;
  const o = suite.commercialOffer;
  const p = suite.businessPlan;

  const md = [
    `# Dossier de Création d'Entreprise — ${b.brandName}`,
    '',
    `## 1. Identité de Marque`,
    `- **Nom :** ${b.brandName}`,
    `- **Slogan :** ${b.slogan}`,
    `- **Positionnement :** ${b.positioning}`,
    `- **Public cible :** ${b.targetAudience}`,
    `- **Ton éditorial :** ${b.toneOfVoice}`,
    `- **Couleurs :** Primaire ${b.colors.primary} | Secondaire ${b.colors.secondary} | Accent ${b.colors.accent}`,
    `- **Typographies :** Titres ${b.typography.displayFont} | Corps ${b.typography.bodyFont}`,
    ...b.visualGuidelines.map((g) => `- ${g}`),
    '',
    `## 2. Offre Commerciale`,
    `### ${o.headline}`,
    o.valueProposition,
    '',
    ...o.packages.flatMap((pkg) => [
      `### ${pkg.name} — ${pkg.priceLabel} (${pkg.timeline})`,
      `Cible : ${pkg.targetClient}`,
      ...pkg.deliverables.map((d) => `- ${d}`),
      '',
    ]),
    `### Pitch commercial`,
    o.salesPitch,
    '',
    `## 3. Business Plan & Stratégie d'Acquisition`,
    p.executiveSummary,
    '',
    `### Plan financier`,
    ...p.financialPlan.startupCostsEur.map((c) => `- ${c.item} : ${c.amountEur} €`),
    `- Charges fixes mensuelles estimées : ${p.financialPlan.monthlyFixedCostsEur} € / mois`,
    `- Prix unitaire moyen : ${p.financialPlan.unitPriceEur} € | Coût variable : ${p.financialPlan.unitVariableCostEur} €`,
    `- Seuil de rentabilité estimé : ${p.financialPlan.breakEvenClientsPerMonth} clients / mois`,
    `- Note de prudence : ${p.financialPlan.prudentScenarioNote}`,
    '',
    `### Stratégie marketing`,
    ...p.marketingStrategy.map((m) => `- ${m}`),
    '',
    `### Plan premiers clients — 7 jours`,
    ...p.firstClientsPlan.days7.map((d) => `- ${d}`),
    '',
    `### Plan premiers clients — 30 jours`,
    ...p.firstClientsPlan.days30.map((d) => `- ${d}`),
    '',
    `### Plan premiers clients — 90 jours`,
    ...p.firstClientsPlan.days90.map((d) => `- ${d}`),
    '',
    `### Risques identifiés`,
    ...p.keyRisks.map((r) => `- ${r}`),
  ].join('\n');

  exportMarkdownToPdf(
    `Dossier Entreprise — ${b.brandName}`,
    md,
    `Généré par NOVA AI PRO · ${new Date().toLocaleDateString('fr-FR')}`
  );
}
