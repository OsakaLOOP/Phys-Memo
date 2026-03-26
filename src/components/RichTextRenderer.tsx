import { useEffect, useRef, memo, type FC } from 'react';
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
    if (!containerRef.current) return;

    // --- 1. Calculate Math Labels based on Headers ---
    const mathLabels: string[] = [];
    if (enableAnalysis) {
      let h2 = 0;
      let h3 = 0;
      let n = 0;

      // Regex to find Headers (H2/H3) OR Display Math
      // Group 1: Header markers (## or ###)
      // Group 2: Display Math ($$...$$)
      // We use 'm' flag for ^ matching start of line
      const scanRegex = /(^#{2,3})(?=\s)|(\$\$[\s\S]*?\$\$)/gm;

      let match;
      while ((match = scanRegex.exec(content)) !== null) {
        if (match[1]) {
          // Header found
          const level = match[1].length;
          if (level === 2) {
            h2++;
            h3 = 0;
            n = 0; // Reset formula counter
          } else if (level === 3) {
            h3++;
            n = 0; // Reset formula counter
          }
        } else if (match[2]) {
          // Display Math found
          n++;
          let label = `(${n})`;
          if (h2 > 0) {
            if (h3 > 0) {
              label = `(${h2}.${h3}.${n})`;
            } else {
              label = `(${h2}.${n})`;
            }
          }
          mathLabels.push(label);
        }
      }
    }

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

    let html = marked.parse(protectedText, { async: false });

    let displayMathIndex = 0;

    mathBlocks.forEach(item => {
      let renderedMath = "";
      try {
        renderedMath = katex.renderToString(item.tex, { throwOnError: false, displayMode: item.display });
      } catch {
        renderedMath = `<span class="text-red-500 error">LaTeX Error</span>`;
      }

      if (enableAnalysis && item.display) {
        const label = mathLabels[displayMathIndex] || "";
        displayMathIndex++;

        // Wrap with interactive container for display math
        // We use a data attribute to store the latex for later extraction
        // The container needs relative position for the absolute button
        // We add a specific class for the mounting point
        // Added 'pr-16' for right padding to accommodate the label
        const wrappedMath = `
          <div class="interactive-math-container relative group/math block w-full my-4 pr-16" data-latex="${encodeURIComponent(item.tex)}" data-label="${label}">
            ${renderedMath}
            <div class="analysis-mount-point absolute top-0 right-0 pointer-events-none w-full h-full"></div>
          </div>
        `;
        html = html.replace(item.id, wrappedMath);
      } else {
        // Increment index even if analysis disabled, to keep logic sound if we ever use labels elsewhere?
        // Actually mathLabels is only populated if enableAnalysis is true.
        // If enableAnalysis is false, displayMathIndex isn't used.
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
           const label = container.getAttribute('data-label') || "";

           if (mountPoint && latexEncoded) {
              const latex = decodeURIComponent(latexEncoded);

              // We create a wrapper div inside the mount point to actually hold the react root
              const root = createRoot(mountPoint);

              root.render(
                <div className="pointer-events-auto w-full h-full">
                    <FormulaAnalysis latex={latex} label={label} />
                </div>
              );
              mountedRoots.current.push(root);
           }
        });
      }
    }

    return () => {
      // Cleanup previous roots
      mountedRoots.current.forEach(root => {
        // Run unmount in next tick to avoid React "synchronous unmount during render" race conditions
        setTimeout(() => {
            root.unmount();
        }, 0);
      });
      mountedRoots.current = [];
    };
  }, [content, enableAnalysis]);

  return <div ref={containerRef} className={`markdown-body ${className}`} />;
};

export default memo(RichTextRenderer);
