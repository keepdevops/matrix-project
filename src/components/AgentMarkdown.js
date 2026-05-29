import React, { lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../styles/AgentMarkdown.css';

const SwarmEditor = lazy(() => import('./SwarmEditor'));

function CodeBlock({ children, className }) {
  const lang = className?.replace('language-', '') || 'text';
  const code = String(children).replace(/\n$/, '');
  return (
    <Suspense fallback={<pre className="agent-md-pre">{code}</pre>}>
      <SwarmEditor code={code} language={lang} editable={false} height="auto" />
    </Suspense>
  );
}

function AgentMarkdown({ text }) {
  if (!text) return null;
  return (
    <div className="agent-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children }) {
            if (inline) {
              return <code className="agent-md-inline-code">{children}</code>;
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          pre({ children }) {
            return <>{children}</>;
          },
          // Use div instead of p so block-level children (CodeBlock → SwarmEditor/pre)
          // don't violate HTML nesting rules (<pre>/<div> inside <p> is invalid).
          p({ children }) {
            return <div className="agent-md-p">{children}</div>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default AgentMarkdown;
