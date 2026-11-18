import { ArrowRight, Briefcase, CreditCard, History, MessageSquare } from 'lucide-react';
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
          Connectez-vous pour accéder à vos statistiques d&apos;utilisation, votre abonnement et
          vos projets enregistrés.
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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A78BFA]">
            Tableau de bord SaaS
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-[#FAFAFA]">
            Bonjour, {user.displayName}
          </h1>
          <p className="mt-1 text-sm text-[#A5A5BB]">
            Vue d&apos;ensemble de votre activité NOVA AI et de votre formule active.
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
            className="inline-flex items-center gap-2 rounded-lg border border-[#2B2B3D] bg-[#111117] px-4 py-2 text-sm font-medium text-white hover:border-[#7C3AED] whitespace-nowrap shrink-0"
          >
            <Briefcase className="h-4 w-4 text-[#A78BFA]" />
            Mode Business
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
            Votre paiement Stripe est en attente ou a échoué : les fonctionnalités PRO/BUSINESS
            sont temporairement bloquées.
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
              <p className="mt-1 text-xs text-[#A78BFA]">
                Statut :{' '}
                {data.user.subscriptionStatus === 'active'
                  ? data.user.cancelAtPeriodEnd
                    ? 'Actif (résiliation programmée)'
                    : 'Actif (Stripe)'
                  : data.user.effectivePlan === 'free' && data.user.subscriptionStatus === 'inactive'
                  ? 'Offre Gratuite'
                  : data.user.subscriptionStatus}
              </p>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <p className="text-xs text-[#9E9EB5]">Messages aujourd&apos;hui</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">
                {data.stats.messagesToday} / {data.quota.chatLimit}
              </p>
              <p className="mt-1 text-xs text-[#8D8DA4]">
                Total cumulé :{' '}
                <span className="font-mono tabular-nums">{data.stats.totalMessages}</span>
              </p>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <p className="text-xs text-[#9E9EB5]">Conversations sauvegardées</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">
                {data.stats.totalConversations}
              </p>
              <button
                type="button"
                onClick={() => onNavigate('historique')}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#C4B5FD] hover:text-white"
              >
                Ouvrir l&apos;historique
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <p className="text-xs text-[#9E9EB5]">Projets Mode Business</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">
                {data.stats.totalBusinessProjects}
              </p>
              <p className="mt-1 text-xs text-[#8D8DA4]">
                Analyses du jour :{' '}
                <span className="font-mono tabular-nums">
                  {data.stats.businessToday}/{data.quota.businessLimit}
                </span>
              </p>
            </div>
          </div>

          {/* Two Columns: Recent Conversations & Business Projects */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-[#A78BFA]" />
                  <h2 className="font-display text-base font-semibold text-white">
                    Conversations récentes
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

            <section className="rounded-xl border border-[#232332] bg-[#111117] p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-[#A78BFA]" />
                  <h2 className="font-display text-base font-semibold text-white">
                    Projets Mode Business récents
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('business')}
                  className="text-xs font-medium text-[#C4B5FD] hover:text-white"
                >
                  Ouvrir Mode Business
                </button>
              </div>

              {data.recentProjects.length === 0 ? (
                <div className="rounded-lg border border-[#1E1E2B] bg-[#0B0B10] p-5 text-center text-xs text-[#9E9EB5]">
                  <p>Aucun plan business généré pour l&apos;instant.</p>
                  <button
                    type="button"
                    onClick={() => onNavigate('business')}
                    className="mt-3 rounded-md bg-[#7C3AED] px-3.5 py-1.5 font-semibold text-white"
                  >
                    Structurer un projet
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-[#1E1E2B]">
                  {data.recentProjects.map((proj) => (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() =>
                        onOpenBusinessProject
                          ? onOpenBusinessProject(proj.id)
                          : onNavigate('business')
                      }
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-3 text-left hover:bg-[#161620] transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{proj.title}</p>
                        <p className="truncate text-xs text-[#8D8DA4]">
                          {proj.sector} • Budget{' '}
                          <span className="font-mono tabular-nums">{proj.budget_eur} €</span>
                        </p>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-[#9E9EB5] shrink-0">
                        {new Date(proj.created_at).toLocaleDateString('fr-FR')}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {data.user.effectivePlan === 'free' && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[#3B2B68] bg-[#161226] p-3.5 text-xs">
                  <div className="flex items-center gap-2 text-[#E0D6FF]">
                    <CreditCard className="h-4 w-4 text-[#A78BFA]" />
                    <span>Passez à PRO ou BUSINESS pour débloquer tous les modules.</span>
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
