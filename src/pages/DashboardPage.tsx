import {
  ArrowRight,
  Briefcase,
  Building2,
  CreditCard,
  ExternalLink,
  FileText,
  History,
  MessageSquare,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DashboardData, PageView, PublicUser } from '../types/nova';
import { fetchDashboard } from '../utils/api';

interface DashboardPageProps {
  user: PublicUser | null;
  checkoutStatus?: string | null;
  onNavigate: (view: PageView) => void;
  onOpenConversation: (conversationId: string) => void;
  onOpenBusinessProject?: (projectId: string) => void;
}

export function DashboardPage({
  user,
  checkoutStatus,
  onNavigate,
  onOpenConversation,
  onOpenBusinessProject,
}: DashboardPageProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchDashboard()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Erreur de chargement.');
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center space-y-4">
        <h1 className="font-display text-2xl font-bold text-white">Tableau de bord</h1>
        <p className="text-sm text-[#A6A6BC]">
          Connectez-vous pour accéder à vos statistiques d&apos;utilisation, vos entreprises
          créées, vos sites publiés et vos documents.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('connexion')}
          className="rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9]"
        >
          Se connecter
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#1F1F2D] pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
            Espace Utilisateur · NOVA AI PRO
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-[#FAFAFA]">
            Bonjour, {user.displayName}
          </h1>
          <p className="mt-1 text-sm text-[#A5A5BB]">
            Vue d&apos;ensemble isolée de votre activité, vos entreprises créées et vos documents.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('assistant')}
            className="inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9] whitespace-nowrap shrink-0"
          >
            <MessageSquare className="h-4 w-4" />
            Nouveau chat
          </button>
          <button
            type="button"
            onClick={() => onNavigate('business')}
            className="inline-flex items-center gap-2 rounded-lg border border-[#2B2B3D] bg-[#111117] px-4 py-2 text-sm font-medium text-white hover:border-[#3B82F6] whitespace-nowrap shrink-0"
          >
            <Briefcase className="h-4 w-4 text-[#3B82F6]" />
            Studio Business
          </button>
        </div>
      </div>

      {checkoutStatus === 'success' && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          Paiement confirmé par Stripe. Si votre formule ne reflète pas encore la mise à jour,
          rafraîchissez dans quelques secondes le temps du traitement webhook.
        </div>
      )}

      {user.subscriptionStatus === 'past_due' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-100">
          <span>
            Votre paiement Stripe est en attente ou a échoué : les avantages PRO/BUSINESS sont
            temporairement suspendus.
          </span>
          <button
            type="button"
            onClick={() => onNavigate('profil')}
            className="rounded-md bg-amber-500 px-3 py-1.5 font-semibold text-black"
          >
            Régulariser dans Profil
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-[#232332] bg-[#111117]"
            />
          ))}
        </div>
      ) : (
        <>
          {/* Real Metrics Strip */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <p className="text-xs text-[#9E9EB5]">Formule active</p>
              <p className="mt-2 font-display text-2xl font-bold text-white uppercase">
                {data.user.effectivePlan}
              </p>
              <p className="mt-1 text-xs text-[#93C5FD]">
                {data.user.subscriptionStatus === 'active'
                  ? data.user.cancelAtPeriodEnd
                    ? 'Actif (résiliation programmée)'
                    : 'Actif (Stripe)'
                  : 'Offre Gratuite'}
              </p>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <p className="text-xs text-[#9E9EB5]">Messages envoyés</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">
                {data.stats.messagesToday}{' '}
                <span className="text-xs font-normal text-[#8D8DA4]">aujourd&apos;hui</span>
              </p>
              <p className="mt-1 text-xs text-[#8D8DA4]">
                Total cumulé :{' '}
                <span className="font-mono tabular-nums text-[#D4D4E6]">
                  {data.stats.totalMessages}
                </span>{' '}
                · Sans plafond NOVA
              </p>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <p className="text-xs text-[#9E9EB5]">Entreprises &amp; Sites publiés</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">
                {data.stats.totalCompanyCreations}{' '}
                <span className="text-xs font-normal text-[#8D8DA4]">
                  · {data.stats.totalPublishedSites} en ligne
                </span>
              </p>
              <button
                type="button"
                onClick={() => onNavigate('business')}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#93C5FD] hover:text-white"
              >
                Ouvrir le studio
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <p className="text-xs text-[#9E9EB5]">Documents &amp; Analyses</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">
                {data.stats.totalDocuments + data.stats.totalBusinessProjects}
              </p>
              <p className="mt-1 text-xs text-[#8D8DA4]">
                {data.stats.totalDocuments} docs PDF · {data.stats.totalBusinessProjects} analyses
              </p>
            </div>
          </div>

          {/* Two Columns: Conversations & Business / Companies */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-[#A78BFA]" />
                  <h2 className="font-display text-base font-semibold text-white">
                    Conversations récentes ({data.stats.totalConversations})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('historique')}
                  className="text-xs font-medium text-[#C4B5FD] hover:text-white"
                >
                  Tout voir
                </button>
              </div>

              {data.recentConversations.length === 0 ? (
                <div className="rounded-lg border border-[#1E1E2B] bg-[#0B0B10] p-5 text-center text-xs text-[#9E9EB5]">
                  <p>Aucune conversation pour le moment.</p>
                  <button
                    type="button"
                    onClick={() => onNavigate('assistant')}
                    className="mt-3 rounded-md bg-[#7C3AED] px-3.5 py-1.5 font-semibold text-white"
                  >
                    Démarrer une discussion
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-[#1E1E2B]">
                  {data.recentConversations.map((conv) => (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => onOpenConversation(conv.id)}
                      className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-[#161620] px-2 rounded-md transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{conv.title}</p>
                        <p className="truncate text-xs text-[#8D8DA4]">
                          {conv.last_message_preview || 'Conversation sans aperçu'}
                        </p>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-[#9E9EB5] shrink-0">
                        {new Date(conv.updated_at).toLocaleDateString('fr-FR')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-[#232332] bg-[#111117] p-5 space-y-5">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-[#3B82F6]" />
                    <h2 className="font-display text-base font-semibold text-white">
                      Entreprises &amp; Sites publiés
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('business')}
                    className="text-xs font-medium text-[#93C5FD] hover:text-white"
                  >
                    Créer / Gérer
                  </button>
                </div>

                {data.publishedSites.length === 0 && data.recentCompanyCreations.length === 0 ? (
                  <p className="rounded-lg border border-[#1E1E2B] bg-[#0B0B10] p-4 text-xs text-[#9E9EB5]">
                    Aucune entreprise créée ni site publié pour l&apos;instant.
                  </p>
                ) : (
                  <div className="divide-y divide-[#1E1E2B] text-xs">
                    {data.publishedSites.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">{s.title}</p>
                          <p className="truncate font-mono text-[11px] text-[#8D8DA4]">
                            /sites/{s.slug}
                          </p>
                        </div>
                        <a
                          href={`/sites/${s.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-[#3B82F6]/20 border border-[#3B82F6]/40 px-2.5 py-1 font-medium text-[#93C5FD] hover:bg-[#3B82F6]/30 shrink-0"
                        >
                          Ouvrir
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-[#A78BFA]" />
                    <h2 className="font-display text-base font-semibold text-white">
                      Analyses Business &amp; Documents
                    </h2>
                  </div>
                </div>

                {data.recentProjects.length === 0 && data.recentDocuments.length === 0 ? (
                  <p className="rounded-lg border border-[#1E1E2B] bg-[#0B0B10] p-4 text-xs text-[#9E9EB5]">
                    Aucun document ou analyse généré pour le moment.
                  </p>
                ) : (
                  <div className="divide-y divide-[#1E1E2B]">
                    {data.recentProjects.slice(0, 4).map((proj) => (
                      <button
                        key={proj.id}
                        type="button"
                        onClick={() =>
                          onOpenBusinessProject
                            ? onOpenBusinessProject(proj.id)
                            : onNavigate('business')
                        }
                        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left hover:bg-[#161620]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{proj.title}</p>
                          <p className="truncate text-xs text-[#8D8DA4]">
                            {proj.sector} · {proj.budget_eur} €
                          </p>
                        </div>
                        <span className="font-mono text-xs tabular-nums text-[#9E9EB5] shrink-0">
                          {new Date(proj.created_at).toLocaleDateString('fr-FR')}
                        </span>
                      </button>
                    ))}
                    {data.recentDocuments.slice(0, 3).map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-3 px-2 py-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-3.5 w-3.5 text-[#93C5FD] shrink-0" />
                          <span className="truncate text-white font-medium">{doc.title}</span>
                        </div>
                        <span className="text-[#8D8DA4] shrink-0">{doc.doc_type}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {data.user.effectivePlan === 'free' && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[#3B2B68] bg-[#161226] p-3.5 text-xs">
                  <div className="flex items-center gap-2 text-[#E0D6FF]">
                    <CreditCard className="h-4 w-4 text-[#A78BFA]" />
                    <span>Passez à PRO ou BUSINESS pour plus de sites publiés et pièces jointes.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('tarifs')}
                    className="rounded-md bg-[#7C3AED] px-3 py-1.5 font-semibold text-white whitespace-nowrap shrink-0"
                  >
                    Voir les tarifs
                  </button>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
