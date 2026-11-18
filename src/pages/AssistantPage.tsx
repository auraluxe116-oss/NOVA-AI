import {
  AlertCircle,
  Check,
  Copy,
  Globe,
  MessageSquarePlus,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import type {
  ChatMessage,
  ConversationSummary,
  PageView,
  PublicUser,
  QuotaSnapshot,
} from '../types/nova';
import {
  ApiError,
  deleteConversationApi,
  fetchConversationDetail,
  fetchConversations,
  streamChatMessage,
} from '../utils/api';

interface AssistantPageProps {
  user: PublicUser | null;
  quota: QuotaSnapshot | null;
  initialPrompt?: string | null;
  initialConversationId?: string | null;
  onClearInitialPrompt: () => void;
  onQuotaUpdated: (q: QuotaSnapshot) => void;
  onNavigate: (view: PageView) => void;
}

const STARTER_TOPICS = [
  {
    category: 'Entrepreneuriat',
    prompt:
      'Quelles étapes concrètes pour valider une idée de service B2B avant de développer un produit complet ?',
  },
  {
    category: 'Finance & Statut',
    prompt:
      'Compare clairement micro-entreprise, EURL et SASU pour démarrer une activité de conseil en France.',
  },
  {
    category: 'Marketing',
    prompt:
      'Propose une stratégie d’acquisition organique sur 30 jours pour décrocher mes 5 premiers clients.',
  },
  {
    category: 'Programmation',
    prompt:
      'Explique comment sécuriser une API Express avec cookies HTTP-only, hachage scrypt et limitation de débit.',
  },
];

export function AssistantPage({
  user,
  quota,
  initialPrompt,
  initialConversationId,
  onClearInitialPrompt,
  onQuotaUpdated,
  onNavigate,
}: AssistantPageProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [attachment, setAttachment] = useState<{ name: string; content: string; sizeBytes: number } | null>(
    null
  );
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [loadingConv, setLoadingConv] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const consumedInitialPromptRef = useRef<string | null>(null);

  const loadConversationsList = async () => {
    if (!user) {
      setConversations([]);
      return;
    }
    try {
      const data = await fetchConversations();
      setConversations(data.conversations);
    } catch {
      // ignore non-blocking list failure
    }
  };

  useEffect(() => {
    void loadConversationsList();
  }, [user?.id]);

  useEffect(() => {
    if (initialConversationId && user) {
      void openConversation(initialConversationId);
    }
  }, [initialConversationId, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, statusLabel]);

  const openConversation = async (id: string) => {
    setLoadingConv(true);
    setErrorBanner(null);
    try {
      const detail = await fetchConversationDetail(id);
      setActiveConvId(id);
      setMessages(detail.messages);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Impossible de charger la conversation.');
    } finally {
      setLoadingConv(false);
    }
  };

  const handleNewChat = () => {
    if (isGenerating) {
      abortRef.current?.abort();
    }
    setActiveConvId(null);
    setMessages([]);
    setErrorBanner(null);
    setLastFailedPrompt(null);
    setStatusLabel(null);
  };

  const handleDeleteConv = async (id: string) => {
    try {
      await deleteConversationApi(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConvId === id) {
        handleNewChat();
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Erreur lors de la suppression.');
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const maxBytes = quota?.maxAttachmentBytes ?? 40 * 1024;
    if (file.size > maxBytes) {
      setErrorBanner(
        `Le fichier "${file.name}" (${Math.ceil(file.size / 1024)} Ko) dépasse la limite autorisée (${Math.round(
          maxBytes / 1024
        )} Ko) pour votre formule actuelle.`
      );
      return;
    }

    try {
      const text = await file.text();
      if (!text.trim()) {
        setErrorBanner('Le fichier sélectionné est vide ou non lisible en texte.');
        return;
      }
      setAttachment({ name: file.name, content: text, sizeBytes: file.size });
      setErrorBanner(null);
    } catch {
      setErrorBanner('Impossible de lire ce document. Utilisez un fichier texte (.txt, .md, .csv, .json).');
    }
  };

  const sendMessage = async (promptText: string, isRetry = false) => {
    const cleanPrompt = promptText.trim();
    if (!cleanPrompt || isGenerating) return;

    setErrorBanner(null);
    setLastFailedPrompt(null);
    setIsGenerating(true);
    setStatusLabel('NOVA réfléchit...');

    const userMsgId = `u-${Date.now()}`;
    const assistantMsgId = `a-${Date.now() + 1}`;
    const currentAttachment = attachment;
    if (!isRetry) {
      setInput('');
      setAttachment(null);
    }

    const guestHistory = !user
      ? messages
          .filter((m) => !m.isError && !m.isStreaming)
          .slice(-8)
          .map((m) => ({ role: m.role, content: m.content }))
      : [];

    setMessages((prev) => {
      const base = isRetry ? prev.filter((m) => !m.isError) : prev;
      const withUser = isRetry
        ? base
        : [
            ...base,
            {
              id: userMsgId,
              role: 'user' as const,
              content: cleanPrompt,
              attachmentName: currentAttachment?.name ?? null,
              createdAt: new Date().toISOString(),
            },
          ];
      return [
        ...withUser,
        {
          id: assistantMsgId,
          role: 'assistant' as const,
          content: '',
          createdAt: new Date().toISOString(),
          isStreaming: true,
        },
      ];
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChatMessage({
        message: cleanPrompt,
        conversationId: activeConvId,
        useWebSearch,
        attachment: currentAttachment
          ? { name: currentAttachment.name, content: currentAttachment.content }
          : null,
        guestHistory,
        signal: controller.signal,
        onStatus: (label, convId) => {
          setStatusLabel(label);
          if (convId && !activeConvId) setActiveConvId(convId);
        },
        onDelta: (delta) => {
          setStatusLabel(null);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
            )
          );
        },
        onSources: (sources) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, sources } : m))
          );
        },
        onDone: (payload) => {
          if (payload.conversationId && !activeConvId) {
            setActiveConvId(payload.conversationId);
          }
          if (payload.quota) {
            onQuotaUpdated(payload.quota);
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    isStreaming: false,
                    modelUsed: payload.modelUsed ?? null,
                    latencyMs: payload.latencyMs ?? null,
                  }
                : m
            )
          );
          if (user) {
            void loadConversationsList();
          }
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  isStreaming: false,
                  content: m.content || 'Génération interrompue par l’utilisateur.',
                }
              : m
          )
        );
      } else {
        const msg =
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Le serveur IA est momentanément indisponible.';
        setErrorBanner(msg);
        setLastFailedPrompt(cleanPrompt);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  isStreaming: false,
                  isError: true,
                  content: msg,
                }
              : m
          )
        );
      }
    } finally {
      setIsGenerating(false);
      setStatusLabel(null);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (initialPrompt && consumedInitialPromptRef.current !== initialPrompt) {
      consumedInitialPromptRef.current = initialPrompt;
      onClearInitialPrompt();
      void sendMessage(initialPrompt);
    }
  }, [initialPrompt]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 1800);
  };

  const handleRegenerateLast = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser || isGenerating) return;
    void sendMessage(lastUser.content, true);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-7xl border-x border-[#1C1C28] bg-[#08080B]">
      {/* Sidebar Conversations */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-[#1F1F2D] bg-[#0B0B10] md:flex">
        <div className="border-b border-[#1F1F2D] p-3">
          <button
            type="button"
            onClick={handleNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] transition-colors"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Nouveau chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
          {!user ? (
            <div className="rounded-lg border border-[#232332] bg-[#111117] p-3.5 text-xs leading-relaxed text-[#A8A8BE]">
              <p className="font-semibold text-[#FAFAFA]">Mode découverte</p>
              <p className="mt-1">
                Connectez-vous pour sauvegarder automatiquement toutes vos conversations et
                retrouver votre historique.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('inscription')}
                className="mt-3 w-full rounded-md bg-[#1D1D29] py-1.5 font-medium text-[#C4B5FD] hover:bg-[#272738]"
              >
                Créer un compte gratuit
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-4 text-xs text-[#7D7D96]">
              Aucune conversation enregistrée pour le moment.
            </p>
          ) : (
            conversations.map((conv) => {
              const active = conv.id === activeConvId;
              return (
                <div
                  key={conv.id}
                  className={`group flex items-center justify-between gap-1 rounded-lg px-2.5 py-2 text-xs transition-colors ${
                    active
                      ? 'bg-[#171722] text-white border border-[#2C2C40]'
                      : 'text-[#A8A8BE] hover:bg-[#12121A] hover:text-white'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void openConversation(conv.id)}
                    className="flex-1 truncate text-left font-medium"
                  >
                    {conv.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteConv(conv.id)}
                    aria-label="Supprimer la conversation"
                    className="opacity-0 group-hover:opacity-100 p-1 text-[#7D7D96] hover:text-red-400 transition-opacity"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Real Daily Quota Indicator */}
        {quota && (
          <div className="border-t border-[#1F1F2D] p-3.5 text-xs">
            <div className="flex items-center justify-between text-[#B2B2C6]">
              <span>Formule {quota.plan.toUpperCase()}</span>
              <span className="font-mono tabular-nums text-white">
                {quota.chatRemaining}/{quota.chatLimit}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#1C1C28]">
              <div
                className="h-full bg-[#7C3AED] transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((quota.chatUsed / Math.max(1, quota.chatLimit)) * 100)
                  )}%`,
                }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-[#7D7D96]">
              Messages restants aujourd&apos;hui
            </p>
          </div>
        )}
      </aside>

      {/* Main Chat Pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Context Bar */}
        <div className="flex items-center justify-between gap-3 border-b border-[#1F1F2D] bg-[#0B0B10] px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={handleNewChat}
              className="md:hidden inline-flex items-center gap-1.5 rounded-md border border-[#232332] bg-[#111117] px-2.5 py-1 text-xs font-medium text-white"
            >
              <MessageSquarePlus className="h-3.5 w-3.5 text-[#A78BFA]" />
              Nouveau
            </button>
            <h1 className="truncate font-display text-sm font-semibold text-[#FAFAFA]">
              Assistant conversationnel NOVA AI
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setUseWebSearch((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                useWebSearch
                  ? 'border-[#7C3AED] bg-[#7C3AED]/15 text-[#DDD6FE]'
                  : 'border-[#232332] bg-[#111117] text-[#A8A8BE] hover:text-white'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              Recherche Web {useWebSearch ? 'activée' : 'auto'}
            </button>
          </div>
        </div>

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {loadingConv ? (
              <div className="py-12 text-center text-sm text-[#8F8FA6]">
                Chargement de la conversation...
              </div>
            ) : messages.length === 0 ? (
              <div className="py-8 space-y-6">
                <div className="space-y-2">
                  <h2 className="font-display text-2xl font-bold text-white">
                    Comment puis-je vous aider aujourd&apos;hui ?
                  </h2>
                  <p className="text-sm text-[#A6A6BC]">
                    Business, création d&apos;entreprise, marketing, finance, code, sciences ou
                    analyse de document texte : vos réponses démarrent en streaming temps réel.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {STARTER_TOPICS.map((item) => (
                    <button
                      key={item.category}
                      type="button"
                      onClick={() => void sendMessage(item.prompt)}
                      className="rounded-xl border border-[#232332] bg-[#111117] p-4 text-left hover:border-[#7C3AED]/70 transition-colors"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#A78BFA]">
                        {item.category}
                      </p>
                      <p className="mt-1.5 text-sm leading-snug text-[#E2E2EE]">{item.prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isUser = msg.role === 'user';
                const isLastAssistant =
                  !isUser && idx === messages.length - 1 && !msg.isStreaming;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    {isUser ? (
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-[#3B2B68] bg-[#1A142D] px-4 py-3 text-sm leading-relaxed text-[#FAFAFA]">
                        {msg.attachmentName && (
                          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[#C4B5FD]">
                            <Paperclip className="h-3.5 w-3.5" />
                            <span>{msg.attachmentName}</span>
                          </div>
                        )}
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ) : (
                      <div className="w-full rounded-xl border border-[#1F1F2D] bg-[#0E0E14] p-4 sm:p-5">
                        <div className="mb-2.5 flex items-center justify-between gap-2 text-xs text-[#8D8DA4]">
                          <span className="font-semibold text-[#C4B5FD]">NOVA AI</span>
                          {msg.latencyMs ? (
                            <span className="font-mono tabular-nums text-[11px]">
                              {(msg.latencyMs / 1000).toFixed(2)}s
                            </span>
                          ) : null}
                        </div>

                        {msg.isStreaming && !msg.content && statusLabel ? (
                          <div className="flex items-center gap-2.5 py-2 text-sm text-[#C4B5FD]">
                            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#8B5CF6]" />
                            <span>{statusLabel}</span>
                          </div>
                        ) : msg.isError ? (
                          <div className="flex items-start gap-2.5 text-sm text-red-300">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                            <div className="space-y-2">
                              <p>{msg.content}</p>
                              {lastFailedPrompt && (
                                <button
                                  type="button"
                                  onClick={() => void sendMessage(lastFailedPrompt, true)}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-500/20"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  Réessayer
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <MarkdownRenderer content={msg.content} sources={msg.sources} />
                        )}

                        {!msg.isStreaming && !msg.isError && msg.content && (
                          <div className="mt-3 flex items-center gap-2 border-t border-[#1C1C28] pt-2.5">
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg.id, msg.content)}
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[#9E9EB5] hover:bg-[#171721] hover:text-white"
                            >
                              {copiedMsgId === msg.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              {copiedMsgId === msg.id ? 'Copié' : 'Copier'}
                            </button>
                            {isLastAssistant && (
                              <button
                                type="button"
                                onClick={handleRegenerateLast}
                                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[#9E9EB5] hover:bg-[#171721] hover:text-white"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Régénérer
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-[#1F1F2D] bg-[#0B0B10] px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-3xl space-y-2">
            {errorBanner && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-200">
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

            {attachment && (
              <div className="flex items-center justify-between rounded-lg border border-[#3B2B68] bg-[#141122] px-3 py-1.5 text-xs text-[#DDD6FE]">
                <span className="truncate">
                  Document prêt : <strong>{attachment.name}</strong> (
                  <span className="font-mono tabular-nums">
                    {Math.max(1, Math.round(attachment.sizeBytes / 1024))} Ko
                  </span>
                  )
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="ml-2 text-[#A78BFA] hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="flex items-end gap-2 rounded-xl border border-[#252536] bg-[#111117] p-2 focus-within:border-[#7C3AED]"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.csv,.json,.log,.ts,.js,.py"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Joindre un document texte (.txt, .md, .csv, .json)"
                className="rounded-lg p-2 text-[#9E9EB5] hover:bg-[#1B1B26] hover:text-white transition-colors shrink-0"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Écrivez votre question ici (Entrée pour envoyer, Maj+Entrée pour nouvelle ligne)..."
                className="max-h-40 min-h-[38px] w-full resize-none bg-transparent py-2 text-sm text-[#FAFAFA] placeholder-[#7B7B93] focus:outline-none"
              />

              {isGenerating ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  aria-label="Arrêter la génération"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2A2A3B] text-white hover:bg-[#3A3A50]"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="Envoyer"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-40 transition-colors"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </form>
            <p className="text-[11px] text-[#76768E]">
              NOVA AI vérifie ses réponses mais peut se tromper sur des situations très spécifiques.
              Vérifiez les données critiques avec les sources ou un expert qualifié.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
