import {
  Briefcase,
  Building2,
  Calculator,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageSquare,
  Monitor,
  Palette,
  PenTool,
  RotateCcw,
  Save,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BrandLogoGenerator } from '../components/BrandLogoGenerator';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { VideoStudioCanvas } from '../components/VideoStudioCanvas';
import type {
  BusinessProject,
  CompanyCreationResult,
  ExperienceLevel,
  PageView,
  PublicUser,
  PublishedSiteSummary,
  QuotaSnapshot,
  SavedCompanyCreation,
  SourceLink,
  UserDocument,
  VideoStoryboard,
} from '../types/nova';
import {
  ApiError,
  deleteBusinessProjectApi,
  deleteCompanyCreationApi,
  deleteDocumentApi,
  deletePublishedSiteApi,
  fetchBusinessProjects,
  fetchCompanyCreations,
  fetchDocuments,
  fetchPublishedSites,
  generateCompanySuiteApi,
  generateContentMarketingApi,
  generateDocumentApi,
  generateVideoStoryboardApi,
  publishWebsiteApi,
  regenerateLogoApi,
  regenerateWebsiteApi,
  saveDocumentApi,
  streamBusinessGeneration,
} from '../utils/api';
import {
  downloadDataUrl,
  downloadTextFile,
  renderSvgLogoToPng,
  type LogoBackdrop,
} from '../utils/logoPng';
import {
  exportCompanySuiteToPdf,
  exportInvoiceOrQuotePdf,
  exportMarkdownToPdf,
} from '../utils/pdfExport';

interface BusinessModePageProps {
  user: PublicUser | null;
  quota: QuotaSnapshot | null;
  initialProjectId?: string | null;
  onClearInitialProject?: () => void;
  onLaunchPrompt?: (prompt: string) => void;
  onQuotaUpdated: (q: QuotaSnapshot) => void;
  onNavigate: (view: PageView) => void;
}

type WorkspaceTab = 'company' | 'modules' | 'content' | 'video' | 'documents';
type CompanySubTab = 'logo' | 'website' | 'brand' | 'offer' | 'plan';

interface BusinessModuleItem {
  key: string;
  label: string;
  summary: string;
}

const BUSINESS_MODULES: BusinessModuleItem[] = [
  { key: 'business_ideas', label: '1. Idées de business', summary: 'Concepts rentables selon vos compétences et budget.' },
  { key: 'zero_budget', label: '2. Business avec 0 €', summary: 'Lancement sans capital via outils gratuits et prospection.' },
  { key: 'business_plan', label: '3. Business plan', summary: 'Structure stratégique, financière et opérationnelle.' },
  { key: 'market_study', label: '4. Étude de marché', summary: 'Demande, segments cibles et validation terrain.' },
  { key: 'competitor_analysis', label: '5. Analyse concurrentielle', summary: 'Cartographie des concurrents et positionnement.' },
  { key: 'company_creation', label: "6. Création d'entreprise", summary: 'Statut, démarches, lancement et feuille de route.' },
  { key: 'find_clients', label: '7. Recherche de clients', summary: 'Canaux d’acquisition directs et scripts de prospection.' },
  { key: 'marketing_strategy', label: '8. Marketing', summary: 'Positionnement, acquisition et messages de conversion.' },
  { key: 'brand_creation', label: '9. Branding', summary: 'Identité verbale, promesse et différenciation.' },
  { key: 'ecommerce_store', label: '10. E-commerce', summary: 'Catalogue, logistique, fiches produits et tunnel.' },
  { key: 'sales_strategy', label: '11. Stratégie commerciale', summary: 'Structuration d’offre, objections et closing.' },
  { key: 'costs_margins', label: '12. Calcul coûts & marges', summary: 'Rentabilité unitaire, charges et seuil d’équilibre.' },
  { key: 'quote_creation', label: '13. Devis', summary: 'Structure de devis claire, conditions et livrables.' },
  { key: 'invoice_billing', label: '14. Factures', summary: 'Modèles conformes et séquences de relance.' },
  { key: 'professional_texts', label: '15. Emails professionnels', summary: 'Séquences B2B, relances et propositions par email.' },
  { key: 'action_plan', label: "16. Plans d'action", summary: 'Feuille de route concrète semaine par semaine.' },
  { key: 'automation_ops', label: '17. Automatisation', summary: 'Workflows no-code, CRM et gains de productivité.' },
  { key: 'low_budget_growth', label: "18. Croissance d'entreprise", summary: 'Rétention, panier moyen et partenariats.' },
];

const CONTENT_FORMATS = [
  { key: 'tiktok_script', label: 'Scripts TikTok' },
  { key: 'short_video', label: 'Vidéos courtes (Reels / Shorts)' },
  { key: 'instagram_post', label: 'Publications Instagram' },
  { key: 'facebook_post', label: 'Publications Facebook' },
  { key: 'linkedin_post', label: 'Publications LinkedIn' },
  { key: 'ad_copy', label: 'Publicités (Meta / Google Ads)' },
  { key: 'slogans', label: 'Slogans & Accroches' },
  { key: 'marketing_email', label: 'Emails marketing & vente' },
  { key: 'product_description', label: 'Descriptions de produits' },
  { key: 'editorial_calendar', label: 'Calendrier éditorial (14 jours)' },
];

