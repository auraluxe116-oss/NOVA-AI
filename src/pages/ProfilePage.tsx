import {
  CheckCircle2,
  Download,
  KeyRound,
  LogOut,
  Save,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  AIProviderId,
  AIProviderInfo,
  ExperienceLevel,
  PageView,
  PublicUser,
  QuotaSnapshot,
} from '../types/nova';
import {
  ApiError,
  deleteAccountApi,
  exportUserDataApi,
  fetchAIProviders,
  logoutUser,
  updateProfile,
} from '../utils/api';

interface ProfilePageProps {
  user: PublicUser | null;
  quota: QuotaSnapshot | null;
  onNavigate: (view: PageView) => void;
  onUserUpdated: (user: PublicUser, quota: QuotaSnapshot) => void;
  onLoggedOut: () => void;
}

export function ProfilePage({
  user,
  quota,
  onNavigate,
  onUserUpdated,
  onLoggedOut,
}: ProfilePageProps) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [companyName, setCompanyName] = useState(user?.companyName ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Preferences
  const [defaultExp, setDefaultExp] = useState<ExperienceLevel>(
    user?.preferences?.defaultExperience || 'debutant'
  );
  const [preferredProvider, setPreferredProvider] = useState<AIProviderId>('gemini');
  const [preferredModel, setPreferredModel] = useState(
    user?.preferences?.preferredModel || 'gemini-4-hydrogen'
  );
  const [autoWebSearch, setAutoWebSearch] = useState(Boolean(user?.preferences?.autoWebSearch));
  const [providers, setProviders] = useState<AIProviderInfo[]>([]);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);

  // Account export & deletion (GDPR)
  const [exportingData, setExportingData] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setCompanyName(user?.companyName ?? '');
    setDefaultExp(user?.preferences?.defaultExperience || 'debutant');
    setPreferredProvider('gemini');
    setPreferredModel(user?.preferences?.preferredModel || 'gemini-4-hydrogen');
    setAutoWebSearch(Boolean(user?.preferences?.autoWebSearch));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void fetchAIProviders()
      .then((res) => setProviders(res.providers))
      .catch(() => setProviders([]));
  }, [user?.id]);

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center space-y-4">
        <h1 className="font-display text-2xl font-bold text-white">Profil utilisateur</h1>
        <p className="text-sm text-[#A6A6BC]">
          Connectez-vous pour gérer vos informations personnelles, vos préférences IA et vos quotas
          gratuits.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('connexion')}
          className="rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Se connecter
        </button>
      </main>
    );
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const res = await updateProfile({
        displayName,
        companyName,
        currentPassword: newPassword ? currentPassword : undefined,
        newPassword: newPassword || undefined,
        preferences: {
          defaultExperience: defaultExp,
          preferredProvider,
          preferredModel,
          autoWebSearch,
        },
      });
      onUserUpdated(res.user, res.quota);
      setCurrentPassword('');
      setNewPassword('');
      setMessage('Profil et préférences enregistrés.');
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible de mettre à jour le profil.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateRecoveryCode = async () => {
    setError(null);
    setNewRecoveryCode(null);
    try {
      const res = await updateProfile({ regenerateRecoveryCode: true });
      onUserUpdated(res.user, res.quota);
      if (res.recoveryCode) {
        setNewRecoveryCode(res.recoveryCode);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur génération code.');
    }
  };

  const handleExportMyData = async () => {
    setExportingData(true);
    setError(null);
    try {
      const payload = await exportUserDataApi();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nova-ai-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Impossible d'exporter vos données."
      );
    } finally {
      setExportingData(false);
    }
  };

  const handleDeleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    setDeleteError(null);
    setDeletingAccount(true);
    try {
      await deleteAccountApi(deletePassword);
      onLoggedOut();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible de supprimer le compte.'
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    onLoggedOut();
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1F1F2D] pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
            Paramètres, Préférences &amp; Compte
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-white">
            Profil utilisateur
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="inline-flex items-center gap-2 rounded-lg border border-[#2C2C40] bg-[#111117] px-4 py-2 text-sm font-medium text-[#E0E0EE] hover:border-red-500/60 hover:text-red-200"
        >
          <LogOut className="h-4 w-4" />
          Déconnexion
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-6">
          <form
            onSubmit={handleSave}
            className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-4"
          >
            <h2 className="font-display text-lg font-semibold text-white">
              Informations personnelles
            </h2>

            <div>
              <label className="mb-1 block text-xs text-[#9E9EB5]">Adresse e-mail</label>
              <input
                type="email"
                disabled
                value={user.email}
                className="w-full rounded-lg border border-[#232332] bg-[#0B0B10] px-3.5 py-2.5 text-sm text-[#8D8DA4]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[#C8C8DA]">Nom complet</label>
              <input
                type="text"
                required
                minLength={2}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2.5 text-sm text-white focus:border-[#7C3AED] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[#C8C8DA]">Entreprise / Activité</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ex. Conseil Indépendant"
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2.5 text-sm text-white focus:border-[#7C3AED] focus:outline-none"
              />
            </div>

            {/* Preferences */}
            <div className="border-t border-[#1F1F2D] pt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#3B82F6]" />
                Préférences IA &amp; Business (0 €)
              </div>

              <div>
                <label className="mb-1 block text-xs text-[#C8C8DA]">
                  Niveau business par défaut
                </label>
                <select
                  value={defaultExp}
                  onChange={(e) => setDefaultExp(e.target.value as ExperienceLevel)}
                  className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                >
                  <option value="debutant">Débutant</option>
                  <option value="intermediaire">Intermédiaire</option>
                  <option value="confirme">Confirmé</option>
                </select>
              </div>

              {providers.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs text-[#C8C8DA]">
                    Modèle Gemini gratuit favori
                  </label>
                  <select
                    value={`${preferredProvider}:${preferredModel}`}
                    onChange={(e) => {
                      const [prov, mod] = e.target.value.split(':') as [AIProviderId, string];
                      if (prov && mod) {
                        setPreferredProvider(prov);
                        setPreferredModel(mod);
                      }
                    }}
                    className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3 py-2 text-sm text-white"
                  >
                    {providers.map((p) =>
                      p.models.map((m) => (
                        <option
                          key={`${p.id}:${m.id}`}
                          value={`${p.id}:${m.id}`}
                          disabled={!p.configured}
                        >
                          {p.label} — {m.label}
                          {!p.configured ? ' (non configuré sur le serveur)' : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-[#C8C8DA]">
                <input
                  type="checkbox"
                  checked={autoWebSearch}
                  onChange={(e) => setAutoWebSearch(e.target.checked)}
                  className="h-4 w-4 rounded border-[#32324A] accent-[#7C3AED]"
                />
                Activer la recherche web par défaut dans l&apos;Assistant
              </label>
            </div>

            <div className="border-t border-[#1F1F2D] pt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
                <Shield className="h-3.5 w-3.5 text-[#8B5CF6]" />
                Changer de mot de passe (optionnel)
              </div>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Mot de passe actuel"
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2 text-sm text-white placeholder-[#6A6A82] focus:border-[#7C3AED] focus:outline-none"
              />
              <input
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nouveau mot de passe (8 caractères min.)"
                className="w-full rounded-lg border border-[#262638] bg-[#0B0B10] px-3.5 py-2 text-sm text-white placeholder-[#6A6A82] focus:border-[#7C3AED] focus:outline-none"
              />
            </div>

            {message && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
            </button>
          </form>

          {/* Security Recovery Code & GDPR Deletion */}
          <div className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-[#3B82F6]" />
                <h2 className="font-display text-base font-semibold text-white">
                  Code de récupération &amp; Compte
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void handleRegenerateRecoveryCode()}
                className="rounded-lg border border-[#2C2C40] bg-[#171722] px-3 py-1.5 text-xs font-medium text-white hover:border-[#3B82F6]"
              >
                {user.hasRecoveryCode ? 'Régénérer un code' : 'Générer un code'}
              </button>
            </div>

            {newRecoveryCode && (
              <div className="rounded-lg border border-[#3B82F6]/40 bg-[#3B82F6]/10 p-3 text-xs text-[#DBEAFE] space-y-1">
                <p className="font-semibold">Nouveau code (à noter maintenant) :</p>
                <code className="block font-mono text-sm font-bold text-white">
                  {newRecoveryCode}
                </code>
              </div>
            )}

            <div className="border-t border-[#1F1F2D] pt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={exportingData}
                  onClick={() => void handleExportMyData()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#2C2C40] bg-[#171722] px-3 py-1.5 text-xs font-medium text-[#D6D6EA] hover:border-[#3B82F6] hover:text-white disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5 text-[#3B82F6]" />
                  {exportingData ? 'Préparation JSON...' : 'Exporter mes données (RGPD JSON)'}
                </button>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#9E9EB5]">
                  <button
                    type="button"
                    onClick={() => onNavigate('cgv')}
                    className="hover:text-white underline"
                  >
                    Conditions (0 €)
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('confidentialite')}
                    className="hover:text-white underline"
                  >
                    Confidentialité
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('mentions-legales')}
                    className="hover:text-white underline"
                  >
                    Mentions légales
                  </button>
                </div>
              </div>

              {!deleteConfirmOpen ? (
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer définitivement mon compte et mes données
                </button>
              ) : (
                <form
                  onSubmit={handleDeleteAccount}
                  className="space-y-3 rounded-lg border border-red-500/35 bg-red-500/10 p-3.5 text-xs"
                >
                  <p className="text-red-100">
                    Cette action est irréversible : toutes vos conversations, entreprises créées,
                    sites publiés, journaux et documents seront supprimés. Saisissez votre mot de
                    passe pour confirmer.
                  </p>
                  <input
                    type="password"
                    required
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Mot de passe de confirmation"
                    className="w-full rounded-lg border border-red-500/40 bg-[#0B0B10] px-3 py-2 text-white"
                  />
                  {deleteError && <p className="text-red-300">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={deletingAccount}
                      className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deletingAccount ? 'Suppression...' : 'Confirmer la suppression'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmOpen(false)}
                      className="rounded-md border border-[#32324A] px-3 py-1.5 text-[#D2D2E2]"
                    >
                      Annuler
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Free Quotas (0 €) & Transparency */}
        <div className="space-y-4 lg:col-span-6">
          <div className="rounded-xl border border-[#232332] bg-[#111117] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <h2 className="font-display text-lg font-semibold text-white">
                Quotas Gratuits (0 €) &amp; Transparence
              </h2>
            </div>

            <div className="space-y-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#9E9EB5]">Formule active</span>
                <span className="font-display font-bold uppercase text-white">GRATUIT · 0 €</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#9E9EB5]">Facturation &amp; carte bancaire</span>
                <span className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Désactivées (Budget strict 0 €)
                </span>
              </div>
              {quota && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[#9E9EB5]">Messages Assistant IA aujourd&apos;hui</span>
                    <span className="font-mono tabular-nums text-white">
                      {quota.chatUsedToday}
                      {quota.dailyChatLimit !== null
                        ? ` / ${quota.dailyChatLimit}`
                        : ' (sans plafond app)'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#9E9EB5]">Générations Studio Business aujourd&apos;hui</span>
                    <span className="font-mono tabular-nums text-white">
                      {quota.businessUsedToday}
                      {quota.dailyBusinessLimit !== null
                        ? ` / ${quota.dailyBusinessLimit}`
                        : ' (sans plafond app)'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#9E9EB5]">Sites publiés max</span>
                    <span className="font-mono tabular-nums text-white">
                      {quota.maxPublishedSites} sites
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#9E9EB5]">Pièces jointes texte max</span>
                    <span className="font-mono tabular-nums text-white">
                      {Math.round(quota.maxAttachmentBytes / 1024)} Ko
                    </span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[#9E9EB5]">Membre depuis</span>
                <span className="font-mono text-xs tabular-nums text-[#C8C8DA]">
                  {new Date(user.createdAt).toLocaleDateString('fr-FR')}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs leading-relaxed text-emerald-100">
              NOVA AI n&apos;impose aucun blocage commercial de messages. Seules les limites
              techniques gratuites du fournisseur Google Gemini (et une protection anti-rafale)
              s&apos;appliquent, sans jamais déclencher de paiement.
            </div>

            <button
              type="button"
              onClick={() => onNavigate('tarifs')}
              className="w-full rounded-lg border border-[#2C2C40] bg-[#171722] py-2.5 text-sm font-semibold text-white hover:border-[#7C3AED] transition-colors"
            >
              Consulter le fonctionnement gratuit (0 €)
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
