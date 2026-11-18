import { ArrowRight, Briefcase, Check, FileText, Globe, MessageSquare, ShieldCheck, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { PageView, PublicUser } from '../types/nova';

interface AccueilPageProps {
  user: PublicUser | null;
  onNavigate: (view: PageView) => void;
  onLaunchPrompt: (prompt: string) => void;
}

const EXAMPLE_PROMPTS = [
  'Structure un plan de lancement pour une agence automatisation IA avec 500 € de budget.',
  'Explique simplement la différence entre SASU et EURL en France pour un indépendant.',
  'Rédige une page de vente claire pour un logiciel de gestion destiné aux artisans.',
  'Optimise cette requête SQL PostgreSQL et explique les index à créer.',
];

export function AccueilPage({ user, onNavigate, onLaunchPrompt }: AccueilPageProps) {
  const [quickInput, setQuickInput] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = quickInput.trim();
    if (!cleaned) {
      onNavigate('assistant');
      return;
    }
    onLaunchPrompt(cleaned);
  };

  return (
    <main className="bg-[#08080B]">
      {/* Hero Section */}
      <section className="border-b border-[#1D1D29]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:items-center lg:py-20">
          <div className="lg:col-span-7 space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A78BFA]">
              Plateforme d&apos;intelligence artificielle francophone
            </p>
            <h1 className="font-display text-[clamp(2.25rem,4.4vw,3.75rem)] font-bold leading-[1.06] tracking-tight text-[#FAFAFA]">
              Réfléchir plus vite, analyser sans détour et bâtir des projets solides.
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-[#B2B2C6] sm:text-lg">
              NOVA AI réunit un assistant conversationnel temps réel en streaming, un Mode
              Business structuré en 7 étapes, l&apos;analyse de documents et la vérification
              web avec sources cliquables.
            </p>

            {/* Quick Launch Bar directly wired to live streaming Assistant */}
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-2.5 rounded-xl border border-[#232332] bg-[#111117] p-2 sm:flex-row sm:items-center"
            >
              <input
                type="text"
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                placeholder="Posez une question business, technique, financière ou stratégique..."
                aria-label="Question rapide pour NOVA AI"
                className="w-full bg-transparent px-3.5 py-2.5 text-sm text-[#FAFAFA] placeholder-[#7B7B93] focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] transition-colors whitespace-nowrap shrink-0"
              >
                Demander à NOVA
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            {/* Quick Example Starters */}
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.slice(0, 3).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onLaunchPrompt(prompt)}
                  className="rounded-lg border border-[#232332] bg-[#0D0D13] px-3 py-1.5 text-left text-xs text-[#C2C2D6] hover:border-[#7C3AED]/70 hover:text-white transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigate('assistant')}
                className="inline-flex items-center gap-2 rounded-lg bg-[#FAFAFA] px-5 py-2.5 text-sm font-semibold text-[#08080B] hover:bg-[#E6E6EE] transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquare className="h-4 w-4" />
                Ouvrir l&apos;Assistant IA
              </button>
              <button
                type="button"
                onClick={() => onNavigate('business')}
                className="inline-flex items-center gap-2 rounded-lg border border-[#2B2B3D] bg-[#111117] px-5 py-2.5 text-sm font-medium text-[#FAFAFA] hover:border-[#7C3AED] transition-colors whitespace-nowrap shrink-0"
              >
                <Briefcase className="h-4 w-4 text-[#A78BFA]" />
                Explorer le Mode Business
              </button>
              {!user && (
                <button
                  type="button"
                  onClick={() => onNavigate('tarifs')}
                  className="px-3 py-2 text-sm font-medium text-[#A1A1B5] hover:text-white transition-colors whitespace-nowrap shrink-0"
                >
                  Voir les tarifs
                </button>
              )}
            </div>
          </div>

          {/* Right Architectural Focal Visual */}
          <div className="lg:col-span-5">
            <div className="overflow-hidden rounded-xl border border-[#232332] bg-[#0E0E14]">
              <img
                src="/src/assets/images/nova_hero_abstract_1795010116580.jpg"
                alt="Environnement de travail architectural NOVA AI en noir et violet électrique"
                className="aspect-[16/10] w-full object-cover"
              />
              <div className="border-t border-[#232332] p-5 space-y-3">
                <div className="flex items-center justify-between text-xs text-[#9E9EB5]">
                  <span>Architecture temps réel</span>
                  <span className="font-mono text-[#C4B5FD]">Streaming SSE</span>
                </div>
                <p className="text-sm leading-relaxed text-[#D8D8E6]">
                  Affichage progressif dès les premiers jetons avec bascule automatique de secours
                  en cas de surcharge, pour des échanges fluides sans blocage.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities Asymmetric Grid */}
      <section className="border-b border-[#1D1D29] py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-10 max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A78BFA]">
              Capacités principales
            </p>
            <h2 className="font-display text-2xl font-bold text-[#FAFAFA] sm:text-3xl">
              Conçue pour les décisions concrètes, de la question technique au plan d&apos;entreprise.
            </h2>
          </div>

          <div className="grid gap-5 lg:grid-cols-12">
            <div className="rounded-xl border border-[#232332] bg-[#111117] p-6 lg:col-span-7">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-xs text-[#A78BFA]">01</span>
                <Zap className="h-4 w-4 text-[#8B5CF6]" />
              </div>
              <h3 className="font-display text-xl font-semibold text-white">
                Assistant conversationnel polyvalent &amp; rapide
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[#B5B5C9]">
                Posez vos questions en business, finance, informatique, code, marketing,
                rédaction, sciences ou apprentissage. NOVA comprend les demandes même
                imparfaites et stream la réponse en continu, avec historique complet dans
                votre espace personnel.
              </p>
              <div className="mt-5 grid gap-2 text-xs text-[#D2D2E2] sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-[#8B5CF6]" />
                  Indicateur immédiat « NOVA réfléchit... »
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-[#8B5CF6]" />
                  Réponses progressives en temps réel
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-[#8B5CF6]" />
                  Copie en 1 clic et régénération
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-[#8B5CF6]" />
                  Nouveau chat &amp; reprise d&apos;historique
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#111117] p-6 lg:col-span-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-xs text-[#A78BFA]">02</span>
                <Briefcase className="h-4 w-4 text-[#8B5CF6]" />
              </div>
              <h3 className="font-display text-xl font-semibold text-white">
                Mode Business structuré en 7 étapes
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[#B5B5C9]">
                Chaque projet est cadré avec la même rigueur : objectif, budget réel (même
                à 0 €), outils nécessaires, étapes de réalisation, risques, possibilités de
                revenus sans promesse irréaliste, et plan d&apos;action concret.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('business')}
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#C4B5FD] hover:text-white"
              >
                Ouvrir le Mode Business
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#111117] p-6 lg:col-span-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-xs text-[#A78BFA]">03</span>
                <FileText className="h-4 w-4 text-[#8B5CF6]" />
              </div>
              <h3 className="font-display text-xl font-semibold text-white">
                Analyse de documents texte
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[#B5B5C9]">
                Importez vos fichiers texte, notes, exports CSV, JSON ou Markdown directement
                dans le chat pour obtenir une synthèse, extraire des points clés ou détecter
                des anomalies.
              </p>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#111117] p-6 lg:col-span-7">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-xs text-[#A78BFA]">04</span>
                <Globe className="h-4 w-4 text-[#8B5CF6]" />
              </div>
              <h3 className="font-display text-xl font-semibold text-white">
                Recherche Web et charte de fiabilité
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[#B5B5C9]">
                Activez la vérification web à la demande pour ancrer les réponses récentes sur
                des sources cliquables. NOVA distingue les faits établis des hypothèses et
                n&apos;invente jamais d&apos;information lorsqu&apos;une donnée manque.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Reliability Charter & Conversion */}
      <section className="py-16">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#A78BFA]">
              <ShieldCheck className="h-4 w-4" />
              Engagement de transparence
            </div>
            <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
              Une IA utile dit aussi quand elle ne sait pas.
            </h2>
            <p className="text-sm leading-relaxed text-[#B5B5C9] sm:text-base">
              Contrairement aux outils qui comblent les vides par des suppositions, NOVA AI
              est configurée pour signaler l&apos;incertitude, corriger ses erreurs lorsqu&apos;on les
              relève et exclure toute promesse financière artificielle dans ses plans business.
            </p>
          </div>
          <div className="lg:col-span-5 rounded-xl border border-[#232332] bg-[#111117] p-6">
            <h3 className="font-display text-lg font-semibold text-white">
              Commencer dès maintenant
            </h3>
            <p className="mt-1.5 text-sm text-[#A5A5BB]">
              Testez gratuitement l&apos;assistant ou créez un compte pour sauvegarder vos
              conversations et projets business.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate(user ? 'dashboard' : 'inscription')}
                className="rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] transition-colors"
              >
                {user ? 'Accéder au tableau de bord' : 'Créer un compte gratuit'}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('tarifs')}
                className="rounded-lg border border-[#2B2B3D] bg-[#171721] px-4 py-2.5 text-sm font-medium text-[#E4E4F0] hover:border-[#7C3AED]"
              >
                Comparer les formules
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
