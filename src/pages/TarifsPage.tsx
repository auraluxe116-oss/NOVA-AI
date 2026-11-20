import { Check, Cpu, ShieldCheck, Sparkles } from 'lucide-react';
import type { PageView, PublicUser, QuotaSnapshot } from '../types/nova';

interface TarifsPageProps {
  user: PublicUser | null;
  quota: QuotaSnapshot | null;
  onNavigate: (view: PageView) => void;
}

const CAPABILITY_ROWS: Array<{
  feature: string;
  guest: string;
  authenticated: string;
}> = [
  {
    feature: 'Tarif / Facturation',
    guest: '0 € · Sans inscription',
    authenticated: '0 € · Sans carte bancaire',
  },
  {
    feature: 'Assistant IA temps réel (SSE)',
    guest: 'Continu (quotas gratuits Gemini)',
    authenticated: 'Continu (quotas gratuits Gemini)',
  },
  {
    feature: 'Studio Business, Contenu, Vidéo & PDF',
    guest: 'Accès gratuit (quotas Gemini)',
    authenticated: 'Accès gratuit + Sauvegarde',
  },
  {
    feature: 'Suite 18 Modules & Calculateur Marges',
    guest: 'Inclus',
    authenticated: 'Inclus + Historique',
  },
  {
    feature: 'Création entreprise (Logo PNG 1024×1024 + Site HTML)',
    guest: 'Inclus',
    authenticated: 'Inclus + Sauvegarde',
  },
  {
    feature: 'Hébergement de sites web publiés',
    guest: 'Compte gratuit requis',
    authenticated: "Jusqu'à 10 sites en ligne",
  },
  {
    feature: 'Pièces jointes texte (.txt, .md, .csv, .json)',
    guest: "Jusqu'à 512 Ko",
    authenticated: "Jusqu'à 512 Ko",
  },
  {
    feature: 'Studio Vidéo (.webm) & Export PDF client',
    guest: '100 % local (0 € serveur)',
    authenticated: '100 % local (0 € serveur)',
  },
];

