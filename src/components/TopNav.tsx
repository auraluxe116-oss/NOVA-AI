import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import type { PageView, PublicUser } from '../types/nova';

interface TopNavProps {
  activeView: PageView;
  user: PublicUser | null;
  onNavigate: (view: PageView) => void;
}

export function TopNav({ activeView, user, onNavigate }: TopNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: Array<{ id: PageView; label: string }> = [
    { id: 'accueil', label: 'Accueil' },
    { id: 'assistant', label: 'Assistant IA' },
    { id: 'business', label: 'Mode Business' },
    { id: 'tarifs', label: 'Tarifs' },
  ];

  if (user) {
    navItems.push(
      { id: 'dashboard', label: 'Tableau de bord' },
      { id: 'historique', label: 'Historique' }
    );
  }

  const handleGo = (view: PageView) => {
    onNavigate(view);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-[#232332] bg-[#08080B]/92 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left Zone: Clean Wordmark only (no subtitle or status chip clutter) */}
        <button
          type="button"
          onClick={() => handleGo('accueil')}
          className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 focus-visible:rounded-md"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#7C3AED] text-white">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-[#FAFAFA]">
            NOVA AI
          </span>
        </button>

        {/* Center Zone: Single-line Primary Navigation */}
        <nav
          aria-label="Navigation principale"
          className="hidden lg:flex items-center gap-1"
        >
          {navItems.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleGo(item.id)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#171721] text-[#FAFAFA] border border-[#2C2C3E]'
                    : 'text-[#A1A1B5] hover:text-[#FAFAFA] hover:bg-[#111117]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right Zone: Auth / Account Controls */}
        <div className="hidden lg:flex items-center gap-2.5 whitespace-nowrap shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => handleGo('profil')}
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeView === 'profil'
                  ? 'border-[#7C3AED] bg-[#171721] text-[#FAFAFA]'
                  : 'border-[#232332] bg-[#111117] text-[#E4E4EE] hover:border-[#3A3A52]'
              }`}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#7C3AED]/25 text-xs font-semibold text-[#C4B5FD]">
                {user.displayName.charAt(0).toUpperCase()}
              </span>
              <span className="max-w-[140px] truncate">{user.displayName}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleGo('connexion')}
                className="px-3.5 py-2 rounded-lg text-sm font-medium text-[#D4D4E2] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0"
              >
                Connexion
              </button>
              <button
                type="button"
                onClick={() => handleGo('inscription')}
                className="px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0"
              >
                Créer un compte
              </button>
            </>
          )}
        </div>

        {/* Mobile Hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          className="lg:hidden rounded-lg border border-[#232332] bg-[#111117] p-2 text-[#E4E4EE] hover:text-white"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-b border-[#232332] bg-[#0B0B10] px-4 py-4">
          <div className="flex flex-col gap-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleGo(item.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                  activeView === item.id
                    ? 'bg-[#171721] text-[#FAFAFA] border border-[#2C2C3E]'
                    : 'text-[#B5B5C8] hover:bg-[#111117] hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
            <div className="my-2 border-t border-[#232332]" />
            {user ? (
              <button
                type="button"
                onClick={() => handleGo('profil')}
                className="w-full text-left px-3.5 py-2.5 rounded-lg bg-[#171721] text-sm font-medium text-[#FAFAFA]"
              >
                Profil ({user.displayName})
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleGo('connexion')}
                  className="px-3.5 py-2.5 rounded-lg border border-[#232332] text-center text-sm font-medium text-[#E4E4EE]"
                >
                  Connexion
                </button>
                <button
                  type="button"
                  onClick={() => handleGo('inscription')}
                  className="px-3.5 py-2.5 rounded-lg bg-[#7C3AED] text-center text-sm font-semibold text-white"
                >
                  Inscription
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
