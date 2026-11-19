import { useEffect, useState } from 'react';
import { TopNav } from './components/TopNav';
import { AccueilPage } from './pages/AccueilPage';
import { AssistantPage } from './pages/AssistantPage';
import { AuthPages } from './pages/AuthPages';
import { BusinessModePage } from './pages/BusinessModePage';
import { PaymentFailurePage, PaymentSuccessPage } from './pages/CheckoutResultPages';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { LegalPages } from './pages/LegalPages';
import { ProfilePage } from './pages/ProfilePage';
import { TarifsPage } from './pages/TarifsPage';
import type { PageView, PublicUser, QuotaSnapshot } from './types/nova';
import { fetchAuthMe } from './utils/api';

const VALID_VIEWS: PageView[] = [
  'accueil',
  'assistant',
  'business',
  'tarifs',
  'connexion',
  'inscription',
  'dashboard',
  'historique',
  'profil',
  'paiement-succes',
  'paiement-echec',
  'confidentialite',
  'mentions-legales',
];

function getInitialViewFromUrl(): {
  view: PageView;
  checkoutStatus: string | null;
  stripeSessionId: string | null;
} {
  if (typeof window === 'undefined') {
    return { view: 'accueil', checkoutStatus: null, stripeSessionId: null };
  }
  const params = new URLSearchParams(window.location.search);
  const rawView = params.get('view') as PageView | null;
  const checkoutStatus = params.get('checkout');
  const stripeSessionId = params.get('session_id');
  if (rawView && VALID_VIEWS.includes(rawView)) {
    return { view: rawView, checkoutStatus, stripeSessionId };
  }
  return { view: 'accueil', checkoutStatus, stripeSessionId };
}

export function App() {
  const initial = getInitialViewFromUrl();
  const [activeView, setActiveView] = useState<PageView>(initial.view);
  const [checkoutStatus] = useState<string | null>(initial.checkoutStatus);
  const [stripeSessionId] = useState<string | null>(initial.stripeSessionId);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [openBusinessProjectId, setOpenBusinessProjectId] = useState<string | null>(null);

  useEffect(() => {
    void fetchAuthMe()
      .then((res) => {
        setUser(res.user);
        setQuota(res.quota);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setAuthReady(true));
  }, []);

  const navigate = (view: PageView) => {
    setActiveView(view);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (view === 'accueil') {
        url.searchParams.delete('view');
      } else {
        url.searchParams.set('view', view);
      }
      url.searchParams.delete('checkout');
      url.searchParams.delete('session_id');
      window.history.replaceState({}, '', url.toString());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleLaunchPrompt = (prompt: string) => {
    setOpenConversationId(null);
    setPendingPrompt(prompt);
    navigate('assistant');
  };

  const handleOpenConversation = (id: string) => {
    setOpenConversationId(id);
    navigate('assistant');
  };

  const handleOpenBusinessProject = (id: string) => {
    setOpenBusinessProjectId(id);
    navigate('business');
  };

  return (
    <div className="min-h-screen bg-[#08080B] text-[#FAFAFA] flex flex-col">
      <TopNav activeView={activeView} user={user} onNavigate={navigate} />

      {!authReady ? (
        <div className="flex flex-1 items-center justify-center py-24 text-sm text-[#8D8DA4]">
          Chargement de NOVA AI...
        </div>
      ) : (
        <div className="flex-1">
          {activeView === 'accueil' && (
            <AccueilPage
              user={user}
              onNavigate={navigate}
              onLaunchPrompt={handleLaunchPrompt}
            />
          )}

          {activeView === 'assistant' && (
            <AssistantPage
              user={user}
              quota={quota}
              initialPrompt={pendingPrompt}
              initialConversationId={openConversationId}
              onClearInitialPrompt={() => setPendingPrompt(null)}
              onQuotaUpdated={(q) => setQuota(q)}
              onNavigate={navigate}
            />
          )}

          {activeView === 'business' && (
            <BusinessModePage
              user={user}
              quota={quota}
              initialProjectId={openBusinessProjectId}
              onClearInitialProject={() => setOpenBusinessProjectId(null)}
              onLaunchPrompt={handleLaunchPrompt}
              onQuotaUpdated={(q) => setQuota(q)}
              onNavigate={navigate}
            />
          )}

          {activeView === 'tarifs' && (
            <TarifsPage user={user} onNavigate={navigate} />
          )}

          {activeView === 'paiement-succes' && (
            <PaymentSuccessPage
              user={user}
              sessionId={stripeSessionId}
              onNavigate={navigate}
              onVerified={(u, q) => {
                setUser(u);
                setQuota(q);
              }}
            />
          )}

          {activeView === 'paiement-echec' && (
            <PaymentFailurePage user={user} onNavigate={navigate} />
          )}

          {(activeView === 'connexion' || activeView === 'inscription') && (
            <AuthPages
              mode={activeView}
              onNavigate={navigate}
              onAuthSuccess={(u, q) => {
                setUser(u);
                setQuota(q);
                navigate('dashboard');
              }}
            />
          )}

          {activeView === 'dashboard' && (
            <DashboardPage
              user={user}
              checkoutStatus={checkoutStatus}
              onNavigate={navigate}
              onOpenConversation={handleOpenConversation}
              onOpenBusinessProject={handleOpenBusinessProject}
            />
          )}

          {activeView === 'historique' && (
            <HistoryPage
              user={user}
              onNavigate={navigate}
              onOpenConversation={handleOpenConversation}
            />
          )}

          {activeView === 'profil' && (
            <ProfilePage
              user={user}
              quota={quota}
              onNavigate={navigate}
              onUserUpdated={(u, q) => {
                setUser(u);
                setQuota(q);
              }}
              onLoggedOut={() => {
                setUser(null);
                setOpenConversationId(null);
                navigate('accueil');
                void fetchAuthMe().then((r) => setQuota(r.quota));
              }}
            />
          )}
          {(activeView === 'confidentialite' || activeView === 'mentions-legales') && (
            <LegalPages
              mode={activeView}
              user={user}
              onNavigate={navigate}
            />
          )}
        </div>
      )}

      {/* Quiet Footer on non-full-height chat views */}
      {activeView !== 'assistant' && (
        <footer className="border-t border-[#1C1C28] bg-[#08080B] py-8">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 text-xs text-[#8888A0] sm:flex-row sm:items-center sm:px-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-sm font-bold text-[#FAFAFA]">NOVA AI PRO</span>
              <span>Plateforme IA conversationnelle &amp; Suite Business complète</span>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <button
                type="button"
                onClick={() => navigate('assistant')}
                className="hover:text-white"
              >
                Assistant IA
              </button>
              <button
                type="button"
                onClick={() => navigate('business')}
                className="hover:text-white"
              >
                Mode Business
              </button>
              <button
                type="button"
                onClick={() => navigate('tarifs')}
                className="hover:text-white"
              >
                Tarifs
              </button>
              <button
                type="button"
                onClick={() => navigate(user ? 'dashboard' : 'connexion')}
                className="hover:text-white"
              >
                {user ? 'Tableau de bord' : 'Connexion'}
              </button>
              <button
                type="button"
                onClick={() => navigate('confidentialite')}
                className="hover:text-white"
              >
                Confidentialité (RGPD)
              </button>
              <button
                type="button"
                onClick={() => navigate('mentions-legales')}
                className="hover:text-white"
              >
                Mentions légales
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;
