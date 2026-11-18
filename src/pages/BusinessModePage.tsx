import {
  Briefcase,
  Calculator,
  Download,
  Globe,
  Lock,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import type {
  BusinessProject,
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
    key: 'business_plan',
    label: 'Business Plan complet',
    tier: 'pro',
    summary: 'Document structuré pour structurer votre lancement ou convaincre un partenaire.',
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
    summary: 'Offre irrésistible, traitement des objections et closing.',
  },
  {
    key: 'company_creation',
    label: "Création d'entreprise",
    tier: 'business',
    summary: "Étude de marché approfondie, plan de développement et stratégie commerciale.",
  },
];

export function BusinessModePage({
  user,
  quota,
  onQuotaUpdated,
  onNavigate,
}: BusinessModePageProps) {
  const [selectedModule, setSelectedModule] = useState<string>('business_ideas');
  const [title, setTitle] = useState('');
  const [sector, setSector] = useState('');
  const [budgetEur, setBudgetEur] = useState('0');
  const [goal, setGoal] = useState('');
  const [contextDetails, setContextDetails] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(false);

  const [streamingContent, setStreamingContent] = useState('');
  const [sources, setSources] = useState<SourceLink[]>([]);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedProjects, setSavedProjects] = useState<BusinessProject[]>([]);

  // Interactive Unit Economics / Margin Calculator state
  const [unitPrice, setUnitPrice] = useState('79');
  const [unitCost, setUnitCost] = useState('22');
  const [cacCost, setCacCost] = useState('14');
  const [fixedCosts, setFixedCosts] = useState('450');
  const [monthlyUnits, setMonthlyUnits] = useState('35');

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
    } catch {
      // ignore non-blocking fetch
    }
  };

  useEffect(() => {
    void loadProjects();
  }, [user?.id]);

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

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
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
      const msg =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible de générer le projet business.';
      setErrorMessage(msg);
    } finally {
      setIsGenerating(false);
      setStatusLabel(null);
      abortRef.current = null;
    }
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
            Chaque projet génère obligatoirement les 7 volets essentiels : objectif, budget,
            outils, étapes, risques, possibilités de revenus réalistes (sans promesse
            irréaliste) et plan d&apos;action concret.
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
          1. Choisissez votre module stratégique
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

      {/* Main Split: Form + Calculator (left) & 7-Part Structured Output (right) */}
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
                Nom ou idée du projet
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex. Agence de création de sites pour artisans"
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
                placeholder="Ex. Valider l'offre et signer 3 clients pilotes en 45 jours"
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
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isGenerating || isLocked}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-45 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              {isGenerating ? 'Génération en cours...' : 'Générer le plan en 7 étapes'}
            </button>
          </form>

          {/* Interactive Unit Economics & Margin Calculator */}
          <div className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-[#A78BFA]" />
              <h3 className="font-display text-base font-semibold text-white">
                Calculateur Coûts &amp; Marges
              </h3>
            </div>

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
          </div>
        </div>

        {/* Right Column: Structured 7-Section Output + Saved Projects */}
        <div className="space-y-6 lg:col-span-7">
          <div className="min-h-[480px] rounded-xl border border-[#232332] bg-[#0E0E14] p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-2 border-b border-[#1F1F2D] pb-3">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-[#A78BFA]" />
                <span className="font-display text-sm font-semibold text-white">
                  Synthèse stratégique en 7 volets
                </span>
              </div>
              {streamingContent && (
                <button
                  type="button"
                  onClick={handleExportMarkdown}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#262638] bg-[#14141D] px-3 py-1.5 text-xs font-medium text-[#E0E0EE] hover:border-[#7C3AED]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Exporter (.md)
                </button>
              )}
            </div>

            {statusLabel && !streamingContent ? (
              <div className="flex items-center gap-2.5 py-16 text-sm text-[#C4B5FD]">
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[#8B5CF6]" />
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
                  <li>Les outils nécessaires</li>
                  <li>Les étapes de réalisation chronologiques</li>
                  <li>Les risques identifiés et comment les réduire</li>
                  <li>Les possibilités de revenus réalistes (sans promesse garantie)</li>
                  <li>Un plan d&apos;action concret dès les 7 prochains jours</li>
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
                        {proj.sector} • Budget{' '}
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