const DOCUMENT_TYPES = [
  { key: 'Facture', label: 'Facture' },
  { key: 'Devis', label: 'Devis' },
  { key: 'Business Plan', label: 'Business Plan' },
  { key: 'Proposition commerciale', label: 'Proposition commerciale' },
  { key: 'Rapport', label: 'Rapport d’analyse' },
  { key: 'Présentation', label: 'Présentation structurée' },
  { key: 'Email professionnel', label: 'Email professionnel' },
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
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('company');

  // --- TAB 1: REAL COMPANY CREATION SUITE ---
  const [compTitle, setCompTitle] = useState('');
  const [compSector, setCompSector] = useState('');
  const [compBudget, setCompBudget] = useState('500');
  const [compSkills, setCompSkills] = useState('');
  const [compHours, setCompHours] = useState('15');
  const [compExp, setCompExp] = useState<ExperienceLevel>(
    user?.preferences?.defaultExperience || 'debutant'
  );
  const [compGoal, setCompGoal] = useState('');
  const [compContext, setCompContext] = useState('');
  const [compLoading, setCompLoading] = useState(false);
  const [compError, setCompError] = useState<string | null>(null);
  const [suite, setSuite] = useState<CompanyCreationResult | null>(null);
  const [activeCreationId, setActiveCreationId] = useState<string | null>(null);
  const [companySubTab, setCompanySubTab] = useState<CompanySubTab>('logo');
  const [savedCreations, setSavedCreations] = useState<SavedCompanyCreation[]>([]);

  // Logo PNG state
  const [logoBackdrop, setLogoBackdrop] = useState<LogoBackdrop>('dark');
  const [logoPngUrl, setLogoPngUrl] = useState<string | null>(null);
  const [logoPngError, setLogoPngError] = useState<string | null>(null);
  const [logoStyleHint, setLogoStyleHint] = useState('');
  const [logoRegenLoading, setLogoRegenLoading] = useState(false);

  // Website Preview & Publish state
  const [siteViewport, setSiteViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [siteViewMode, setSiteViewMode] = useState<'preview' | 'code'>('preview');
  const [siteCustomInstructions, setSiteCustomInstructions] = useState('');
  const [siteRegenLoading, setSiteRegenLoading] = useState(false);
  const [sitePublishLoading, setSitePublishLoading] = useState(false);
  const [publishedInfo, setPublishedInfo] = useState<{
    slug: string;
    publicUrl: string;
  } | null>(null);
  const [siteFeedback, setSiteFeedback] = useState<string | null>(null);
  const [publishedSites, setPublishedSites] = useState<PublishedSiteSummary[]>([]);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  // --- TAB 2: 18 MODULES + BUSINESS GENERATOR + TOOLS ---
  const [selectedModule, setSelectedModule] = useState<string>('business_ideas');
  const [title, setTitle] = useState('');
  const [sector, setSector] = useState('');
  const [budgetEur, setBudgetEur] = useState('0');
  const [skills, setSkills] = useState('');
  const [weeklyHours, setWeeklyHours] = useState('10');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(
    user?.preferences?.defaultExperience || 'debutant'
  );
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

  const [activeToolTab, setActiveToolTab] = useState<'calculator' | 'invoice'>('calculator');
  const [unitPrice, setUnitPrice] = useState('79');
  const [unitCost, setUnitCost] = useState('22');
  const [cacCost, setCacCost] = useState('14');
  const [fixedCosts, setFixedCosts] = useState('450');
  const [monthlyUnits, setMonthlyUnits] = useState('35');

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

  // --- TAB 3: CONTENT STUDIO ---
  const [contentFormat, setContentFormat] = useState('tiktok_script');
  const [contentTopic, setContentTopic] = useState('');
  const [contentAudience, setContentAudience] = useState('');
  const [contentTone, setContentTone] = useState('Direct, concret et professionnel');
  const [contentCta, setContentCta] = useState('');
  const [contentOutput, setContentOutput] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentCopied, setContentCopied] = useState(false);

  // --- TAB 4: VIDEO STUDIO ---
  const [videoTopic, setVideoTopic] = useState('');
  const [videoFormat, setVideoFormat] = useState<'9:16' | '16:9'>('9:16');
  const [videoTone, setVideoTone] = useState('Dynamique et clair');
  const [videoDuration, setVideoDuration] = useState('30');
  const [videoSourceScript, setVideoSourceScript] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [storyboard, setStoryboard] = useState<VideoStoryboard | null>(null);

  // --- TAB 5: DOCUMENTS & PDF ---
  const [genDocType, setGenDocType] = useState('Proposition commerciale');
  const [genDocTitle, setGenDocTitle] = useState('');
  const [genDocCompany, setGenDocCompany] = useState(user?.companyName || user?.displayName || '');
  const [genDocClient, setGenDocClient] = useState('');
  const [genDocContext, setGenDocContext] = useState('');
  const [genDocMarkdown, setGenDocMarkdown] = useState('');
  const [genDocLoading, setGenDocLoading] = useState(false);
  const [genDocError, setGenDocError] = useState<string | null>(null);
  const [genDocEditMode, setGenDocEditMode] = useState(false);
  const [savedDocs, setSavedDocs] = useState<UserDocument[]>([]);
  const [docSaveFeedback, setDocSaveFeedback] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const moduleInFlightRef = useRef(false);

  useEffect(() => {
    if (user?.preferences?.defaultExperience) {
      setCompExp(user.preferences.defaultExperience);
      setExperienceLevel(user.preferences.defaultExperience);
    }
  }, [user?.preferences?.defaultExperience]);

  // Convert SVG -> Real PNG image whenever logoSvg or backdrop changes
  useEffect(() => {
    if (!suite?.logoSvg) {
      setLogoPngUrl(null);
      setLogoPngError(null);
      return;
    }
    let cancelled = false;
    setLogoPngError(null);
    void renderSvgLogoToPng(suite.logoSvg, logoBackdrop, 1024)
      .then((pngUrl) => {
        if (!cancelled) setLogoPngUrl(pngUrl);
      })
      .catch((err) => {
        if (!cancelled) {
          setLogoPngUrl(null);
          setLogoPngError(err instanceof Error ? err.message : 'Erreur conversion PNG.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [suite?.logoSvg, logoBackdrop]);

  const loadUserWorkspaceData = async () => {
    if (!user) {
      setSavedProjects([]);
      setSavedCreations([]);
      setPublishedSites([]);
      setSavedDocs([]);
      return;
    }
    try {
      const [projRes, compRes, sitesRes, docsRes] = await Promise.all([
        fetchBusinessProjects(),
        fetchCompanyCreations(),
        fetchPublishedSites(),
        fetchDocuments(),
      ]);
      setSavedProjects(projRes.projects);
      setSavedCreations(compRes.creations);
      setPublishedSites(sitesRes.sites);
      setSavedDocs(docsRes.documents);

      if (initialProjectId) {
        const match = projRes.projects.find((p) => p.id === initialProjectId);
        if (match) {
          setWorkspaceTab('modules');
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
      // ignore non-blocking fetch errors
    }
  };

  useEffect(() => {
    void loadUserWorkspaceData();
  }, [user?.id, initialProjectId]);

  const moduleMeta =
    BUSINESS_MODULES.find((m) => m.key === selectedModule) ?? BUSINESS_MODULES[0];

  // Calculator math
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

  // Invoice math
  const qty = Math.max(1, Number(itemQty) || 1);
  const unitHt = Math.max(0, Number(itemPriceHt) || 0);
  const totalHt = qty * unitHt;
  const vatPct = vatRate === '20' ? 0.2 : 0;
  const totalVat = totalHt * vatPct;
  const totalTtc = totalHt + totalVat;

  // --- HANDLERS: COMPANY SUITE ---
  const handleGenerateCompanySuite = async (e: FormEvent) => {
    e.preventDefault();
    if (compLoading) return;
    setCompError(null);
    setSiteFeedback(null);
    setPublishedInfo(null);
    setCompLoading(true);
    try {
      const res = await generateCompanySuiteApi({
        title: compTitle.trim(),
        sector: compSector.trim(),
        budgetEur: Math.max(0, Number(compBudget) || 0),
        goal: compGoal.trim(),
        skills: compSkills.trim(),
        weeklyHours: Math.max(1, Number(compHours) || 15),
        experienceLevel: compExp,
        contextDetails: compContext.trim(),
      });
      setSuite(res.suite);
      setActiveCreationId(res.creationId);
      setCompanySubTab('logo');
      onQuotaUpdated(res.quota);
      if (user) {
        const list = await fetchCompanyCreations();
        setSavedCreations(list.creations);
      }
    } catch (err) {
      setCompError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Impossible de générer la création d'entreprise."
      );
    } finally {
      setCompLoading(false);
    }
  };

  const handleRegenerateLogo = async () => {
    if (!suite || logoRegenLoading) return;
    setLogoRegenLoading(true);
    setLogoPngError(null);
    try {
      const res = await regenerateLogoApi({
        brandName: suite.brandIdentity.brandName,
        sector: compSector || suite.brandIdentity.positioning,
        primaryColor: suite.brandIdentity.colors.primary,
        secondaryColor: suite.brandIdentity.colors.accent,
        styleHint: logoStyleHint.trim(),
        creationId: activeCreationId,
      });
      setSuite((prev) => (prev ? { ...prev, logoSvg: res.logoSvg } : prev));
    } catch (err) {
      setLogoPngError(
        err instanceof Error ? err.message : 'Erreur lors de la régénération du logo.'
      );
    } finally {
      setLogoRegenLoading(false);
    }
  };

  const handleRegenerateWebsite = async () => {
    if (!suite || siteRegenLoading) return;
    setSiteRegenLoading(true);
    setSiteFeedback(null);
    try {
      const packagesText = suite.commercialOffer.packages
        .map((pkg) => `${pkg.name} (${pkg.priceLabel}): ${pkg.deliverables.join(', ')}`)
        .join(' | ');
      const res = await regenerateWebsiteApi({
        brandName: suite.brandIdentity.brandName,
        slogan: suite.brandIdentity.slogan,
        sector: compSector || suite.brandIdentity.positioning,
        primaryColor: suite.brandIdentity.colors.primary,
        secondaryColor: suite.brandIdentity.colors.secondary,
        accentColor: suite.brandIdentity.colors.accent,
        packagesText,
        logoSvg: suite.logoSvg,
        customInstructions: siteCustomInstructions.trim(),
        creationId: activeCreationId,
      });
      setSuite((prev) => (prev ? { ...prev, websiteHtml: res.websiteHtml } : prev));
    } catch (err) {
      setSiteFeedback(
        err instanceof Error ? err.message : 'Erreur lors de la régénération du site.'
      );
    } finally {
      setSiteRegenLoading(false);
    }
  };

  const handlePublishWebsite = async () => {
    if (!suite || sitePublishLoading) return;
    setSitePublishLoading(true);
    setSiteFeedback(null);
    try {
      const res = await publishWebsiteApi({
        title: suite.brandIdentity.brandName,
        htmlContent: suite.websiteHtml,
        existingSlug: publishedInfo?.slug ?? null,
        creationId: activeCreationId,
      });
      setPublishedInfo({ slug: res.site.slug, publicUrl: res.publicUrl });
      setSiteFeedback(`Site publié et accessible publiquement à l'adresse : ${res.publicUrl}`);
      if (user) {
        const sitesRes = await fetchPublishedSites();
        setPublishedSites(sitesRes.sites);
      }
    } catch (err) {
      setSiteFeedback(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible de publier le site.'
      );
    } finally {
      setSitePublishLoading(false);
    }
  };

  const handleLoadSavedCreation = (item: SavedCompanyCreation) => {
    try {
      const parsed = JSON.parse(item.data_json) as CompanyCreationResult;
      setSuite({
        ...parsed,
        logoSvg: item.logo_svg || parsed.logoSvg,
        websiteHtml: item.website_html || parsed.websiteHtml,
      });
      setActiveCreationId(item.id);
      setCompTitle(item.title);
      setCompSector(item.sector);
      setCompBudget(String(item.budget_eur));
      if (item.published_slug) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        setPublishedInfo({
          slug: item.published_slug,
          publicUrl: `${origin}/sites/${item.published_slug}`,
        });
      } else {
        setPublishedInfo(null);
      }
      setCompanySubTab('logo');
    } catch {
      setCompError('Impossible de relire cette création enregistrée.');
    }
  };

  // --- HANDLERS: 18 MODULES STREAM ---
  const runModuleGeneration = async () => {
    if (isGenerating || moduleInFlightRef.current) return;
    moduleInFlightRef.current = true;
    setErrorMessage(null);
    setStreamingContent('');
    setSources([]);
    setIsGenerating(true);
    setStatusLabel('NOVA structure votre analyse en 7 volets...');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamBusinessGeneration({
        moduleKey: selectedModule,
        title: title.trim(),
        sector: sector.trim(),
        budgetEur: Math.max(0, Number(budgetEur) || 0),
        goal: goal.trim(),
        skills: skills.trim(),
        weeklyHours: Math.max(1, Number(weeklyHours) || 10),
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
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setErrorMessage(
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Impossible de générer le projet business.'
        );
      }
    } finally {
      moduleInFlightRef.current = false;
      setIsGenerating(false);
      setStatusLabel(null);
      abortRef.current = null;
    }
  };

  // --- HANDLERS: CONTENT STUDIO ---
  const handleGenerateContent = async (e: FormEvent) => {
    e.preventDefault();
    if (contentLoading) return;
    setContentError(null);
    setContentLoading(true);
    try {
      const res = await generateContentMarketingApi({
        formatKey: contentFormat,
        topic: contentTopic.trim(),
        targetAudience: contentAudience.trim(),
        tone: contentTone.trim(),
        callToAction: contentCta.trim(),
      });
      setContentOutput(res.content);
    } catch (err) {
      setContentError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Erreur lors de la génération du contenu.'
      );
    } finally {
      setContentLoading(false);
    }
  };

  // --- HANDLERS: VIDEO STUDIO ---
  const handleGenerateStoryboard = async (e: FormEvent) => {
    e.preventDefault();
    if (videoLoading) return;
    setVideoError(null);
    setVideoLoading(true);
    try {
      const res = await generateVideoStoryboardApi({
        topic: videoTopic.trim(),
        format: videoFormat,
        tone: videoTone.trim(),
        durationTargetSec: Number(videoDuration) || 30,
        sourceScript: videoSourceScript.trim(),
      });
      setStoryboard(res.storyboard);
    } catch (err) {
      setVideoError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible de générer le storyboard vidéo.'
      );
    } finally {
      setVideoLoading(false);
    }
  };

  // --- HANDLERS: DOCUMENTS & PDF ---
  const handleGenerateDocument = async (e: FormEvent) => {
    e.preventDefault();
    if (genDocLoading) return;
    setGenDocError(null);
    setDocSaveFeedback(null);
    setGenDocLoading(true);
    try {
      const res = await generateDocumentApi({
        docType: genDocType,
        title: genDocTitle.trim(),
        companyName: genDocCompany.trim(),
        clientName: genDocClient.trim(),
        context: genDocContext.trim(),
      });
      setGenDocMarkdown(res.contentMarkdown);
      if (res.document) {
        setSavedDocs((prev) => [res.document!, ...prev]);
        setDocSaveFeedback('Document généré et sauvegardé dans votre espace.');
      }
    } catch (err) {
      setGenDocError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible de générer le document.'
      );
    } finally {
      setGenDocLoading(false);
    }
  };

  const handleSaveManualDoc = async () => {
    if (!user || !genDocMarkdown.trim()) return;
    setDocSaveFeedback(null);
    try {
      const res = await saveDocumentApi({
        docType: genDocType,
        title: genDocTitle.trim() || `${genDocType} NOVA`,
        contentMarkdown: genDocMarkdown,
      });
      setSavedDocs((prev) => [res.document, ...prev]);
      setDocSaveFeedback('Modifications enregistrées.');
    } catch (err) {
      setGenDocError(err instanceof Error ? err.message : 'Erreur sauvegarde.');
    }
  };

  const buildInvoiceText = () => {
    const today = new Date().toLocaleDateString('fr-FR');
    const legalMention =
      vatRate === '0'
        ? 'TVA non applicable, art. 293 B du CGI.'
        : 'TVA 20 % incluse — Règlement à 30 jours date d’émission.';
    return [
      `${docType} N° ${docNumber || '[À COMPLÉTER]'}`,
      `Date d'émission : ${today}`,
      '',
      `Émetteur : ${issuerName || '[À COMPLÉTER]'} (SIRET : ${issuerSiret || '[À COMPLÉTER]'})`,
      `Client : ${clientName || '[À COMPLÉTER]'}`,
      '',
      `Désignation : ${itemLabel || 'Prestation'}`,
      `Quantité : ${qty} × ${unitHt.toFixed(2)} € HT`,
      `Total HT : ${totalHt.toFixed(2)} €`,
      `TVA (${vatRate}%) : ${totalVat.toFixed(2)} €`,
      `Total TTC à payer : ${totalTtc.toFixed(2)} €`,
      '',
      `IBAN : [À COMPLÉTER]`,
      legalMention,
    ].join('\n');
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#1F1F2D] pb-5">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
            Suite Entrepreneuriale Complète · NOVA AI PRO
          </p>
          <h1 className="font-display text-3xl font-bold text-[#FAFAFA]">
            Studio Business, Création d&apos;Entreprise &amp; Médias
          </h1>
          <p className="max-w-3xl text-sm text-[#A8A8BE]">
            Générez des actifs réels exploitables immédiatement : Logo PNG haute définition, Site
            web publié en ligne, Identité de marque, Offre commerciale, Business Plan, Contenu,
            Vidéo WebM et Documents PDF.
          </p>
        </div>

        {quota && (
          <div className="rounded-lg border border-[#232332] bg-[#111117] px-4 py-2.5 text-xs">
            <span className="text-[#9E9EB5]">Générations du jour : </span>
            <span className="font-mono font-semibold tabular-nums text-white">
              {quota.businessUsedToday}
            </span>
            <span className="ml-1.5 text-[#3B82F6]">· Sans plafond interne</span>
          </div>
        )}
      </div>

      {/* Primary Workspace Tabs */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-[#232332] bg-[#0E0E14] p-1.5">
        {(
          [
            { id: 'company', label: "Création d'entreprise (Pack Réel)", icon: Building2 },
            { id: 'modules', label: '18 Modules & Générateur', icon: Briefcase },
            { id: 'content', label: 'Création de Contenu', icon: PenTool },
            { id: 'video', label: 'Studio Vidéo (.webm)', icon: Film },
            { id: 'documents', label: 'Documents & PDF', icon: FileText },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = workspaceTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setWorkspaceTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                active
                  ? 'bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white'
                  : 'text-[#A8A8BE] hover:bg-[#171722] hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: REAL COMPANY CREATION SUITE (LOGO PNG, LIVE SITE, BRAND, OFFER, BP) */}
      {/* ========================================================================= */}
      {workspaceTab === 'company' && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Form + Saved Creations */}
          <div className="space-y-5 lg:col-span-4">
            <form
              onSubmit={handleGenerateCompanySuite}
              className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-4"
            >
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  Lancer une création complète
                </h2>
                <p className="mt-1 text-xs text-[#9E9EB5]">
                  Produit simultanément un logo PNG, un site HTML fonctionnel publiable, une
                  charte de marque, une offre tarifée et un business plan complet.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                  Nom ou concept du projet
                </label>
                <input
                  type="text"
                  required
                  value={compTitle}
                  onChange={(e) => setCompTitle(e.target.value)}
                  placeholder="Ex. Atelier Vélo Électrique ou Agence Automatisation PME"
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white placeholder-[#6F6F87] focus:border-[#3B82F6] focus:outline-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                    Secteur
                  </label>
                  <input
                    type="text"
                    required
                    value={compSector}
                    onChange={(e) => setCompSector(e.target.value)}
                    placeholder="Ex. Services B2B, Bien-être..."
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white placeholder-[#6F6F87] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                    Budget (€)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={compBudget}
                    onChange={(e) => setCompBudget(e.target.value)}
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 font-mono tabular-nums text-sm text-white focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                    Vos compétences
                  </label>
                  <input
                    type="text"
                    value={compSkills}
                    onChange={(e) => setCompSkills(e.target.value)}
                    placeholder="Ex. Vente, design, code..."
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white placeholder-[#6F6F87] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                    Temps / semaine (h)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={80}
                    value={compHours}
                    onChange={(e) => setCompHours(e.target.value)}
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 font-mono tabular-nums text-sm text-white focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                  Expérience
                </label>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#262638] bg-[#0B0B10] p-1 text-xs">
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
                      onClick={() => setCompExp(lvl.id)}
                      className={`rounded py-1.5 font-medium ${
                        compExp === lvl.id
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
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                  Objectif principal
                </label>
                <input
                  type="text"
                  required
                  value={compGoal}
                  onChange={(e) => setCompGoal(e.target.value)}
                  placeholder="Ex. Obtenir 5 premiers clients locaux en 60 jours"
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white placeholder-[#6F6F87] focus:border-[#3B82F6] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                  Précisions supplémentaires (optionnel)
                </label>
                <textarea
                  rows={2}
                  value={compContext}
                  onChange={(e) => setCompContext(e.target.value)}
                  placeholder="Ex. Clientèle francophone, positionnement premium sobre..."
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white placeholder-[#6F6F87] focus:border-[#3B82F6] focus:outline-none"
                />
              </div>

              {compError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {compError}
                </div>
              )}

              <button
                type="submit"
                disabled={compLoading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                {compLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Création des 5 livrables en cours...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Créer mon entreprise complète
                  </>
                )}
              </button>
            </form>

            {user && savedCreations.length > 0 && (
              <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-3">
                <h3 className="font-display text-sm font-semibold text-white">
                  Entreprises sauvegardées ({savedCreations.length})
                </h3>
                <div className="divide-y divide-[#1E1E2B] max-h-64 overflow-y-auto">
                  {savedCreations.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                      <button
                        type="button"
                        onClick={() => handleLoadSavedCreation(item)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate font-semibold text-white hover:text-[#93C5FD]">
                          {item.title}
                        </p>
                        <p className="truncate text-[#8D8DA4]">
                          {item.sector} · {item.budget_eur} €
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteCompanyCreationApi(item.id);
                          setSavedCreations((prev) => prev.filter((x) => x.id !== item.id));
                        }}
                        aria-label="Supprimer cette entreprise"
                        className="p-1 text-[#7D7D96] hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {user && publishedSites.length > 0 && (
              <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2.5">
                <h3 className="font-display text-sm font-semibold text-white">
                  Sites web publiés ({publishedSites.length})
                </h3>
                <div className="divide-y divide-[#1E1E2B] text-xs">
                  {publishedSites.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 py-2">
                      <a
                        href={`/sites/${s.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 truncate font-medium text-[#93C5FD] hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{s.title}</span>
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          await deletePublishedSiteApi(s.id);
                          setPublishedSites((prev) => prev.filter((x) => x.id !== s.id));
                        }}
                        aria-label="Dépublier le site"
                        className="p-1 text-[#7D7D96] hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Output Workspace for the 5 real deliverables */}
          <div className="lg:col-span-8">
            {!suite ? (
              <div className="flex min-h-[520px] flex-col justify-center rounded-xl border border-[#232332] bg-[#0E0E14] p-8 text-center space-y-4">
                <Building2 className="mx-auto h-10 w-10 text-[#3B82F6]" />
                <h3 className="font-display text-xl font-semibold text-white">
                  Des créations concrètes, pas seulement du texte
                </h3>
                <p className="mx-auto max-w-lg text-sm text-[#A6A6BC]">
                  Remplissez le formulaire à gauche pour générer un véritable{' '}
                  <strong className="text-white">Logo PNG (1024×1024)</strong>, un{' '}
                  <strong className="text-white">Site internet fonctionnel publiable</strong>, une{' '}
                  <strong className="text-white">Identité de marque</strong>, une{' '}
                  <strong className="text-white">Offre commerciale</strong> et un{' '}
                  <strong className="text-white">Business Plan</strong> exportable en PDF.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-[#232332] bg-[#0E0E14] p-5 space-y-5">
                {/* Company Suite Header + PDF Export */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1F1F2D] pb-4">
                  <div>
                    <h2 className="font-display text-xl font-bold text-white">
                      {suite.brandIdentity.brandName}
                    </h2>
                    <p className="text-xs text-[#C4B5FD]">{suite.brandIdentity.slogan}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => exportCompanySuiteToPdf(suite)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/50 bg-[#3B82F6]/15 px-3.5 py-2 text-xs font-semibold text-[#93C5FD] hover:bg-[#3B82F6]/25"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Exporter dossier complet (.pdf)
                  </button>
                </div>

                {/* 5 Deliverable Sub-tabs */}
                <div className="flex flex-wrap gap-1.5 border-b border-[#1F1F2D] pb-3">
                  {(
                    [
                      { id: 'logo', label: '1. Logo PNG', icon: ImageIcon },
                      { id: 'website', label: '2. Site Internet', icon: Globe },
                      { id: 'brand', label: '3. Identité de marque', icon: Palette },
                      { id: 'offer', label: '4. Offre commerciale', icon: Layers },
                      { id: 'plan', label: '5. Business Plan', icon: Briefcase },
                    ] as const
                  ).map((sub) => {
                    const Icon = sub.icon;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setCompanySubTab(sub.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                          companySubTab === sub.id
                            ? 'bg-[#7C3AED] text-white'
                            : 'bg-[#14141D] text-[#A8A8BE] hover:text-white'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {sub.label}
                      </button>
                    );
                  })}
                </div>

                {/* 1. REAL LOGO PNG */}
                {companySubTab === 'logo' && (
                  <div className="grid gap-6 md:grid-cols-12 items-start">
                    <div className="md:col-span-6 space-y-3">
                      <div
                        className={`flex aspect-square items-center justify-center rounded-xl border border-[#262638] p-6 ${
                          logoBackdrop === 'light'
                            ? 'bg-white'
                            : logoBackdrop === 'dark'
                            ? 'bg-[#08080B]'
                            : 'bg-[linear-gradient(45deg,#15151f_25%,transparent_25%),linear-gradient(-45deg,#15151f_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#15151f_75%),linear-gradient(-45deg,transparent_75%,#15151f_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0]'
                        }`}
                      >
                        {logoPngUrl ? (
                          <img
                            src={logoPngUrl}
                            alt={`Logo PNG de ${suite.brandIdentity.brandName}`}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="text-xs text-[#9E9EB5]">Rendu PNG en cours...</div>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-[#9E9EB5]">Fond de rendu PNG :</span>
                        <div className="flex gap-1 rounded-lg border border-[#232332] bg-[#111117] p-1">
                          {(
                            [
                              { id: 'transparent', label: 'Transparent' },
                              { id: 'dark', label: 'Sombre' },
                              { id: 'light', label: 'Clair' },
                            ] as const
                          ).map((bg) => (
                            <button
                              key={bg.id}
                              type="button"
                              onClick={() => setLogoBackdrop(bg.id)}
                              className={`rounded px-2.5 py-1 font-medium ${
                                logoBackdrop === bg.id
                                  ? 'bg-[#7C3AED] text-white'
                                  : 'text-[#A8A8BE] hover:text-white'
                              }`}
                            >
                              {bg.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-6 space-y-4">
                      <div>
                        <h3 className="font-display text-base font-semibold text-white">
                          Export Logo Haute Définition (1024×1024)
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-[#A6A6BC]">
                          Le logo vectoriel généré est converti en véritable image matricielle{' '}
                          <code className="text-[#93C5FD]">PNG</code> prête pour vos réseaux
                          sociaux, factures et site web.
                        </p>
                      </div>

                      {logoPngError && (
                        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                          {logoPngError}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          disabled={!logoPngUrl}
                          onClick={() =>
                            logoPngUrl &&
                            downloadDataUrl(
                              logoPngUrl,
                              `logo-${suite.brandIdentity.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
                            )
                          }
                          className="inline-flex items-center gap-2 rounded-lg bg-[#3B82F6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#2563EB] disabled:opacity-45"
                        >
                          <Download className="h-4 w-4" />
                          Télécharger en PNG
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            downloadTextFile(
                              suite.logoSvg,
                              `logo-${suite.brandIdentity.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`,
                              'image/svg+xml;charset=utf-8'
                            )
                          }
                          className="inline-flex items-center gap-2 rounded-lg border border-[#2C2C40] bg-[#14141D] px-4 py-2.5 text-xs font-semibold text-white hover:border-[#7C3AED]"
                        >
                          <Download className="h-4 w-4" />
                          Télécharger SVG
                        </button>
                      </div>

                      <div className="border-t border-[#1F1F2D] pt-4 space-y-2.5">
                        <label className="block text-xs font-medium text-[#C8C8DA]">
                          Affiner le style du logo (optionnel)
                        </label>
                        <input
                          type="text"
                          value={logoStyleHint}
                          onChange={(e) => setLogoStyleHint(e.target.value)}
                          placeholder="Ex. Monogramme minimaliste géométrique, icône bouclier..."
                          className="w-full rounded-lg border border-[#262638] bg-[#111117] px-3 py-2 text-xs text-white placeholder-[#6F6F87] focus:border-[#7C3AED] focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={logoRegenLoading}
                          onClick={() => void handleRegenerateLogo()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/60 bg-[#7C3AED]/15 px-3.5 py-2 text-xs font-semibold text-[#DDD6FE] hover:bg-[#7C3AED]/25 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {logoRegenLoading ? 'Régénération...' : 'Générer une autre variante'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. REAL WEBSITE PREVIEW + PUBLISH */}
                {companySubTab === 'website' && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 rounded-lg border border-[#232332] bg-[#111117] p-1 text-xs">
                        <button
                          type="button"
                          onClick={() => setSiteViewMode('preview')}
                          className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium ${
                            siteViewMode === 'preview'
                              ? 'bg-[#7C3AED] text-white'
                              : 'text-[#A8A8BE] hover:text-white'
                          }`}
                        >
                          <Monitor className="h-3.5 w-3.5" />
                          Aperçu live
                        </button>
                        <button
                          type="button"
                          onClick={() => setSiteViewMode('code')}
                          className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium ${
                            siteViewMode === 'code'
                              ? 'bg-[#7C3AED] text-white'
                              : 'text-[#A8A8BE] hover:text-white'
                          }`}
                        >
                          <Code2 className="h-3.5 w-3.5" />
                          Code HTML
                        </button>
                      </div>

                      {siteViewMode === 'preview' && (
                        <div className="flex items-center gap-1 rounded-lg border border-[#232332] bg-[#111117] p-1 text-xs">
                          <button
                            type="button"
                            onClick={() => setSiteViewport('desktop')}
                            className={`inline-flex items-center gap-1 rounded px-2 py-1 ${
                              siteViewport === 'desktop'
                                ? 'bg-[#1D1D2B] text-white'
                                : 'text-[#9E9EB5]'
                            }`}
                          >
                            <Monitor className="h-3.5 w-3.5" />
                            Bureau
                          </button>
                          <button
                            type="button"
                            onClick={() => setSiteViewport('mobile')}
                            className={`inline-flex items-center gap-1 rounded px-2 py-1 ${
                              siteViewport === 'mobile'
                                ? 'bg-[#1D1D2B] text-white'
                                : 'text-[#9E9EB5]'
                            }`}
                          >
                            <Smartphone className="h-3.5 w-3.5" />
                            Mobile
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            downloadTextFile(
                              suite.websiteHtml,
                              `site-${suite.brandIdentity.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`,
                              'text/html;charset=utf-8'
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2C2C40] bg-[#14141D] px-3 py-1.5 text-xs font-medium text-white hover:border-[#3B82F6]"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Télécharger index.html
                        </button>
                        <button
                          type="button"
                          disabled={sitePublishLoading}
                          onClick={() => void handlePublishWebsite()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#2563EB] disabled:opacity-50"
                        >
                          <Globe className="h-3.5 w-3.5" />
                          {sitePublishLoading
                            ? 'Publication...'
                            : publishedInfo
                            ? 'Mettre à jour en ligne'
                            : 'Publier le site'}
                        </button>
                      </div>
                    </div>

                    {publishedInfo && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-100">
                        <span>
                          Site en ligne :{' '}
                          <a
                            href={`/sites/${publishedInfo.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono font-semibold underline"
                          >
                            {publishedInfo.publicUrl}
                          </a>
                        </span>
                        <a
                          href={`/sites/${publishedInfo.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-500"
                        >
                          Ouvrir
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}

                    {siteFeedback && !publishedInfo && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        {siteFeedback}
                      </div>
                    )}

                    {siteViewMode === 'preview' ? (
                      <div className="flex justify-center rounded-xl border border-[#232332] bg-[#08080B] p-3">
                        <iframe
                          title={`Aperçu du site ${suite.brandIdentity.brandName}`}
                          sandbox="allow-scripts"
                          srcDoc={suite.websiteHtml}
                          className={`rounded-lg bg-white transition-all ${
                            siteViewport === 'mobile'
                              ? 'h-[580px] w-[390px] max-w-full'
                              : 'h-[560px] w-full'
                          }`}
                        />
                      </div>
                    ) : (
                      <textarea
                        rows={18}
                        value={suite.websiteHtml}
                        onChange={(e) =>
                          setSuite((prev) =>
                            prev ? { ...prev, websiteHtml: e.target.value } : prev
                          )
                        }
                        className="w-full rounded-xl border border-[#262638] bg-[#08080B] p-3.5 font-mono text-xs text-[#D8D8EC] focus:border-[#3B82F6] focus:outline-none"
                      />
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={siteCustomInstructions}
                        onChange={(e) => setSiteCustomInstructions(e.target.value)}
                        placeholder="Instruction de modification (ex. ajoute une section FAQ, change le ton...)"
                        className="min-w-[240px] flex-1 rounded-lg border border-[#262638] bg-[#111117] px-3 py-2 text-xs text-white placeholder-[#6F6F87] focus:border-[#7C3AED] focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={siteRegenLoading}
                        onClick={() => void handleRegenerateWebsite()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/60 bg-[#7C3AED]/15 px-3.5 py-2 text-xs font-semibold text-[#DDD6FE] hover:bg-[#7C3AED]/25 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {siteRegenLoading ? 'Mise à jour...' : 'Régénérer le site'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. BRAND IDENTITY */}
                {companySubTab === 'brand' && (
                  <div className="space-y-5 text-sm">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#3B82F6]">
                          Positionnement &amp; Ton
                        </p>
                        <p className="text-white font-semibold">
                          {suite.brandIdentity.brandName} — {suite.brandIdentity.slogan}
                        </p>
                        <p className="text-xs leading-relaxed text-[#C4C4D8]">
                          {suite.brandIdentity.positioning}
                        </p>
                        <p className="text-xs text-[#9E9EB5]">
                          <strong className="text-white">Cible :</strong>{' '}
                          {suite.brandIdentity.targetAudience}
                        </p>
                        <p className="text-xs text-[#9E9EB5]">
                          <strong className="text-white">Ton :</strong>{' '}
                          {suite.brandIdentity.toneOfVoice}
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#A78BFA]">
                          Typographie &amp; Directives
                        </p>
                        <p className="text-xs text-[#E4E4F0]">
                          <strong>Titres :</strong> {suite.brandIdentity.typography.displayFont}
                        </p>
                        <p className="text-xs text-[#E4E4F0]">
                          <strong>Corps :</strong> {suite.brandIdentity.typography.bodyFont}
                        </p>
                        <p className="text-xs text-[#A6A6BC]">
                          {suite.brandIdentity.typography.rationale}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
                        Palette Chromatique (cliquer pour copier le code hex)
                      </p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                        {Object.entries(suite.brandIdentity.colors).map(([role, hex]) => (
                          <button
                            key={role}
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(hex);
                              setCopiedHex(hex);
                              setTimeout(() => setCopiedHex(null), 1500);
                            }}
                            className="rounded-lg border border-[#262638] bg-[#0B0B10] p-2.5 text-left hover:border-[#7C3AED]"
                          >
                            <div
                              className="h-10 w-full rounded-md border border-white/10"
                              style={{ backgroundColor: hex }}
                            />
                            <p className="mt-2 text-[11px] capitalize text-[#9E9EB5]">{role}</p>
                            <p className="font-mono text-xs font-semibold text-white">
                              {copiedHex === hex ? 'Copié' : hex}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
                        Règles d&apos;identité visuelle
                      </p>
                      <ul className="list-disc pl-5 space-y-1 text-xs text-[#D4D4E6]">
                        {suite.brandIdentity.visualGuidelines.map((rule, i) => (
                          <li key={i}>{rule}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* 4. COMMERCIAL OFFER */}
                {companySubTab === 'offer' && (
                  <div className="space-y-5">
                    <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2">
                      <h3 className="font-display text-lg font-bold text-white">
                        {suite.commercialOffer.headline}
                      </h3>
                      <p className="text-sm text-[#C4C4D8]">
                        {suite.commercialOffer.valueProposition}
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      {suite.commercialOffer.packages.map((pkg, idx) => (
                        <div
                          key={idx}
                          className="flex flex-col justify-between rounded-xl border border-[#262638] bg-[#111117] p-4 space-y-3"
                        >
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wider text-[#A78BFA]">
                              {pkg.timeline}
                            </p>
                            <h4 className="font-display text-base font-bold text-white">
                              {pkg.name}
                            </h4>
                            <p className="font-mono text-xl font-bold text-[#93C5FD]">
                              {pkg.priceLabel}
                            </p>
                            <p className="text-xs text-[#9E9EB5]">{pkg.targetClient}</p>
                            <ul className="space-y-1.5 pt-2 text-xs text-[#E2E2F0]">
                              {pkg.deliverables.map((d, i) => (
                                <li key={i} className="flex items-start gap-1.5">
                                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3B82F6]" />
                                  <span>{d}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
                          Pitch commercial prêt à envoyer
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            void navigator.clipboard.writeText(suite.commercialOffer.salesPitch)
                          }
                          className="inline-flex items-center gap-1 text-xs text-[#93C5FD] hover:text-white"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copier
                        </button>
                      </div>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap text-[#E4E4F0]">
                        {suite.commercialOffer.salesPitch}
                      </p>
                    </div>
                  </div>
                )}

                {/* 5. BUSINESS PLAN & FIRST CLIENTS */}
                {companySubTab === 'plan' && (
                  <div className="space-y-5 text-xs">
                    <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2">
                      <p className="font-semibold uppercase tracking-wider text-[#3B82F6]">
                        Synthèse exécutive
                      </p>
                      <p className="text-sm leading-relaxed text-[#E4E4F0]">
                        {suite.businessPlan.executiveSummary}
                      </p>
                    </div>

                    <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-3">
                      <p className="font-semibold uppercase tracking-wider text-[#A78BFA]">
                        Plan financier &amp; Seuil de rentabilité
                      </p>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="rounded-lg bg-[#0B0B10] p-3">
                          <p className="text-[#8D8DA4]">Charges fixes / mois</p>
                          <p className="mt-1 font-mono text-base font-bold tabular-nums text-white">
                            {suite.businessPlan.financialPlan.monthlyFixedCostsEur} €
                          </p>
                        </div>
                        <div className="rounded-lg bg-[#0B0B10] p-3">
                          <p className="text-[#8D8DA4]">Prix unitaire moyen</p>
                          <p className="mt-1 font-mono text-base font-bold tabular-nums text-white">
                            {suite.businessPlan.financialPlan.unitPriceEur} €
                          </p>
                        </div>
                        <div className="rounded-lg bg-[#0B0B10] p-3">
                          <p className="text-[#8D8DA4]">Coût variable / vente</p>
                          <p className="mt-1 font-mono text-base font-bold tabular-nums text-white">
                            {suite.businessPlan.financialPlan.unitVariableCostEur} €
                          </p>
                        </div>
                        <div className="rounded-lg bg-[#0B0B10] p-3">
                          <p className="text-[#8D8DA4]">Point mort estimé</p>
                          <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#93C5FD]">
                            {suite.businessPlan.financialPlan.breakEvenClientsPerMonth} clients/mois
                          </p>
                        </div>
                      </div>

                      <div className="divide-y divide-[#1E1E2B] rounded-lg border border-[#1E1E2B] bg-[#0B0B10] px-3">
                        {suite.businessPlan.financialPlan.startupCostsEur.map((row, idx) => (
                          <div key={idx} className="flex justify-between py-2">
                            <span className="text-[#D4D4E6]">{row.item}</span>
                            <span className="font-mono font-semibold tabular-nums text-white">
                              {row.amountEur} €
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[#9E9EB5]">
                        {suite.businessPlan.financialPlan.prudentScenarioNote}
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      {[
                        { label: '7 premiers jours', items: suite.businessPlan.firstClientsPlan.days7 },
                        { label: '30 jours', items: suite.businessPlan.firstClientsPlan.days30 },
                        { label: '90 jours', items: suite.businessPlan.firstClientsPlan.days90 },
                      ].map((phase) => (
                        <div
                          key={phase.label}
                          className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2"
                        >
                          <p className="font-semibold uppercase tracking-wider text-[#93C5FD]">
                            {phase.label}
                          </p>
                          <ul className="list-disc pl-4 space-y-1.5 text-[#D6D6E6]">
                            {phase.items.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2">
                        <p className="font-semibold uppercase tracking-wider text-[#9E9EB5]">
                          Stratégie marketing
                        </p>
                        <ul className="list-disc pl-4 space-y-1 text-[#D6D6E6]">
                          {suite.businessPlan.marketingStrategy.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2">
                        <p className="font-semibold uppercase tracking-wider text-[#9E9EB5]">
                          Risques &amp; parades
                        </p>
                        <ul className="list-disc pl-4 space-y-1 text-[#D6D6E6]">
                          {suite.businessPlan.keyRisks.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: 18 BUSINESS MODULES + GENERATOR + CALCULATOR & INVOICE             */}
      {/* ========================================================================= */}
      {workspaceTab === 'modules' && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
              18 modules stratégiques &amp; opérationnels
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {BUSINESS_MODULES.map((mod) => {
                const active = selectedModule === mod.key;
                return (
                  <button
                    key={mod.key}
                    type="button"
                    onClick={() => setSelectedModule(mod.key)}
                    className={`flex flex-col justify-between rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-[#7C3AED] bg-[#17132A]'
                        : 'border-[#232332] bg-[#111117] hover:border-[#37374F]'
                    }`}
                  >
                    <span className="text-xs font-semibold text-white">{mod.label}</span>
                    <p className="mt-1 text-[11px] leading-snug text-[#9E9EB5]">{mod.summary}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runModuleGeneration();
                }}
                className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-4"
              >
                <h2 className="font-display text-lg font-semibold text-white">
                  {moduleMeta.label}
                </h2>

                <div>
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                    Nom du projet ou sujet
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex. Agence SEO locale ou Boutiquier artisanal"
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white focus:border-[#7C3AED] focus:outline-none"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">Secteur</label>
                    <input
                      type="text"
                      required
                      value={sector}
                      onChange={(e) => setSector(e.target.value)}
                      placeholder="Ex. SaaS, Conseil, E-commerce"
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white focus:border-[#7C3AED] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                      Budget (€)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={budgetEur}
                      onChange={(e) => setBudgetEur(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 font-mono text-sm text-white focus:border-[#7C3AED] focus:outline-none"
                    />
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {BUDGET_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setBudgetEur(String(preset))}
                          className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                            Number(budgetEur) === preset
                              ? 'bg-[#7C3AED] text-white'
                              : 'bg-[#0B0B10] text-[#9E9EB5]'
                          }`}
                        >
                          {preset} €
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                      Compétences clés
                    </label>
                    <input
                      type="text"
                      value={skills}
                      onChange={(e) => setSkills(e.target.value)}
                      placeholder="Ex. Rédaction, prospection..."
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white focus:border-[#7C3AED] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                      Temps dispo / semaine (h)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={80}
                      value={weeklyHours}
                      onChange={(e) => setWeeklyHours(e.target.value)}
                      className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 font-mono text-sm text-white focus:border-[#7C3AED] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">Niveau</label>
                  <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#262638] bg-[#0B0B10] p-1 text-xs">
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
                        className={`rounded py-1.5 font-medium ${
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
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                    Objectif principal
                  </label>
                  <input
                    type="text"
                    required
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Ex. Signer 3 clients pilotes en 45 jours"
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white focus:border-[#7C3AED] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                    Contexte &amp; contraintes
                  </label>
                  <textarea
                    rows={2}
                    value={contextDetails}
                    onChange={(e) => setContextDetails(e.target.value)}
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white focus:border-[#7C3AED] focus:outline-none"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-[#C8C8DA]">
                  <input
                    type="checkbox"
                    checked={useWebSearch}
                    onChange={(e) => setUseWebSearch(e.target.checked)}
                    className="h-4 w-4 rounded border-[#32324A] accent-[#7C3AED]"
                  />
                  <Globe className="h-3.5 w-3.5 text-[#3B82F6]" />
                  Inclure une recherche web en direct
                </label>

                {errorMessage && (
                  <div className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                    <p>{errorMessage}</p>
                    <button
                      type="button"
                      disabled={isGenerating}
                      onClick={() => void runModuleGeneration()}
                      className="inline-flex items-center gap-1.5 rounded border border-red-400/40 bg-red-500/20 px-2.5 py-1 font-medium text-red-100 hover:bg-red-500/30 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Réessayer
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isGenerating}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-45"
                  >
                    <Sparkles className="h-4 w-4" />
                    {isGenerating ? 'Génération...' : 'Générer plan 7 / 30 / 90 j'}
                  </button>
                  {isGenerating && (
                    <button
                      type="button"
                      onClick={() => abortRef.current?.abort()}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#32324A] bg-[#1A1A26] px-3 py-2 text-xs text-white"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Stop
                    </button>
                  )}
                </div>
              </form>

              {/* Margin Calculator & Quick Invoice/Quote PDF */}
              <div className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-4">
                <div className="flex items-center gap-1 rounded-lg border border-[#232332] bg-[#0B0B10] p-1">
                  <button
                    type="button"
                    onClick={() => setActiveToolTab('calculator')}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold ${
                      activeToolTab === 'calculator'
                        ? 'bg-[#1A1A26] text-white'
                        : 'text-[#9E9EB5]'
                    }`}
                  >
                    <Calculator className="h-3.5 w-3.5 text-[#3B82F6]" />
                    Coûts &amp; Marges
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveToolTab('invoice')}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold ${
                      activeToolTab === 'invoice'
                        ? 'bg-[#1A1A26] text-white'
                        : 'text-[#9E9EB5]'
                    }`}
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-[#A78BFA]" />
                    Facture / Devis PDF
                  </button>
                </div>

                {activeToolTab === 'calculator' ? (
                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="mb-1 block text-[#9E9EB5]">Prix HT (€)</label>
                        <input
                          type="number"
                          min={0}
                          value={unitPrice}
                          onChange={(e) => setUnitPrice(e.target.value)}
                          className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[#9E9EB5]">Coût unitaire (€)</label>
                        <input
                          type="number"
                          min={0}
                          value={unitCost}
                          onChange={(e) => setUnitCost(e.target.value)}
                          className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[#9E9EB5]">Acquisition (€)</label>
                        <input
                          type="number"
                          min={0}
                          value={cacCost}
                          onChange={(e) => setCacCost(e.target.value)}
                          className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[#9E9EB5]">Charges fixes / mois</label>
                        <input
                          type="number"
                          min={0}
                          value={fixedCosts}
                          onChange={(e) => setFixedCosts(e.target.value)}
                          className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="mb-1 block text-[#9E9EB5]">Ventes mensuelles</label>
                        <input
                          type="number"
                          min={0}
                          value={monthlyUnits}
                          onChange={(e) => setMonthlyUnits(e.target.value)}
                          className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 border-t border-[#232332] pt-3">
                      <div className="rounded bg-[#0B0B10] p-2">
                        <p className="text-[#8D8DA4]">Marge / vente</p>
                        <p className="font-mono font-bold text-white">
                          {unitContribution.toFixed(2)} € ({marginPct.toFixed(1)}%)
                        </p>
                      </div>
                      <div className="rounded bg-[#0B0B10] p-2">
                        <p className="text-[#8D8DA4]">Point mort</p>
                        <p className="font-mono font-bold text-white">
                          {breakEvenUnits !== null ? `${breakEvenUnits} / mois` : 'Non rentable'}
                        </p>
                      </div>
                      <div className="rounded bg-[#0B0B10] p-2">
                        <p className="text-[#8D8DA4]">CA simulé</p>
                        <p className="font-mono font-bold text-white">
                          {monthlyRevenue.toFixed(0)} €
                        </p>
                      </div>
                      <div className="rounded bg-[#0B0B10] p-2">
                        <p className="text-[#8D8DA4]">Résultat estimé</p>
                        <p
                          className={`font-mono font-bold ${
                            monthlyOperatingResult >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {monthlyOperatingResult.toFixed(0)} €
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={docType}
                        onChange={(e) => setDocType(e.target.value as 'FACTURE' | 'DEVIS')}
                        className="rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                      >
                        <option value="FACTURE">Facture</option>
                        <option value="DEVIS">Devis</option>
                      </select>
                      <input
                        type="text"
                        value={docNumber}
                        onChange={(e) => setDocNumber(e.target.value)}
                        placeholder="Numéro"
                        className="rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                      />
                      <input
                        type="text"
                        value={issuerName}
                        onChange={(e) => setIssuerName(e.target.value)}
                        placeholder="Émetteur"
                        className="rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                      />
                      <input
                        type="text"
                        value={issuerSiret}
                        onChange={(e) => setIssuerSiret(e.target.value)}
                        placeholder="Votre SIRET (non inventé)"
                        className="rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                      />
                      <input
                        type="text"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="Client destinataire"
                        className="col-span-2 rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                      />
                      <input
                        type="text"
                        value={itemLabel}
                        onChange={(e) => setItemLabel(e.target.value)}
                        placeholder="Désignation"
                        className="col-span-2 rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                      />
                      <input
                        type="number"
                        min={1}
                        value={itemQty}
                        onChange={(e) => setItemQty(e.target.value)}
                        className="rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                      />
                      <input
                        type="number"
                        min={0}
                        value={itemPriceHt}
                        onChange={(e) => setItemPriceHt(e.target.value)}
                        className="rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 font-mono text-white"
                      />
                      <select
                        value={vatRate}
                        onChange={(e) => setVatRate(e.target.value as '0' | '20')}
                        className="col-span-2 rounded-lg border border-[#262638] bg-[#0B0B10] px-2.5 py-1.5 text-white"
                      >
                        <option value="0">0 % — Franchise (art. 293 B CGI)</option>
                        <option value="20">20 % — TVA normale</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-[#1E1E2B] bg-[#0B0B10] p-2.5">
                      <div>
                        <p className="text-[#8D8DA4]">Total TTC</p>
                        <p className="font-mono text-sm font-bold text-white">
                          {totalTtc.toFixed(2)} €
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(buildInvoiceText());
                            setInvoiceCopied(true);
                            setTimeout(() => setInvoiceCopied(false), 1600);
                          }}
                          className="rounded border border-[#2C2C40] bg-[#171722] px-2.5 py-1.5 text-white"
                        >
                          {invoiceCopied ? 'Copié' : 'Copier'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            exportInvoiceOrQuotePdf({
                              docType,
                              docNumber,
                              issuerName,
                              issuerSiret,
                              clientName,
                              itemLabel,
                              qty,
                              unitHt,
                              vatRate,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded bg-[#3B82F6] px-2.5 py-1.5 font-semibold text-white hover:bg-[#2563EB]"
                        >
                          <Download className="h-3.5 w-3.5" />
                          PDF
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {selectedModule === 'brand_creation' && <BrandLogoGenerator />}
            </div>

            <div className="space-y-6 lg:col-span-7">
              <div className="min-h-[480px] rounded-xl border border-[#232332] bg-[#0E0E14] p-5 sm:p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#1F1F2D] pb-3">
                  <span className="font-display text-sm font-semibold text-white">
                    Résultat structuré &amp; Plan 7 / 30 / 90 jours
                  </span>
                  {streamingContent && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(streamingContent);
                          setCopiedOutput(true);
                          setTimeout(() => setCopiedOutput(false), 1600);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#262638] bg-[#14141D] px-2.5 py-1.5 text-xs text-white"
                      >
                        {copiedOutput ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedOutput ? 'Copié' : 'Copier'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadTextFile(
                            streamingContent,
                            `${(title || 'business-nova').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
                            'text/markdown;charset=utf-8'
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-[#262638] bg-[#14141D] px-2.5 py-1.5 text-xs text-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        .md
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          exportMarkdownToPdf(
                            title || moduleMeta.label,
                            streamingContent,
                            `${moduleMeta.label} · ${sector || 'NOVA AI PRO'}`
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-[#3B82F6] px-2.5 py-1.5 text-xs font-semibold text-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        PDF
                      </button>
                      {onLaunchPrompt && !isGenerating && (
                        <button
                          type="button"
                          onClick={() =>
                            onLaunchPrompt(
                              `Voici mon analyse "${title}" (${sector}) :\n\n${streamingContent.slice(
                                0,
                                3500
                              )}\n\nAide-moi à exécuter la première étape maintenant.`
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-[#7C3AED]/20 border border-[#7C3AED]/50 px-2.5 py-1.5 text-xs text-[#DDD6FE]"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          Chat
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {statusLabel && !streamingContent ? (
                  <div className="flex items-center gap-2 py-16 text-sm text-[#C4B5FD]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{statusLabel}</span>
                  </div>
                ) : streamingContent ? (
                  <MarkdownRenderer content={streamingContent} sources={sources} />
                ) : (
                  <p className="py-12 text-sm text-[#9E9EB5]">
                    Sélectionnez un des 18 modules et indiquez votre budget, vos compétences et
                    votre temps disponible pour obtenir un plan concret sans aucune promesse
                    financière irréaliste.
                  </p>
                )}
              </div>

              {user && savedProjects.length > 0 && (
                <div className="rounded-xl border border-[#232332] bg-[#111117] p-5">
                  <h3 className="mb-3 font-display text-sm font-semibold text-white">
                    Analyses business enregistrées ({savedProjects.length})
                  </h3>
                  <div className="divide-y divide-[#1E1E2B]">
                    {savedProjects.map((proj) => (
                      <div key={proj.id} className="flex items-center justify-between gap-2 py-2 text-xs">
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
                          <p className="truncate font-medium text-white hover:text-[#93C5FD]">
                            {proj.title}
                          </p>
                          <p className="truncate text-[#8D8DA4]">
                            {proj.sector} · {proj.budget_eur} €
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteBusinessProjectApi(proj.id);
                            setSavedProjects((prev) => prev.filter((p) => p.id !== proj.id));
                          }}
                          aria-label="Supprimer ce projet"
                          className="p-1 text-[#7D7D96] hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: CONTENT CREATION STUDIO                                            */}
      {/* ========================================================================= */}
      {workspaceTab === 'content' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleGenerateContent}
            className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-4 lg:col-span-5"
          >
            <h2 className="font-display text-lg font-semibold text-white">
              Création de Contenu Marketing
            </h2>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                Format à produire
              </label>
              <select
                value={contentFormat}
                onChange={(e) => setContentFormat(e.target.value)}
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
              >
                {CONTENT_FORMATS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                Sujet / Produit / Offre
              </label>
              <input
                type="text"
                required
                value={contentTopic}
                onChange={(e) => setContentTopic(e.target.value)}
                placeholder="Ex. Lancement d'un logiciel de facturation pour artisans"
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">Public cible</label>
              <input
                type="text"
                value={contentAudience}
                onChange={(e) => setContentAudience(e.target.value)}
                placeholder="Ex. Dirigeants PME, freelances, créateurs..."
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">Ton souhaité</label>
              <input
                type="text"
                value={contentTone}
                onChange={(e) => setContentTone(e.target.value)}
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                Appel à l&apos;action (optionnel)
              </label>
              <input
                type="text"
                value={contentCta}
                onChange={(e) => setContentCta(e.target.value)}
                placeholder="Ex. Réserver un audit gratuit de 15 min"
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
              />
            </div>

            {contentError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {contentError}
              </div>
            )}

            <button
              type="submit"
              disabled={contentLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-50"
            >
              {contentLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenTool className="h-4 w-4" />}
              {contentLoading ? 'Rédaction en cours...' : 'Générer le contenu'}
            </button>
          </form>

          <div className="rounded-xl border border-[#232332] bg-[#0E0E14] p-5 space-y-4 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F1F2D] pb-3">
              <span className="font-display text-sm font-semibold text-white">
                Contenu éditable prêt à publier
              </span>
              {contentOutput && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(contentOutput);
                      setContentCopied(true);
                      setTimeout(() => setContentCopied(false), 1600);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#262638] bg-[#14141D] px-2.5 py-1.5 text-xs text-white"
                  >
                    {contentCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {contentCopied ? 'Copié' : 'Copier'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportMarkdownToPdf(
                        contentTopic || 'Contenu NOVA AI PRO',
                        contentOutput,
                        CONTENT_FORMATS.find((f) => f.key === contentFormat)?.label
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-[#262638] bg-[#14141D] px-2.5 py-1.5 text-xs text-white"
                  >
                    <Download className="h-3.5 w-3.5" />
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVideoTopic(contentTopic);
                      setVideoSourceScript(contentOutput);
                      setWorkspaceTab('video');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#3B82F6] px-2.5 py-1.5 text-xs font-semibold text-white"
                  >
                    <Film className="h-3.5 w-3.5" />
                    Transformer en Vidéo
                  </button>
                </div>
              )}
            </div>

            <textarea
              rows={18}
              value={contentOutput}
              onChange={(e) => setContentOutput(e.target.value)}
              placeholder="Le contenu généré apparaîtra ici et pourra être modifié directement avant copie ou export..."
              className="w-full rounded-xl border border-[#232332] bg-[#0B0B10] p-4 text-sm leading-relaxed text-[#FAFAFA] placeholder-[#6F6F87] focus:border-[#7C3AED] focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: REAL VIDEO STUDIO (STORYBOARD + CANVAS PLAYER + WEBM EXPORT)       */}
      {/* ========================================================================= */}
      {workspaceTab === 'video' && (
        <div className="space-y-6">
          <form
            onSubmit={handleGenerateStoryboard}
            className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-12 items-end">
              <div className="md:col-span-4">
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                  Sujet de la vidéo
                </label>
                <input
                  type="text"
                  required
                  value={videoTopic}
                  onChange={(e) => setVideoTopic(e.target.value)}
                  placeholder="Ex. 3 erreurs qui freinent votre prospection B2B"
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">Format</label>
                <select
                  value={videoFormat}
                  onChange={(e) => setVideoFormat(e.target.value as '9:16' | '16:9')}
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                >
                  <option value="9:16">Vertical 9:16</option>
                  <option value="16:9">Horizontal 16:9</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">Durée (s)</label>
                <input
                  type="number"
                  min={12}
                  max={90}
                  value={videoDuration}
                  onChange={(e) => setVideoDuration(e.target.value)}
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 font-mono text-sm text-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">Ton</label>
                <input
                  type="text"
                  value={videoTone}
                  onChange={(e) => setVideoTone(e.target.value)}
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={videoLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {videoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
                  {videoLoading ? 'Création...' : 'Créer la vidéo'}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                Script source existant (optionnel)
              </label>
              <textarea
                rows={2}
                value={videoSourceScript}
                onChange={(e) => setVideoSourceScript(e.target.value)}
                placeholder="Collez un script ou laissez NOVA AI PRO structurer les scènes, plans, voix off et sous-titres..."
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-xs text-white"
              />
            </div>

            {videoError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {videoError}
              </div>
            )}
          </form>

          {storyboard && (
            <VideoStudioCanvas storyboard={storyboard} onChangeStoryboard={setStoryboard} />
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: DOCUMENTS & REAL PDF EXPORT                                        */}
      {/* ========================================================================= */}
      {workspaceTab === 'documents' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-5">
            <form
              onSubmit={handleGenerateDocument}
              className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-4"
            >
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  Générateur de Documents &amp; Export PDF
                </h2>
                <p className="mt-1 text-xs text-[#9E9EB5]">
                  Les informations administratives ou bancaires manquantes ne sont jamais inventées
                  et apparaissent sous la mention <code className="text-[#C4B5FD]">[À COMPLÉTER]</code>.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                  Type de document
                </label>
                <select
                  value={genDocType}
                  onChange={(e) => setGenDocType(e.target.value)}
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                  Titre du document
                </label>
                <input
                  type="text"
                  required
                  value={genDocTitle}
                  onChange={(e) => setGenDocTitle(e.target.value)}
                  placeholder="Ex. Proposition commerciale — Refonte site vitrine"
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                    Votre société (optionnel)
                  </label>
                  <input
                    type="text"
                    value={genDocCompany}
                    onChange={(e) => setGenDocCompany(e.target.value)}
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                    Client / Destinataire (optionnel)
                  </label>
                  <input
                    type="text"
                    value={genDocClient}
                    onChange={(e) => setGenDocClient(e.target.value)}
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#C8C8DA]">
                  Contexte, montants, conditions
                </label>
                <textarea
                  rows={4}
                  required
                  value={genDocContext}
                  onChange={(e) => setGenDocContext(e.target.value)}
                  placeholder="Ex. Prestation de conseil sur 4 semaines, budget 2 400 € HT, livraison en 3 jalons..."
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                />
              </div>

              {genDocError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {genDocError}
                </div>
              )}

              <button
                type="submit"
                disabled={genDocLoading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-50"
              >
                {genDocLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {genDocLoading ? 'Génération...' : 'Générer le document'}
              </button>
            </form>

            {user && savedDocs.length > 0 && (
              <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-2.5">
                <h3 className="font-display text-sm font-semibold text-white">
                  Documents sauvegardés ({savedDocs.length})
                </h3>
                <div className="divide-y divide-[#1E1E2B] max-h-60 overflow-y-auto text-xs">
                  {savedDocs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between gap-2 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setGenDocType(doc.doc_type);
                          setGenDocTitle(doc.title);
                          setGenDocMarkdown(doc.content_markdown);
                          setGenDocEditMode(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate font-semibold text-white hover:text-[#93C5FD]">
                          {doc.title}
                        </p>
                        <p className="text-[#8D8DA4]">{doc.doc_type}</p>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteDocumentApi(doc.id);
                          setSavedDocs((prev) => prev.filter((x) => x.id !== doc.id));
                        }}
                        aria-label="Supprimer ce document"
                        className="p-1 text-[#7D7D96] hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#232332] bg-[#0E0E14] p-5 space-y-4 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F1F2D] pb-3">
              <span className="font-display text-sm font-semibold text-white">
                Aperçu &amp; Export PDF
              </span>
              {genDocMarkdown && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setGenDocEditMode((v) => !v)}
                    className="rounded-lg border border-[#262638] bg-[#14141D] px-2.5 py-1.5 text-xs text-white"
                  >
                    {genDocEditMode ? 'Aperçu' : 'Modifier'}
                  </button>
                  {user && (
                    <button
                      type="button"
                      onClick={() => void handleSaveManualDoc()}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#262638] bg-[#14141D] px-2.5 py-1.5 text-xs text-white"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Sauvegarder
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(genDocMarkdown)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#262638] bg-[#14141D] px-2.5 py-1.5 text-xs text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copier
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportMarkdownToPdf(
                        genDocTitle || genDocType,
                        genDocMarkdown,
                        `${genDocType} · NOVA AI PRO`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2563EB]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Exporter PDF
                  </button>
                </div>
              )}
            </div>

            {docSaveFeedback && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {docSaveFeedback}
              </div>
            )}

            {genDocMarkdown ? (
              genDocEditMode ? (
                <textarea
                  rows={20}
                  value={genDocMarkdown}
                  onChange={(e) => setGenDocMarkdown(e.target.value)}
                  className="w-full rounded-xl border border-[#232332] bg-[#0B0B10] p-4 font-mono text-xs text-[#FAFAFA] focus:border-[#7C3AED] focus:outline-none"
                />
              ) : (
                <MarkdownRenderer content={genDocMarkdown} />
              )
            ) : (
              <p className="py-12 text-sm text-[#9E9EB5]">
                Générez un document professionnel structuré (Facture, Devis, Business Plan,
                Proposition commerciale, Rapport, Présentation ou Email) puis exportez-le en PDF
                en un clic.
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
