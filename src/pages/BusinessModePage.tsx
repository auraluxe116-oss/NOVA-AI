import {
  Briefcase,
  Calculator,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  Globe,
  Loader2,
  Lock,
  MessageSquare,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import type {
  BusinessProject,
  ExperienceLevel,
  PageView,
  PublicUser,
  QuotaSnapshot,
  SourceLink,
} from '../types/nova';
import {
  ApiError,
  deleteBusinessProjectApi,
  fetchBusinessProjects,
  streamBusinessGeneration,
} from '../utils/api';

interface BusinessModePageProps {
  user: PublicUser | null;
  quota: QuotaSnapshot | null;
  initialProjectId?: string | null;
  onClearInitialProject?: () => void;
  onLaunchPrompt?: (prompt: string) => void;
  onQuotaUpdated: (q: QuotaSnapshot) => void;
  onNavigate: (view: PageView) => void;
}

interface BusinessModuleItem {
  key: string;
  label: string;
  tier: 'free' | 'pro' | 'business';
  summary: string;
}

const BUSINESS_MODULES: BusinessModuleItem[] = [
  {
    key: 'business_ideas',
    label: 'Idées de business',
    tier: 'free',
    summary: 'Concepts réalistes adaptés à vos compétences et au marché.',
  },
  {
    key: 'zero_budget',
    label: 'Démarrer à 0 €',
    tier: 'free',
    summary: 'Lancement sans capital grâce aux outils gratuits et à la prospection directe.',
  },
  {
    key: 'find_clients',
    label: 'Trouver des clients',
    tier: 'free',
    summary: 'Canaux d’acquisition directs, offres d’appel et scripts de prise de contact.',
  },
  {
    key: 'marketing_strategy',
    label: 'Stratégie marketing',
    tier: 'free',
    summary: 'Positionnement, canaux prioritaires et messages de conversion.',
  },
  {
    key: 'brand_creation',
    label: 'Création de marque',
    tier: 'free',
    summary: 'Proposition de valeur, identité verbale et différenciation claire.',
  },
  {
    key: 'costs_margins',
    label: 'Coûts & marges',
    tier: 'free',
    summary: 'Analyse de rentabilité unitaire, tarification et seuil de rentabilité.',
  },
  {
    key: 'low_budget_growth',
    label: 'Croissance petit budget',
    tier: 'free',
    summary: 'Acquisition organique, partenariats et réinvestissement progressif.',
  },
  {
    key: 'action_plan',
    label: "Plan d'action concret",
    tier: 'free',
    summary: 'Feuille de route opérationnelle semaine par semaine.',
  },
  {
    key: 'commercial_proposal',
    label: 'Propositions commerciales',
    tier: 'free',
    summary: 'Devis détaillés, structuration de l’offre et argumentaire client.',
  },
  {
    key: 'invoice_billing',
    label: 'Factures & relances',
    tier: 'free',
    summary: 'Modèles conformes avec mentions légales, conditions et relances.',
  },
  {
    key: 'professional_texts',
    label: 'Textes professionnels',
    tier: 'free',
    summary: 'Emails B2B, pages de présentation et courriers commerciaux soignés.',
  },
  {
    key: 'business_plan',
    label: 'Business Plan complet',
    tier: 'pro',
    summary: 'Document structuré pour cadrer votre lancement ou convaincre un partenaire.',
  },
  {
    key: 'ecommerce_store',
    label: 'Boutique en ligne',
    tier: 'pro',
    summary: 'Catalogue, logistique, acquisition et parcours panier e-commerce.',
  },
  {
    key: 'competitor_analysis',
    label: 'Analyse concurrence',
    tier: 'pro',
    summary: 'Cartographie des acteurs en place et positionnement gagnant.',
  },
  {
    key: 'sales_strategy',
    label: 'Stratégie de vente',
    tier: 'pro',
    summary: 'Offre structurée, traitement des objections et closing.',
  },
  {
    key: 'company_creation',
    label: "Création d'entreprise",
    tier: 'business',
    summary: "Étude de marché approfondie, plan de développement et stratégie commerciale.",
  },
];

const BUDGET_PRESETS = [0, 500, 2500, 10000];

export function BusinessModePage({
  user,
  quota,
  initialProjectId,
  onClearInitialProject,
  onLaunchPrompt,
  onQuotaUpdated,
  onNavigate,
}: BusinessModePageProps) {
  const [selectedModule, setSelectedModule] = useState<string>('business_ideas');
  const [title, setTitle] = useState('');
  const [sector, setSector] = useState('');
  const [budgetEur, setBudgetEur] = useState('0');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('debutant');
  const [goal, setGoal] = useState('');
  const [contextDetails, setContextDetails] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(false);

  const [streamingContent, setStreamingContent] = useState('');
  const [sources, setSources] = useState<SourceLink[]>([]);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [savedProjects, setSavedProjects] = useState<BusinessProject[]>([]);

  // Utility tool switcher: Unit Economics vs Quick Invoice/Quote generator
  const [activeToolTab, setActiveToolTab] = useState<'calculator' | 'invoice'>('calculator');

  // Interactive Unit Economics / Margin Calculator state
  const [unitPrice, setUnitPrice] = useState('79');
  const [unitCost, setUnitCost] = useState('22');
  const [cacCost, setCacCost] = useState('14');
  const [fixedCosts, setFixedCosts] = useState('450');
  const [monthlyUnits, setMonthlyUnits] = useState('35');

  // Interactive Invoice / Quote Generator state
  const [docType, setDocType] = useState<'FACTURE' | 'DEVIS'>('FACTURE');
  const [docNumber, setDocNumber] = useState('FAC-2026-001');
  const [issuerName, setIssuerName] = useState(user?.companyName || user?.displayName || '');
  const [issuerSiret, setIssuerSiret] = useState('');
  const [clientName, setClientName] = useState('');
  const [itemLabel, setItemLabel] = useState('Prestation de conseil stratégique');
  const [itemQty, setItemQty] = useState('1');
  const [itemPriceHt, setItemPriceHt] = useState('950');
  const [vatRate, setVatRate] = useState<'0' | '20'>('0');
  const [invoiceCopied, setInvoiceCopied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const userPlan = user?.effectivePlan ?? 'free';

  const loadProjects = async () => {
    if (!user) {
      setSavedProjects([]);
      return;
    }
    try {
      const data = await fetchBusinessProjects();
      setSavedProjects(data.projects);
      if (initialProjectId) {
        const match = data.projects.find((p) => p.id === initialProjectId);
        if (match) {
          setSelectedModule(match.module_key);
          setTitle(match.title);
          setSector(match.sector);
          setBudgetEur(String(match.budget_eur));
          setGoal(match.goal);
          setStreamingContent(match.content_markdown);
        }
        onClearInitialProject?.();
      }
    } catch {
      // ignore non-blocking fetch
    }
  };

  useEffect(() => {
    void loadProjects();
  }, [user?.id, initialProjectId]);

  const moduleMeta = BUSINESS_MODULES.find((m) => m.key === selectedModule) ?? BUSINESS_MODULES[0];
  const isLocked =
    (moduleMeta.tier === 'pro' && userPlan === 'free') ||
    (moduleMeta.tier === 'business' && userPlan !== 'business');

  // Calculator real math
  const p = Math.max(0, Number(unitPrice) || 0);
  const c = Math.max(0, Number(unitCost) || 0);
  const cac = Math.max(0, Number(cacCost) || 0);
  const fixed = Math.max(0, Number(fixedCosts) || 0);
  const units = Math.max(0, Math.round(Number(monthlyUnits) || 0));

  const unitContribution = p - c - cac;
  const marginPct = p > 0 ? (unitContribution / p) * 100 : 0;
  const breakEvenUnits = unitContribution > 0 ? Math.ceil(fixed / unitContribution) : null;
  const monthlyRevenue = p * units;
  const monthlyOperatingResult = unitContribution * units - fixed;

  // Invoice real math
  const qty = Math.max(1, Number(itemQty) || 1);
  const unitHt = Math.max(0, Number(itemPriceHt) || 0);
  const totalHt = qty * unitHt;
  const vatPct = vatRate === '20' ? 0.2 : 0;
  const totalVat = totalHt * vatPct;
  const totalTtc = totalHt + totalVat;

  const runGeneration = async () => {
    if (isGenerating || isLocked) return;

    setErrorMessage(null);
    setStreamingContent('');
    setSources([]);
    setIsGenerating(true);
    setStatusLabel('NOVA structure votre projet en 7 étapes...');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamBusinessGeneration({
        moduleKey: selectedModule,
        title: title.trim(),
        sector: sector.trim(),
        budgetEur: Math.max(0, Number(budgetEur) || 0),
        goal: goal.trim(),
        experienceLevel,
        contextDetails: contextDetails.trim(),
        useWebSearch,
        signal: controller.signal,
        onStatus: (label) => setStatusLabel(label),
        onDelta: (delta) => {
          setStatusLabel(null);
          setStreamingContent((prev) => prev + delta);
        },
        onSources: (s) => setSources(s),
        onDone: (payload) => {
          if (payload.quota) onQuotaUpdated(payload.quota);
          if (payload.project) {
            setSavedProjects((prev) => [payload.project!, ...prev]);
          }
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatusLabel(null);
      } else {
        const msg =
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Impossible de générer le projet business.';
        setErrorMessage(msg);
      }
    } finally {
      setIsGenerating(false);
      setStatusLabel(null);
      abortRef.current = null;
    }
  };

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    await runGeneration();
  };

  const handleCopyOutput = () => {
    if (!streamingContent) return;
    void navigator.clipboard.writeText(streamingContent);
    setCopiedOutput(true);
    setTimeout(() => setCopiedOutput(false), 1800);
  };

  const handleExportMarkdown = () => {
    if (!streamingContent) return;
    const blob = new Blob([streamingContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'projet-nova-business').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildInvoiceText = () => {
    const today = new Date().toLocaleDateString('fr-FR');
    const legalMention =
      vatRate === '0'
        ? 'TVA non applicable, art. 293 B du CGI.'
        : 'TVA 20 % incluse — Règlement à 30 jours date d’émission.';
    return [
      `${docType} N° ${docNumber || '2026-001'}`,
      `Date d'émission : ${today}`,
      '',
      `Émetteur : ${issuerName || '[Nom / Entreprise]'}${issuerSiret ? ` (SIRET : ${issuerSiret})` : ''}`,
      `Client : ${clientName || '[Nom du client / Société]'}`,
      '',
      `Désignation : ${itemLabel || 'Prestation'}`,
      `Quantité : ${qty} × ${unitHt.toFixed(2)} € HT`,
      `Total HT : ${totalHt.toFixed(2)} €`,
      `TVA (${vatRate}%) : ${totalVat.toFixed(2)} €`,
      `Total TTC à payer : ${totalTtc.toFixed(2)} €`,
      '',
      legalMention,
    ].join('\n');
  };

  const handleCopyInvoice = () => {
    void navigator.clipboard.writeText(buildInvoiceText());
    setInvoiceCopied(true);
    setTimeout(() => setInvoiceCopied(false), 1800);
  };

  const handleDownloadInvoiceHtml = () => {
    const today = new Date().toLocaleDateString('fr-FR');
    const legalMention =
      vatRate === '0'
        ? 'TVA non applicable, art. 293 B du CGI.'
        : 'TVA 20 % — Règlement à réception / 30 jours.';
    const safe = (v: string) =>
      v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>${safe(docType)} ${safe(docNumber)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 24px;color:#111}
h1{font-size:24px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:24px 0}
th,td{border-bottom:1px solid #ddd;padding:10px 8px;text-align:left}
.num{text-align:right;font-variant-numeric:tabular-nums}.totals{margin-left:auto;width:280px}
.muted{color:#555;font-size:13px}</style></head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:16px">
  <div><h1>${safe(docType)}</h1><p class="muted">N° ${safe(docNumber)} · Émis le ${today}</p></div>
  <div style="text-align:right"><strong>${safe(issuerName || 'Émetteur')}</strong>${
    issuerSiret ? `<br><span class="muted">SIRET : ${safe(issuerSiret)}</span>` : ''
  }</div>
</div>
<p style="margin-top:20px"><strong>Client :</strong> ${safe(clientName || 'Client')}</p>
<table>
  <thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU HT</th><th class="num">Total HT</th></tr></thead>
  <tbody><tr><td>${safe(itemLabel)}</td><td class="num">${qty}</td><td class="num">${unitHt.toFixed(2)} €</td><td class="num">${totalHt.toFixed(2)} €</td></tr></tbody>
</table>
<table class="totals">
  <tr><td>Total HT</td><td class="num">${totalHt.toFixed(2)} €</td></tr>
  <tr><td>TVA (${vatRate}%)</td><td class="num">${totalVat.toFixed(2)} €</td></tr>
  <tr><th>Total TTC</th><th class="num">${totalTtc.toFixed(2)} €</th></tr>
</table>
<p class="muted">${legalMention}</p>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docType.toLowerCase()}-${(docNumber || 'document').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteBusinessProjectApi(id);
      setSavedProjects((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // ignore
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-[#1F1F2D] pb-6">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A78BFA]">
            Espace entrepreneurial structuré
          </p>
          <h1 className="font-display text-3xl font-bold text-[#FAFAFA]">
            Mode Business NOVA AI
          </h1>
          <p className="max-w-2xl text-sm text-[#A8A8BE]">
            Chaque projet est adapté à votre budget et à votre niveau, avec les 7 volets
            essentiels : objectif, budget, outils, étapes, risques, revenus réalistes et plan
            d&apos;action concret.
          </p>
        </div>

        {quota && (
          <div className="rounded-lg border border-[#232332] bg-[#111117] px-4 py-2.5 text-xs">
            <span className="text-[#9E9EB5]">Analyses restantes aujourd&apos;hui : </span>
            <span className="font-mono font-semibold tabular-nums text-white">
              {quota.businessRemaining}/{quota.businessLimit}
            </span>
          </div>
        )}
      </div>

      {/* Module Selector Grid */}
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
          1. Choisissez votre module stratégique ou document commercial
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {BUSINESS_MODULES.map((mod) => {
            const active = selectedModule === mod.key;
            const locked =
              (mod.tier === 'pro' && userPlan === 'free') ||
              (mod.tier === 'business' && userPlan !== 'business');

            return (
              <button
                key={mod.key}
                type="button"
                onClick={() => setSelectedModule(mod.key)}
                className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-colors ${
                  active
                    ? 'border-[#7C3AED] bg-[#17132A]'
                    : 'border-[#232332] bg-[#111117] hover:border-[#37374F]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white">{mod.label}</span>
                  {locked ? (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-[#A78BFA]" />
                  ) : (
                    <span className="font-mono text-[10px] uppercase text-[#9E9EB5]">
                      {mod.tier}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-xs leading-snug text-[#A6A6BC]">{mod.summary}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Split: Form + Tools (left) & 7-Part Structured Output (right) */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column */}
        <div className="space-y-6 lg:col-span-5">
          <form
            onSubmit={handleGenerate}
            className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-white">
                {moduleMeta.label}
              </h2>
              <span className="font-mono text-xs text-[#A78BFA] uppercase">
                {moduleMeta.tier}
              </span>
            </div>

            {isLocked && (
              <div className="rounded-lg border border-[#7C3AED]/50 bg-[#7C3AED]/10 p-3.5 text-xs text-[#E4DBFF] space-y-2">
                <p>
                  Ce module est inclus dans la formule{' '}
                  <strong>{moduleMeta.tier.toUpperCase()}</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('tarifs')}
                  className="rounded-md bg-[#7C3AED] px-3 py-1.5 font-semibold text-white hover:bg-[#6D28D9]"
                >
                  Découvrir la formule {moduleMeta.tier.toUpperCase()}
                </button>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#C8C8DA]">
                Nom du projet ou document
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex. Proposition refonte e-commerce ou Agence SEO locale"
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2.5 text-sm text-white placeholder-[#6F6F87] focus:border-[#7C3AED] focus:outline-none"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#C8C8DA]">
                  Secteur d&apos;activité
                </label>
                <input
                  type="text"
                  required
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  placeholder="Ex. E-commerce, SaaS, B2B"
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2.5 text-sm text-white placeholder-[#6F6F87] focus:border-[#7C3AED] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#C8C8DA]">
                  Budget disponible (€)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={budgetEur}
                  onChange={(e) => setBudgetEur(e.target.value)}
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2.5 font-mono text-sm tabular-nums text-white focus:border-[#7C3AED] focus:outline-none"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {BUDGET_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBudgetEur(String(preset))}
                      className={`rounded px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors ${
                        Number(budgetEur) === preset
                          ? 'bg-[#7C3AED] text-white'
                          : 'bg-[#0B0B10] text-[#9E9EB5] hover:text-white'
                      }`}
                    >
                      {preset} €
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* User Level Adaptation */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#C8C8DA]">
                Votre niveau d&apos;expérience
              </label>
              <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-[#262638] bg-[#0B0B10] p-1">
                {(
                  [
                    { id: 'debutant', label: 'Débutant' },
                    { id: 'intermediaire', label: 'Intermédiaire' },
                    { id: 'confirme', label: 'Confirmé' },
                  ] as const
                ).map((lvl) => (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => setExperienceLevel(lvl.id)}
                    className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                      experienceLevel === lvl.id
                        ? 'bg-[#7C3AED] text-white'
                        : 'text-[#A6A6BC] hover:text-white'
                    }`}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#C8C8DA]">
                Objectif principal
              </label>
              <input
                type="text"
                required
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Ex. Signer 3 clients pilotes en 45 jours ou facturer une mission"
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2.5 text-sm text-white placeholder-[#6F6F87] focus:border-[#7C3AED] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#C8C8DA]">
                Précisions (cible, zone, contraintes) — optionnel
              </label>
              <textarea
                rows={3}
                value={contextDetails}
                onChange={(e) => setContextDetails(e.target.value)}
                placeholder="Ex. Clientèle locale en France, 10h/semaine disponibles au démarrage."
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2 text-sm text-white placeholder-[#6F6F87] focus:border-[#7C3AED] focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-[#C8C8DA]">
              <input
                type="checkbox"
                checked={useWebSearch}
                onChange={(e) => setUseWebSearch(e.target.checked)}
                className="h-4 w-4 rounded border-[#32324A] bg-[#0B0B10] accent-[#7C3AED]"
              />
              <Globe className="h-3.5 w-3.5 text-[#A78BFA]" />
              Inclure une recherche web en direct avec sources
            </label>

            {errorMessage && (
              <div className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
                <p>{errorMessage}</p>
                {!isGenerating && (
                  <button
                    type="button"
                    onClick={() => void runGeneration()}
                    className="inline-flex items-center gap-1.5 rounded border border-red-500/40 bg-red-500/15 px-2.5 py-1 font-medium text-red-100 hover:bg-red-500/25"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Réessayer
                  </button>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isGenerating || isLocked}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-45 transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                {isGenerating ? 'Génération en cours...' : 'Générer en 7 étapes'}
              </button>
              {isGenerating && (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  aria-label="Arrêter la génération"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#32324A] bg-[#1A1A26] px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-[#252538]"
                >
                  <Square className="h-3.5 w-3.5" />
                  Arrêter
                </button>
              )}
            </div>
          </form>

          {/* Interactive Tool Card: Margin Calculator & Quick Invoice Builder */}
          <div className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-4">
            <div className="flex items-center gap-1 rounded-lg border border-[#232332] bg-[#0B0B10] p-1">
              <button
                type="button"
                onClick={() => setActiveToolTab('calculator')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  activeToolTab === 'calculator'
                    ? 'bg-[#1A1A26] text-white'
                    : 'text-[#9E9EB5] hover:text-white'
                }`}
              >
                <Calculator className="h-3.5 w-3.5 text-[#A78BFA]" />
                Coûts &amp; Marges
              </button>
              <button
                type="button"
                onClick={() => setActiveToolTab('invoice')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  activeToolTab === 'invoice'
                    ? 'bg-[#1A1A26] text-white'
                    : 'text-[#9E9EB5] hover:text-white'
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[#A78BFA]" />
                Facture / Devis
              </button>
            </div>

            {activeToolTab === 'calculator' ? (
              <>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">Prix de vente HT (€)</label>
                    <input
                      type="number"
                      min={0}
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono tabular-nums text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">Coût variable unitaire (€)</label>
                    <input
                      type="number"
                      min={0}
                      value={unitCost}
                      onChange={(e) => setUnitCost(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono tabular-nums text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">Acquisition client (€)</label>
                    <input
                      type="number"
                      min={0}
                      value={cacCost}
                      onChange={(e) => setCacCost(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono tabular-nums text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">Charges fixes / mois (€)</label>
                    <input
                      type="number"
                      min={0}
                      value={fixedCosts}
                      onChange={(e) => setFixedCosts(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono tabular-nums text-white"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-1 block text-[#9E9EB5]">Ventes mensuelles simulées</label>
                    <input
                      type="number"
                      min={0}
                      value={monthlyUnits}
                      onChange={(e) => setMonthlyUnits(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono tabular-nums text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 border-t border-[#232332] pt-3 text-xs">
                  <div className="rounded-lg bg-[#0B0B10] p-2.5">
                    <p className="text-[#8D8DA4]">Marge / vente</p>
                    <p
                      className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                        unitContribution >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {unitContribution.toFixed(2)} € ({marginPct.toFixed(1)}%)
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#0B0B10] p-2.5">
                    <p className="text-[#8D8DA4]">Seuil de rentabilité</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-white">
                      {breakEvenUnits !== null ? `${breakEvenUnits} ventes/mois` : 'Non rentable'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#0B0B10] p-2.5">
                    <p className="text-[#8D8DA4]">CA mensuel simulé</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-white">
                      {monthlyRevenue.toFixed(0)} €
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#0B0B10] p-2.5">
                    <p className="text-[#8D8DA4]">Résultat estimé</p>
                    <p
                      className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                        monthlyOperatingResult >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {monthlyOperatingResult.toFixed(0)} €
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">Type</label>
                    <select
                      value={docType}
                      onChange={(e) => setDocType(e.target.value as 'FACTURE' | 'DEVIS')}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                    >
                      <option value="FACTURE">Facture</option>
                      <option value="DEVIS">Devis</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">Numéro</label>
                    <input
                      type="text"
                      value={docNumber}
                      onChange={(e) => setDocNumber(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">Émetteur</label>
                    <input
                      type="text"
                      value={issuerName}
                      onChange={(e) => setIssuerName(e.target.value)}
                      placeholder="Votre société"
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">SIRET (optionnel)</label>
                    <input
                      type="text"
                      value={issuerSiret}
                      onChange={(e) => setIssuerSiret(e.target.value)}
                      placeholder="123 456 789 00010"
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-1 block text-[#9E9EB5]">Client destinataire</label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Nom du client ou entreprise"
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-1 block text-[#9E9EB5]">Désignation prestation</label>
                    <input
                      type="text"
                      value={itemLabel}
                      onChange={(e) => setItemLabel(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">Quantité</label>
                    <input
                      type="number"
                      min={1}
                      value={itemQty}
                      onChange={(e) => setItemQty(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono tabular-nums text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#9E9EB5]">Prix unitaire HT (€)</label>
                    <input
                      type="number"
                      min={0}
                      value={itemPriceHt}
                      onChange={(e) => setItemPriceHt(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono tabular-nums text-white"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-1 block text-[#9E9EB5]">Régime TVA</label>
                    <select
                      value={vatRate}
                      onChange={(e) => setVatRate(e.target.value as '0' | '20')}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                    >
                      <option value="0">0 % — Franchise en base (art. 293 B du CGI)</option>
                      <option value="20">20 % — TVA normale</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-[#0B0B10] p-3 border border-[#1E1E2B]">
                  <div>
                    <p className="text-[#8D8DA4]">Total TTC</p>
                    <p className="font-mono text-base font-bold tabular-nums text-white">
                      {totalTtc.toFixed(2)} €
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleCopyInvoice}
                      className="inline-flex items-center gap-1 rounded-md border border-[#2C2C40] bg-[#171722] px-2.5 py-1.5 font-medium text-white hover:border-[#7C3AED]"
                    >
                      {invoiceCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {invoiceCopied ? 'Copié' : 'Copier'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadInvoiceHtml}
                      className="inline-flex items-center gap-1 rounded-md bg-[#7C3AED] px-2.5 py-1.5 font-semibold text-white hover:bg-[#6D28D9]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      HTML/PDF
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Structured 7-Section Output + Saved Projects */}
        <div className="space-y-6 lg:col-span-7">
          <div className="min-h-[480px] rounded-xl border border-[#232332] bg-[#0E0E14] p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#1F1F2D] pb-3">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-[#A78BFA]" />
                <span className="font-display text-sm font-semibold text-white">
                  Synthèse stratégique en 7 volets
                </span>
              </div>
              {streamingContent && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyOutput}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#262638] bg-[#14141D] px-2.5 py-1.5 text-xs font-medium text-[#E0E0EE] hover:border-[#7C3AED]"
                  >
                    {copiedOutput ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedOutput ? 'Copié' : 'Copier'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportMarkdown}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#262638] bg-[#14141D] px-2.5 py-1.5 text-xs font-medium text-[#E0E0EE] hover:border-[#7C3AED]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Exporter (.md)
                  </button>
                  {onLaunchPrompt && !isGenerating && (
                    <button
                      type="button"
                      onClick={() =>
                        onLaunchPrompt(
                          `Voici mon projet "${title}" (${sector}, budget ${budgetEur} €) :\n\n${streamingContent.slice(
                            0,
                            3500
                          )}\n\nAide-moi à passer à l'action concrètement dès aujourd'hui.`
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#7C3AED]/20 border border-[#7C3AED]/50 px-2.5 py-1.5 text-xs font-medium text-[#DDD6FE] hover:bg-[#7C3AED]/30"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Approfondir en chat
                    </button>
                  )}
                </div>
              )}
            </div>

            {statusLabel && !streamingContent ? (
              <div className="flex items-center gap-2.5 py-16 text-sm text-[#C4B5FD]">
                <Loader2 className="h-4 w-4 animate-spin text-[#8B5CF6]" />
                <span>{statusLabel}</span>
              </div>
            ) : streamingContent ? (
              <MarkdownRenderer content={streamingContent} sources={sources} />
            ) : (
              <div className="py-12 space-y-4 text-sm text-[#9E9EB5]">
                <p className="font-medium text-[#D8D8E6]">
                  Remplissez les paramètres à gauche pour générer un cadrage complet :
                </p>
                <ol className="ml-5 list-decimal space-y-1.5 text-xs leading-relaxed">
                  <li>L&apos;objectif précis du projet</li>
                  <li>Le budget nécessaire (avec alternatives 0 € si applicable)</li>
                  <li>Les outils nécessaires adaptés à votre niveau</li>
                  <li>Les étapes de réalisation chronologiques</li>
                  <li>Les risques identifiés et comment les réduire</li>
                  <li>Les possibilités de revenus réalistes (sans promesse garantie)</li>
                  <li>Un plan d&apos;action concret ou modèle commercial prêt à l&apos;emploi</li>
                </ol>
              </div>
            )}
          </div>

          {user && savedProjects.length > 0 && (
            <div className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <h3 className="mb-3 font-display text-base font-semibold text-white">
                Vos projets business enregistrés ({savedProjects.length})
              </h3>
              <div className="divide-y divide-[#1E1E2B]">
                {savedProjects.map((proj) => (
                  <div
                    key={proj.id}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedModule(proj.module_key);
                        setTitle(proj.title);
                        setSector(proj.sector);
                        setBudgetEur(String(proj.budget_eur));
                        setGoal(proj.goal);
                        setStreamingContent(proj.content_markdown);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate font-medium text-[#FAFAFA] hover:text-[#C4B5FD]">
                        {proj.title}
                      </p>
                      <p className="text-xs text-[#8D8DA4]">
                        {proj.sector} · Budget{' '}
                        <span className="font-mono tabular-nums">{proj.budget_eur} €</span>
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteProject(proj.id)}
                      aria-label="Supprimer le projet"
                      className="p-1.5 text-[#7D7D96] hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
