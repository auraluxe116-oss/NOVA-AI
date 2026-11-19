import { Check, Copy, Eye, EyeOff, KeyRound, Lock, Mail, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { PageView, PublicUser, QuotaSnapshot } from '../types/nova';
import { ApiError, loginUser, registerUser, resetPasswordApi } from '../utils/api';

interface AuthPagesProps {
  mode: 'connexion' | 'inscription';
  onNavigate: (view: PageView) => void;
  onAuthSuccess: (user: PublicUser, quota: QuotaSnapshot) => void;
}

export function AuthPages({ mode, onNavigate, onAuthSuccess }: AuthPagesProps) {
  const isRegister = mode === 'inscription';
  const [resetMode, setResetMode] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);

  const [pendingAuth, setPendingAuth] = useState<{
    user: PublicUser;
    quota: QuotaSnapshot;
    recoveryCode: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetSuccessMsg(null);
    setSubmitting(true);

    try {
      if (resetMode) {
        const res = await resetPasswordApi({
          email,
          recoveryCode: recoveryCodeInput,
          newPassword: password,
        });
        setResetSuccessMsg(
          `${res.message} Nouveau code de récupération à conserver : ${res.nextRecoveryCode}`
        );
        setResetMode(false);
        setPassword('');
        setRecoveryCodeInput('');
      } else if (isRegister) {
        const res = await registerUser({
          email,
          password,
          displayName,
          companyName,
        });
        if (res.recoveryCode) {
          setPendingAuth({
            user: res.user,
            quota: res.quota,
            recoveryCode: res.recoveryCode,
          });
        } else {
          onAuthSuccess(res.user, res.quota);
        }
      } else {
        const res = await loginUser({ email, password });
        onAuthSuccess(res.user, res.quota);
      }
    } catch (err) {
      const msg =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Une erreur est survenue lors de l’authentification.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingAuth) {
    return (
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4 py-12">
        <div className="w-full rounded-xl border border-[#3B82F6]/50 bg-[#111117] p-6 sm:p-8 space-y-5">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
              Compte créé avec succès
            </p>
            <h1 className="font-display text-2xl font-bold text-[#FAFAFA]">
              Conservez votre code de récupération
            </h1>
            <p className="text-xs leading-relaxed text-[#A6A6BC]">
              Ce code unique permet de réinitialiser votre mot de passe sans serveur email.
              Enregistrez-le dans un endroit sûr : il ne sera plus affiché.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-[#2C2C40] bg-[#08080B] px-4 py-3">
            <code className="font-mono text-base font-bold tracking-wider text-[#93C5FD]">
              {pendingAuth.recoveryCode}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(pendingAuth.recoveryCode);
                setCopiedCode(true);
                setTimeout(() => setCopiedCode(false), 1800);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[#2C2C40] bg-[#171722] px-2.5 py-1.5 text-xs font-medium text-white hover:border-[#3B82F6]"
            >
              {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCode ? 'Copié' : 'Copier'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => onAuthSuccess(pendingAuth.user, pendingAuth.quota)}
            className="w-full rounded-lg bg-[#7C3AED] py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9]"
          >
            J&apos;ai sauvegardé mon code — Accéder à mon espace
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4 py-12">
      <div className="w-full rounded-xl border border-[#232332] bg-[#111117] p-6 sm:p-8">
        <div className="mb-6 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
            Espace sécurisé NOVA AI PRO
          </p>
          <h1 className="font-display text-2xl font-bold text-[#FAFAFA]">
            {resetMode
              ? 'Réinitialiser le mot de passe'
              : isRegister
              ? 'Créer un compte'
              : 'Connexion'}
          </h1>
          <p className="text-xs text-[#9E9EB5]">
            {resetMode
              ? 'Utilisez votre e-mail et le code de récupération remis lors de votre inscription.'
              : isRegister
              ? 'Démarrez gratuitement sans limite artificielle de messages, avec historique et projets sauvegardés.'
              : 'Retrouvez vos conversations, vos entreprises créées, vos documents et votre abonnement.'}
          </p>
        </div>

        {resetSuccessMsg && (
          <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-200 break-words">
            {resetSuccessMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && !resetMode && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#D2D2E2]">
                  Nom complet
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-[#7D7D96]" />
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Camille Laurent"
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] py-2.5 pr-3.5 pl-9 text-sm text-white placeholder-[#6A6A82] focus:border-[#7C3AED] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#D2D2E2]">
                  Entreprise ou projet (optionnel)
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex. Studio Horizon"
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2.5 text-sm text-white placeholder-[#6A6A82] focus:border-[#7C3AED] focus:outline-none"
                />
              </div>
            </>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#D2D2E2]">
              Adresse e-mail
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-[#7D7D96]" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.fr"
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] py-2.5 pr-3.5 pl-9 text-sm text-white placeholder-[#6A6A82] focus:border-[#7C3AED] focus:outline-none"
              />
            </div>
          </div>

          {resetMode && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#D2D2E2]">
                Code de récupération
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-[#7D7D96]" />
                <input
                  type="text"
                  required
                  value={recoveryCodeInput}
                  onChange={(e) => setRecoveryCodeInput(e.target.value)}
                  placeholder="Ex. ABCD-EF12-3456"
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] py-2.5 pr-3.5 pl-9 font-mono text-sm uppercase text-white placeholder-[#6A6A82] focus:border-[#7C3AED] focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-medium text-[#D2D2E2]">
                {resetMode ? 'Nouveau mot de passe' : 'Mot de passe'}
              </label>
              {!isRegister && !resetMode && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setResetMode(true);
                  }}
                  className="text-[11px] font-medium text-[#93C5FD] hover:text-white"
                >
                  Mot de passe oublié ?
                </button>
              )}
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-[#7D7D96]" />
              <input
                type={showPwd ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isRegister || resetMode ? '8 caractères minimum' : 'Votre mot de passe'}
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] py-2.5 pr-10 pl-9 text-sm text-white placeholder-[#6A6A82] focus:border-[#7C3AED] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPwd((prev) => !prev)}
                aria-label={showPwd ? 'Masquer' : 'Afficher'}
                className="absolute top-2.5 right-3 text-[#7D7D96] hover:text-white"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[#7C3AED] py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-50 transition-colors"
          >
            {submitting
              ? 'Vérification...'
              : resetMode
              ? 'Réinitialiser mon mot de passe'
              : isRegister
              ? 'Créer mon compte'
              : 'Se connecter'}
          </button>
        </form>

        <div className="mt-6 border-t border-[#1F1F2D] pt-4 text-center text-xs text-[#9E9EB5] space-y-2.5">
          <div>
            {resetMode ? (
              <button
                type="button"
                onClick={() => {
                  setResetMode(false);
                  setError(null);
                }}
                className="font-semibold text-[#C4B5FD] hover:text-white"
              >
                Retour à la connexion
              </button>
            ) : isRegister ? (
              <>
                Déjà inscrit ?{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('connexion')}
                  className="font-semibold text-[#C4B5FD] hover:text-white"
                >
                  Se connecter
                </button>
              </>
            ) : (
              <>
                Pas encore de compte ?{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('inscription')}
                  className="font-semibold text-[#C4B5FD] hover:text-white"
                >
                  Créer un compte gratuit
                </button>
              </>
            )}
          </div>
          <p className="text-[11px] text-[#7D7D96]">
            En utilisant NOVA AI PRO, vous acceptez nos{' '}
            <button
              type="button"
              onClick={() => onNavigate('confidentialite')}
              className="text-[#9E9EB5] underline hover:text-white"
            >
              règles de confidentialité (RGPD)
            </button>{' '}
            et{' '}
            <button
              type="button"
              onClick={() => onNavigate('mentions-legales')}
              className="text-[#9E9EB5] underline hover:text-white"
            >
              mentions légales
            </button>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