export function TarifsPage({ user, quota, onNavigate }: TarifsPageProps) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-3xl text-center space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
          Budget Strict 0 € · NOVA AI
        </p>
        <h1 className="font-display text-3xl font-bold text-[#FAFAFA] sm:text-4xl">
          Plateforme IA 100 % gratuite, sans abonnement ni facturation.
        </h1>
        <p className="text-sm text-[#A8A8BE] sm:text-base">
          NOVA AI fonctionne exclusivement avec des modèles gratuits Google Gemini et des
          générateurs locaux (Canvas PNG, WebM, PDF). Aucune carte bancaire n&apos;est demandée et
          aucun dépassement ne peut déclencher de paiement.
        </p>
      </div>

      {/* Main 0 € Guarantee Banner */}
      <div className="mx-auto mt-8 flex max-w-4xl items-start gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-xs leading-relaxed text-emerald-100">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        <div>
          <p className="font-semibold text-white">Garantie stricte 0 € — Zéro coût caché</p>
          <p className="mt-0.5 text-emerald-100/90">
            NOVA AI n&apos;impose aucun quota commercial artificiel de messages. Lorsque les quotas
            gratuits du moteur Google Gemini ou le débit technique sont atteints (HTTP 429), un
            message clair indique quand réessayer — jamais de bascule payante, ni de prélèvement.
          </p>
        </div>
      </div>

      {/* Two Clear Free Access Cards: Visiteur vs Compte Gratuit */}
      <div className="mx-auto mt-10 grid max-w-5xl gap-6 lg:grid-cols-2">
        {/* Découverte sans compte */}
        <div className="flex flex-col justify-between rounded-xl border border-[#232332] bg-[#111117] p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
              Accès immédiat · Sans inscription
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">VISITEUR</h2>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-white">0 €</span>
              <span className="text-xs text-[#8D8DA4]">/ pour toujours</span>
            </div>
            <p className="mt-2 text-xs text-[#A5A5BB]">
              Utilisez l&apos;assistant IA, les 18 modules business, le studio contenu et le studio
              vidéo sans même créer de compte.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-[#D6D6E6]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Assistant IA continu (selon quotas gratuits Google Gemini)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Accès complet au Studio Business sans blocage artificiel</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Pièces jointes texte jusqu&apos;à 512 Ko &amp; export PDF / WebM</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('assistant')}
            className="mt-8 w-full rounded-lg border border-[#2C2C40] bg-[#171722] py-2.5 text-sm font-semibold text-white hover:border-[#3B82F6] transition-colors"
          >
            Ouvrir l&apos;Assistant IA
          </button>
        </div>

        {/* Compte Gratuit Complet */}
        <div className="flex flex-col justify-between rounded-xl border border-[#7C3AED] bg-[#141122] p-6">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#C4B5FD]">
                Accès complet · Recommandé
              </p>
              <span className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400">
                <Sparkles className="h-3.5 w-3.5" />
                Sans CB
              </span>
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">COMPTE GRATUIT</h2>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-white">0 €</span>
              <span className="text-xs text-[#B5B5CC]">/ sans abonnement</span>
            </div>
            <p className="mt-2 text-xs text-[#B8B8D0]">
              Toutes les fonctionnalités débloquées gratuitement avec sauvegarde de votre historique
              et hébergement de vos sites.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-[#ECECF6]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Discussions continues + mémoire longue automatique sans plafond applicatif</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Studio Business, Création d&apos;entreprise, Vidéo &amp; PDF complets</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Jusqu&apos;à 10 sites internet publiés gratuitement</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Sauvegarde des conversations, entreprises, documents &amp; export RGPD</span>
              </li>
            </ul>

            {quota && (
              <div className="mt-5 rounded-lg border border-[#3B2B68] bg-[#0E0C1A] px-3.5 py-2.5 text-xs text-[#DDD6FE]">
                Activité du jour :{' '}
                <span className="font-mono font-semibold text-white">
                  {quota.chatUsedToday} messages chat
                </span>{' '}
                ·{' '}
                <span className="font-mono font-semibold text-white">
                  {quota.businessUsedToday} générations studio
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigate(user ? 'dashboard' : 'inscription')}
            className="mt-8 w-full rounded-lg bg-[#7C3AED] py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] transition-colors"
          >
            {user ? 'Accès actif · Ouvrir mon espace' : 'Créer un compte gratuit (0 €)'}
          </button>
        </div>
      </div>

      {/* Free Models & Capabilities Matrix */}
      <section className="mx-auto mt-14 max-w-5xl rounded-xl border border-[#232332] bg-[#111117] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F1F2D] px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-white">
            Capacités gratuites (0 €) &amp; modèles utilisés
          </h2>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[#93C5FD]">
            <Cpu className="h-3.5 w-3.5" />
            gemini-4-hydrogen &amp; gemini-3.1-flash-lite
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm tabular-nums">
            <thead>
              <tr className="border-b border-[#232332] bg-[#0E0E14] text-[#FAFAFA]">
                <th className="px-6 py-3 font-semibold">Capacité</th>
                <th className="px-6 py-3 font-semibold">Visiteur (0 €)</th>
                <th className="px-6 py-3 font-semibold text-[#C4B5FD]">Compte Gratuit (0 €)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E1E2B]">
              {CAPABILITY_ROWS.map((row) => (
                <tr key={row.feature} className="hover:bg-[#151520]">
                  <td className="px-6 py-3 font-medium text-[#E8E8F2]">{row.feature}</td>
                  <td className="px-6 py-3 text-[#A5A5BB]">{row.guest}</td>
                  <td className="px-6 py-3 text-[#DDD6FE]">{row.authenticated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-8 space-y-2 text-center text-xs text-[#8E8EA6]">
        <p>
          Les modèles payants et les passerelles de paiement (Stripe) sont intégralement
          désactivés. Aucune facturation ne peut avoir lieu.
        </p>
        <p className="text-[11px] text-[#7D7D96]">
          Consultez nos{' '}
          <button
            type="button"
            onClick={() => onNavigate('cgv')}
            className="text-[#C4B5FD] underline hover:text-white"
          >
            Conditions du service gratuit (0 €)
          </button>
          ,{' '}
          <button
            type="button"
            onClick={() => onNavigate('confidentialite')}
            className="text-[#C4B5FD] underline hover:text-white"
          >
            Politique RGPD
          </button>{' '}
          et{' '}
          <button
            type="button"
            onClick={() => onNavigate('mentions-legales')}
            className="text-[#C4B5FD] underline hover:text-white"
          >
            Mentions légales
          </button>
          .
        </p>
      </div>
    </main>
  );
}
