import { Download, Edit3, MessageSquare, Search, Trash2, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ConversationSummary, PageView, PublicUser } from '../types/nova';
import {
  deleteConversationApi,
  fetchConversationDetail,
  fetchConversations,
  renameConversationApi,
} from '../utils/api';

interface HistoryPageProps {
  user: PublicUser | null;
  onNavigate: (view: PageView) => void;
  onOpenConversation: (id: string) => void;
}

export function HistoryPage({
  user,
  onNavigate,
  onOpenConversation,
}: HistoryPageProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const loadPage = async (append = false) => {
    if (!user) {
      setLoading(false);
      return;
    }
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setErrorBanner(null);
    try {
      const offset = append ? conversations.length : 0;
      const res = await fetchConversations({ limit: 30, offset });
      if (append) {
        setConversations((prev) => {
          const existing = new Set(prev.map((c) => c.id));
          return [...prev, ...res.conversations.filter((c) => !existing.has(c.id))];
        });
      } else {
        setConversations(res.conversations);
      }
      setHasMore(Boolean(res.hasMore));
      setTotal(res.total ?? res.conversations.length);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Impossible de charger l'historique.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadPage(false);
  }, [user?.id]);

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center space-y-4">
        <h1 className="font-display text-2xl font-bold text-white">
          Historique des conversations
        </h1>
        <p className="text-sm text-[#A6A6BC]">
          Connectez-vous pour consulter, rechercher, renommer ou exporter vos échanges.
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

  const filtered = conversations.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      (c.last_message_preview ?? '').toLowerCase().includes(q)
    );
  });

  const handleRename = async (id: string) => {
    const clean = editingTitle.trim();
    if (!clean) return;
    setErrorBanner(null);
    try {
      const updated = await renameConversationApi(id, clean);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: updated.conversation.title } : c))
      );
      setEditingId(null);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Impossible de renommer la conversation.');
    }
  };

  const handleDelete = async (id: string) => {
    setErrorBanner(null);
    try {
      await deleteConversationApi(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Erreur lors de la suppression.');
    }
  };

  const handleExport = async (id: string, title: string) => {
    setErrorBanner(null);
    try {
      const detail = await fetchConversationDetail(id, { limit: 200 });
      const md = [
        `# ${title}`,
        '',
        ...detail.messages.map(
          (m) => `### ${m.role === 'user' ? 'Vous' : 'NOVA AI'}\n\n${m.content}\n`
        ),
      ].join('\n');
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'conversation'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Impossible d’exporter cette conversation.'
      );
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#1F1F2D] pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A78BFA]">
            Archives personnelles {total > 0 ? `(${total})` : ''}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-white">
            Historique des conversations
          </h1>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('assistant')}
          className="inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9]"
        >
          <MessageSquare className="h-4 w-4" />
          Nouvelle conversation
        </button>
      </div>

      {errorBanner && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Live Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute top-3 left-3.5 h-4 w-4 text-[#7D7D96]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par titre ou mot-clé..."
          className="w-full rounded-xl border border-[#232332] bg-[#111117] py-2.5 pr-4 pl-10 text-sm text-white placeholder-[#7B7B93] focus:border-[#7C3AED] focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl border border-[#232332] bg-[#111117]"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[#232332] bg-[#111117] p-8 text-center text-sm text-[#9E9EB5]">
          {search
            ? 'Aucune conversation ne correspond à votre recherche.'
            : 'Aucune conversation enregistrée pour le moment.'}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="divide-y divide-[#1E1E2B] overflow-hidden rounded-xl border border-[#232332] bg-[#111117]">
            {filtered.map((conv) => (
              <div
                key={conv.id}
                className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  {editingId === conv.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename(conv.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="w-full max-w-sm rounded border border-[#7C3AED] bg-[#0B0B10] px-2.5 py-1 text-sm text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleRename(conv.id)}
                        className="p-1 text-emerald-400 hover:text-emerald-300"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="p-1 text-[#8D8DA4] hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenConversation(conv.id)}
                      className="block max-w-full truncate text-left text-sm font-semibold text-white hover:text-[#C4B5FD]"
                    >
                      {conv.title}
                    </button>
                  )}
                  <p className="mt-1 truncate text-xs text-[#8D8DA4]">
                    {conv.last_message_preview || 'Aucun aperçu'}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-xs tabular-nums text-[#8D8DA4]">
                    {conv.message_count ?? 0} msg •{' '}
                    {new Date(conv.updated_at).toLocaleDateString('fr-FR')}
                  </span>
                  <button
                    type="button"
                    title="Renommer"
                    onClick={() => {
                      setEditingId(conv.id);
                      setEditingTitle(conv.title);
                    }}
                    className="rounded p-1.5 text-[#9E9EB5] hover:bg-[#1B1B26] hover:text-white"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Exporter en Markdown"
                    onClick={() => void handleExport(conv.id, conv.title)}
                    className="rounded p-1.5 text-[#9E9EB5] hover:bg-[#1B1B26] hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Supprimer"
                    onClick={() => void handleDelete(conv.id)}
                    className="rounded p-1.5 text-[#9E9EB5] hover:bg-[#1B1B26] hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadPage(true)}
                className="rounded-lg border border-[#2C2C40] bg-[#111117] px-4 py-2 text-xs font-medium text-[#C4B5FD] hover:border-[#7C3AED] hover:text-white disabled:opacity-50"
              >
                {loadingMore
                  ? 'Chargement...'
                  : `Charger plus de conversations (${conversations.length}/${total})`}
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
