import { AlertCircle, ArrowRight, Briefcase, CheckCircle2, Clock, MessageSquare, ShieldAlert, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BillingInterval, PageView, PlanTier, PublicUser, QuotaSnapshot } from '../types/nova';
import { ApiError, verifyStripeCheckoutSession } from '../utils/api';

interface PaymentSuccessPageProps {
  user: PublicUser | null;
  sessionId: string | null;
  onNavigate: (view: PageView) => void;
  onVerified: (user: PublicUser, quota: QuotaSnapshot) => void;
}

export function PaymentSuccessPage({
  user,
  sessionId,
  onNavigate,
  onVerified,
}: PaymentSuccessPageProps) {
  const [status, setStatus] = useState<'verifying' | 'paid' | 'pending' | 'error'>('verifying');
  const [verifiedPlan, setVerifiedPlan] = useState<PlanTier | null>(null);
  const [verifiedInterval, setVerifiedInterval] = useState<BillingInterval>('monthly');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setStatus('error');
      setErrorMsg('Connectez-vous à votre compte pour finaliser la vérification Stripe.');
      return;
    }
    if (!sessionId) {
      setStatus('error');
      setErrorMsg(
        'Identifiant de session Stripe absent. Vérifiez le statut de votre abonnement dans votre Profil.'
      );
      return;
    }

    let cancelled = false;
    setStatus('verifying');

    void verifyStripeCheckoutSession(sessionId)
      .then((res) => {
        if (cancelled) return;
        if (res.verified) {
          setVerifiedPlan(res.plan);
          setVerifiedInterval(res.interval);
          setStatus('paid');
          onVerified(res.user, res.quota);
        } else {
          setStatus('pending');
          setErrorMsg(
            `Paiement non encore confirmé par Stripe (statut : ${res.paymentStatus}). Les fonctionnalités payantes resteront bloquées tant que le paiement n'est pas réglé.`
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Impossible de vérifier le paiement auprès de Stripe.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, sessionId]);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-2xl items-center px-4 py-14 sm:px-6">
      <div className="w-full rounded-xl border border-[#232332] bg-[#111117] p-6 sm:p-8 space-y-6">
        {status === 'verifying' && (
          <div className="space-y-4 text-center py-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#3B2B68] bg-[#17132A]">
              <Clock className="h-6 w-6 animate-pulse text-[#A78BFA]" />
            </div>
            <h1 className="font-display text-2xl font-bold text-white">
              Vérification du paiement Stripe en cours...
            </h1>
            <p className="text-sm text-[#A5A5BB]">
              NOVA AI contrôle la confirmation réelle de votre transaction auprès de Stripe
              avant d&apos;activer votre formule.
            </p>
          </div>
        )}

        {status === 'paid' && (
          <>
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">
                  Paiement confirmé par Stripe
                </p>
                <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">
                  Votre abonnement {(verifiedPlan ?? 'pro').toUpperCase()} est actif
                </h1>
                <p className="text-sm text-[#B2B2C6]">
                  Facturation {verifiedInterval === 'annual' ? 'annuelle' : 'mensuelle'} enregistrée
                  sur votre compte. Toutes les fonctionnalités correspondantes sont maintenant
                  débloquées.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[#232332] bg-[#0B0B10] p-4 text-xs space-y-2 text-[#D4D4E4]">
              <div className="flex items-center justify-between">
                <span className="text-[#9E9EB5]">Formule activée</span>
                <span className="font-display font-bold uppercase text-white">
                  NOVA AI {(verifiedPlan ?? 'pro').toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9E9EB5]">Statut</span>
                <span className="font-mono text-emerald-400">Actif &amp; vérifié</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9E9EB5]">Gestion &amp; résiliation</span>
                <span>Disponible à tout moment depuis votre Profil</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate('assistant')}
                className="inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9]"
              >
                <MessageSquare className="h-4 w-4" />
                Lancer l&apos;Assistant IA
              </button>
              <button
                type="button"
                onClick={() => onNavigate('business')}
                className="inline-flex items-center gap-2 rounded-lg border border-[#2C2C40] bg-[#171722] px-4 py-2.5 text-sm font-medium text-white hover:border-[#7C3AED]"
              >
                <Briefcase className="h-4 w-4 text-[#A78BFA]" />
                Ouvrir Mode Business
              </button>
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-[#B8B8CE] hover:text-white"
              >
                Tableau de bord
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {(status === 'pending' || status === 'error') && (
          <>
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15">
                <ShieldAlert className="h-6 w-6 text-amber-400" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">
                  Confirmation en attente ou impossible
                </p>
                <h1 className="font-display text-2xl font-bold text-white">
                  Abonnement non activé automatiquement
                </h1>
                <p className="text-sm text-[#B2B2C6]">{errorMsg}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigate(user ? 'profil' : 'connexion')}
                className="rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9]"
              >
                {user ? 'Vérifier mon Profil' : 'Se connecter'}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('tarifs')}
                className="rounded-lg border border-[#2C2C40] bg-[#171722] px-4 py-2.5 text-sm font-medium text-white hover:border-[#7C3AED]"
              >
                Retour aux Tarifs
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

interface PaymentFailurePageProps {
  user: PublicUser | null;
  onNavigate: (view: PageView) => void;
}

export function PaymentFailurePage({ user, onNavigate }: PaymentFailurePageProps) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-2xl items-center px-4 py-14 sm:px-6">
      <div className="w-full rounded-xl border border-[#232332] bg-[#111117] p-6 sm:p-8 space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/15">
            <XCircle className="h-6 w-6 text-red-400" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-400">
              Paiement annulé ou non finalisé
            </p>
            <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">
              Le paiement n&apos;a pas été effectué
            </h1>
            <p className="text-sm text-[#B2B2C6]">
              La session de paiement Stripe a été interrompue ou refusée. Aucun montant n&apos;a
              été débité et votre formule actuelle reste inchangée.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-[#232332] bg-[#0B0B10] p-4 text-xs text-[#C6C6D8]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
          <span>
            Si votre banque a refusé l&apos;opération ou si vous avez annulé par erreur, vous
            pouvez relancer votre souscription à tout moment depuis la page Tarifs.
          </span>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onNavigate('tarifs')}
            className="rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9]"
          >
            Réessayer sur Tarifs
          </button>
          <button
            type="button"
            onClick={() => onNavigate(user ? 'dashboard' : 'accueil')}
            className="rounded-lg border border-[#2C2C40] bg-[#171722] px-5 py-2.5 text-sm font-medium text-white hover:border-[#7C3AED]"
          >
            {user ? 'Tableau de bord' : "Retour à l'accueil"}
          </button>
        </div>
      </div>
    </main>
  );
}
