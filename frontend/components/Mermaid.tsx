'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface MermaidProps {
  chart: string;
  caption?: string;
}

/**
 * Renders a Mermaid diagram client-side. The Tessera doc page is already a
 * client component, so we can dynamic-import the heavy mermaid bundle inside
 * a useEffect rather than shipping it on first paint.
 *
 * Theme is wired to the stone/orange palette used everywhere else in /docs —
 * dark backgrounds, stone-700 borders, orange-400 accents.
 */
export default function Mermaid({ chart, caption }: MermaidProps) {
  const reactId = useId().replace(/[:]/g, '');
  const renderId = `mermaid-${reactId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          securityLevel: 'strict',
          themeVariables: {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '13px',
            background: '#0c0a09',
            primaryColor: '#1c1917',
            primaryTextColor: '#e7e5e4',
            primaryBorderColor: '#57534e',
            secondaryColor: '#292524',
            secondaryTextColor: '#e7e5e4',
            secondaryBorderColor: '#44403c',
            tertiaryColor: '#0c0a09',
            tertiaryTextColor: '#a8a29e',
            tertiaryBorderColor: '#44403c',
            mainBkg: '#1c1917',
            secondBkg: '#292524',
            lineColor: '#a8a29e',
            textColor: '#e7e5e4',
            edgeLabelBackground: '#0c0a09',
            clusterBkg: '#0f0d0c',
            clusterBorder: '#44403c',
            actorBkg: '#1c1917',
            actorBorder: '#57534e',
            actorTextColor: '#e7e5e4',
            actorLineColor: '#78716c',
            signalColor: '#fb923c',
            signalTextColor: '#e7e5e4',
            labelBoxBkgColor: '#1c1917',
            labelBoxBorderColor: '#fb923c',
            labelTextColor: '#e7e5e4',
            loopTextColor: '#e7e5e4',
            noteBkgColor: '#0c0a09',
            noteBorderColor: '#44403c',
            noteTextColor: '#a8a29e',
            sequenceNumberColor: '#fb923c',
            activationBkgColor: '#292524',
            activationBorderColor: '#fb923c',
          },
          flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
          sequence: { useMaxWidth: true, mirrorActors: false, showSequenceNumbers: true },
          er: { useMaxWidth: true },
        });
        const { svg: out } = await mermaid.render(renderId, chart);
        if (!cancelled) setSvg(out);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [chart, renderId]);

  return (
    <figure className="mb-6">
      <div
        ref={containerRef}
        className="bg-stone-950 border border-stone-800 rounded-sm p-4 sm:p-6 overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
        dangerouslySetInnerHTML={{
          __html:
            error
              ? `<div class="text-red-400 text-sm font-mono">Diagram error: ${error.replace(/</g, '&lt;')}</div>`
              : svg ||
                '<div class="text-stone-500 text-xs font-mono py-8 text-center">Rendering diagram…</div>',
        }}
      />
      {caption && (
        <figcaption className="text-xs text-stone-500 mt-2 px-1 font-mono leading-relaxed">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
