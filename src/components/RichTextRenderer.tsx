import { useEffect, useRef, type FC } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { marked } from 'marked';
import katex from 'katex';
import FormulaAnalysis from './FormulaAnalysis';

// --- Rich Text Renderer Component ---

interface RichTextRendererProps {
  content: string;
  className?: string;
  enableAnalysis?: boolean;
}

const RichTextRenderer: FC<RichTextRendererProps> = ({ content, className = "", enableAnalysis = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRoots = useRef<Root[]>([]);

  useEffect(() => {
    // Cleanup previous roots
    mountedRoots.current.forEach(root => root.unmount());
    mountedRoots.current = [];

    if (!containerRef.current) return;

    const mathBlocks: Array<{ id: string; tex: string; display: boolean }> = [];
    // Regex to capture $$...$$ (display) and $...$ (inline)
    const protectedText = content.replace(/\$\$(.*?)\$\$|\$(.*?)\$/gs, (_match: string, blockMath: string, inlineMath: string) => {
      const id = `%%%MATH_${mathBlocks.length}%%%`;
      // blockMath is defined if $$ matched, inlineMath if $ matched
      const tex = blockMath !== undefined ? blockMath : inlineMath;
      const display = blockMath !== undefined;
      mathBlocks.push({ id, tex, display });
      return id;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let html = (marked as any).parse(protectedText) as string;

    mathBlocks.forEach(item => {
      let renderedMath = "";
      try {
        renderedMath = katex.renderToString(item.tex, { throwOnError: false, displayMode: item.display });
      } catch {
        renderedMath = `<span class="text-red-500 error">LaTeX Error</span>`;
      }

      if (enableAnalysis && item.display) {
        // Wrap with interactive container for display math
        // We use a data attribute to store the latex for later extraction
        // The container needs relative position for the absolute button
        // We add a specific class for the mounting point
        const wrappedMath = `
          <div class="interactive-math-container relative group/math block w-full my-4" data-latex="${encodeURIComponent(item.tex)}">
            ${renderedMath}
            <div class="analysis-mount-point absolute top-0 right-0 pointer-events-none w-full h-full"></div>
          </div>
        `;
        html = html.replace(item.id, wrappedMath);
      } else {
        html = html.replace(item.id, renderedMath);
      }
    });

    // Handle citations [1] -> superscript links
    html = html.replace(/\[(\d+)\]/g, (_match: string, num: string) => {
      return `<sup class="ref-sup"><a href="#ref-${num}" class="ref-link inline-block px-1 rounded text-indigo-600 bg-indigo-50 hover:bg-indigo-100 font-mono text-[10px] cursor-pointer select-none no-underline !border-none" style="border: none; text-decoration: none;" onclick="event.stopPropagation(); const el = document.getElementById('ref-${num}'); if(el){ el.scrollIntoView({behavior: 'smooth'}); el.classList.add('bg-yellow-100'); setTimeout(()=>el.classList.remove('bg-yellow-100'), 2000); } return false;">[${num}]</a></sup>`;
    });

    if (containerRef.current) {
      containerRef.current.innerHTML = html;

      // Mount analysis components if enabled
      if (enableAnalysis) {
        const containers = containerRef.current.querySelectorAll('.interactive-math-container');
        containers.forEach(container => {
           const mountPoint = container.querySelector('.analysis-mount-point');
           const latexEncoded = container.getAttribute('data-latex');
           if (mountPoint && latexEncoded) {
              const latex = decodeURIComponent(latexEncoded);

              // We create a wrapper div inside the mount point to actually hold the react root
              // because createRoot expects a container.
              // Actually mountPoint IS the container.
              // Note: pointer-events-none on mountPoint allows clicking through to math if needed,
              // but the button inside FormulaAnalysis needs pointer-events-auto.
              // So FormulaAnalysis root div should handle pointer events.

              const root = createRoot(mountPoint);
              // FormulaAnalysis handles its own positioning (absolute top right)
              // But here we are rendering it inside an absolute div covering the whole block?
              // Let's check FormulaAnalysis.tsx
              // It has `absolute top-0 right-0`.
              // So if we render it inside `analysis-mount-point` which is also `absolute top-0 right-0 w-full h-full`,
              // The FormulaAnalysis div will be relative to that.

              // Actually, simpler: just render into a div at the end of container.
              // My HTML above has `<div class="analysis-mount-point ..."></div>`.
              // That div is absolute, covering the whole math block.
              // FormulaAnalysis has `absolute top-0 right-0`.
              // So it will appear at top right of the math block. Correct.

              // We need to ensure the button is clickable.
              // The mountPoint has `pointer-events-none`.
              // The button inside `FormulaAnalysis` needs `pointer-events-auto`.
              // I should update FormulaAnalysis to have `pointer-events-auto` on its container or button.
              // Or just make mountPoint specific to the button area?
              // No, because the Modal needs to overflow/expand.

              // Let's assume FormulaAnalysis components have appropriate pointer-events styling.
              // Checking FormulaAnalysis.tsx:
              // Root div: `absolute top-0 right-0 z-20` (onMouseEnter/Leave)
              // It doesn't explicitly set pointer-events.
              // If parent (mountPoint) is pointer-events-none, children are too unless overridden.

              root.render(
                <div className="pointer-events-auto">
                    <FormulaAnalysis latex={latex} />
                </div>
              );
              mountedRoots.current.push(root);
           }
        });
      }
    }
  }, [content, enableAnalysis]);

  return <div ref={containerRef} className={`markdown-body ${className}`} />;
};

export default RichTextRenderer;
