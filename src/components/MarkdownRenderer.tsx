import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SourceLink } from '../types/nova';

interface MarkdownRendererProps {
  content: string;
  sources?: SourceLink[];
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const raw = String(children).replace(/\n$/, '');
  const lang = className?.replace('language-', '') || 'code';

  const handleCopy = () => {
    void navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-[#232332] bg-[#0B0B10]">
      <div className="flex items-center justify-between border-b border-[#232332] bg-[#111117] px-3 py-1.5 text-xs text-[#9E9EB5]">
        <span className="font-mono uppercase">{lang}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-[#D4D4E2] hover:bg-[#1E1E2A] hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-xs leading-relaxed font-mono text-[#E8E8F4]">
        <code>{raw}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content, sources }: MarkdownRendererProps) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-[#E9E9F2]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 font-display text-xl font-semibold text-white">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-5 mb-2 border-b border-[#232332] pb-1.5 font-display text-lg font-semibold text-white">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3.5 mb-1.5 font-display text-base font-semibold text-[#DDD6FE]">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2 ml-5 list-disc space-y-1.5 marker:text-[#8B5CF6]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1.5 marker:text-[#8B5CF6]">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 rounded-lg border border-[#26263A] bg-[#111117] px-3.5 py-2.5 text-sm text-[#C9C9DA]">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-[#232332]">
              <table className="w-full border-collapse text-left text-xs sm:text-sm tabular-nums">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#14141C] text-[#FAFAFA]">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border-b border-[#232332] px-3 py-2 font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b border-[#1D1D29] px-3 py-2 text-[#D2D2E0]">{children}</td>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#A78BFA] underline decoration-[#7C3AED]/60 underline-offset-2 hover:text-[#C4B5FD]"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const isBlock = Boolean(className) || String(children).includes('\n');
            if (isBlock) {
              return <CodeBlock className={className}>{children}</CodeBlock>;
            }
            return (
              <code className="rounded bg-[#191924] px-1.5 py-0.5 font-mono text-[13px] text-[#C4B5FD]">
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>

      {sources && sources.length > 0 && (
        <div className="mt-4 border-t border-[#232332] pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
            Sources web vérifiées
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {sources.map((src, idx) => (
              <a
                key={`${src.url}-${idx}`}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-lg border border-[#232332] bg-[#0E0E14] px-3 py-2 text-xs text-[#D6D6E4] hover:border-[#7C3AED]/60 hover:text-white transition-colors"
              >
                <span className="truncate">{src.title}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#8B5CF6]" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
