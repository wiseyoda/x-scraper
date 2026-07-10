/**
 * Markdown renderer with custom Tailwind 4 styling for the dark theme.
 *
 * No `@tailwindcss/typography` plugin — we hand-style each element so we
 * can control the look in our own design system. Synthesized Idea bodies
 * and source bodies render through this; the unstyled `whitespace-pre-wrap`
 * fallback is gone.
 *
 * Server-side renderable (react-markdown supports RSC).
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  body: string;
  className?: string;
}

export const Markdown = ({ body, className }: MarkdownProps): React.JSX.Element => (
  <div className={`text-zinc-200 ${className ?? ''}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (props) => (
          <h1
            className="mt-8 mb-3 text-2xl font-semibold tracking-tight text-zinc-100 first:mt-0"
            {...props}
          />
        ),
        h2: (props) => (
          <h2 className="mt-7 mb-3 text-xl font-semibold tracking-tight text-zinc-100" {...props} />
        ),
        h3: (props) => (
          <h3 className="mt-5 mb-2 text-base font-semibold text-zinc-100" {...props} />
        ),
        h4: (props) => (
          <h4
            className="mt-4 mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-300"
            {...props}
          />
        ),
        p: (props) => <p className="mb-4 leading-relaxed text-zinc-200" {...props} />,
        ul: (props) => (
          <ul className="mb-4 list-disc space-y-1 pl-6 marker:text-zinc-600" {...props} />
        ),
        ol: (props) => (
          <ol className="mb-4 list-decimal space-y-1 pl-6 marker:text-zinc-500" {...props} />
        ),
        li: (props) => <li className="leading-relaxed text-zinc-200" {...props} />,
        a: (props) => (
          <a
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-300 hover:decoration-sky-300"
            {...props}
          />
        ),
        blockquote: (props) => (
          <blockquote
            className="mb-4 border-l-2 border-zinc-700 pl-4 text-zinc-400 italic"
            {...props}
          />
        ),
        code: ({ children, className: cls, ...rest }) => {
          const isBlock = cls !== undefined && cls.startsWith('language-');
          if (isBlock) {
            return (
              <code className={`${cls ?? ''} text-zinc-200`} {...rest}>
                {children}
              </code>
            );
          }
          return (
            <code
              className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[0.9em] text-zinc-200"
              {...rest}
            >
              {children}
            </code>
          );
        },
        pre: (props) => (
          <pre
            className="mb-4 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-200"
            {...props}
          />
        ),
        hr: (props) => <hr className="my-6 border-zinc-800" {...props} />,
        table: (props) => (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm" {...props} />
          </div>
        ),
        thead: (props) => <thead className="border-b border-zinc-800" {...props} />,
        th: (props) => (
          <th className="px-3 py-2 text-left font-semibold text-zinc-300" {...props} />
        ),
        td: (props) => (
          <td className="border-b border-zinc-800/60 px-3 py-2 text-zinc-200" {...props} />
        ),
        strong: (props) => <strong className="font-semibold text-zinc-100" {...props} />,
        em: (props) => <em className="italic text-zinc-200" {...props} />,
      }}
    >
      {body}
    </ReactMarkdown>
  </div>
);
