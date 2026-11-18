import { Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { PageView, PublicUser, QuotaSnapshot } from '../types/nova';
import { ApiError, loginUser, registerUser } from '../utils/api';

interface AuthPagesProps {
  mode: 'connexion' | 'inscription';
  onNavigate: (view: PageView) => void;
  onAuthSuccess: (user: PublicUser, quota: QuotaSnapshot) => void;
}

export function AuthPages({ mode, onNavigate, onAuthSuccess }: AuthPagesProps) {
  const isRegister = mode === 'inscription';
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isRegister) {
        const res = await registerUser({
          email,
          password,
          displayName,
          companyName,
        });
        onAuthSuccess(res.user, res.quota);
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

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4 py-12">
      <div className="w-full rounded-xl border border-[#232332] bg-[#111117] p-6 sm:p-8">
        <div className="mb-6 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A78BFA]">
            Espace sécurisé NOVA AI
          </p>
          <h1 className="font-display text-2xl font-bold text-[#FAFAFA]">
            {isRegister ? 'Créer un compte' : 'Connexion'}
          </h1>
          <p className="text-xs text-[#9E9EB5]">
            {isRegister
              ? 'Démarrez gratuitement avec 15 messages par jour et votre historique sauvegardé.'
              : 'Retrouvez vos conversations, vos projets business et votre abonnement.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
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

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#D2D2E2]">
              Mot de passe
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-[#7D7D96]" />
              <input
                type={showPwd ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isRegister ? '8 caractères minimum' : 'Votre mot de passe'}
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
              : isRegister
              ? 'Créer mon compte'
              : 'Se connecter'}
          </button>
        </form>

        <div className="mt-6 border-t border-[#1F1F2D] pt-4 text-center text-xs text-[#9E9EB5]">
          {isRegister ? (
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
      </div>
    </main>
  );
}
