import React, { useEffect, useRef, type FC } from 'react';

// --- Rich Text Renderer Component ---

interface RichTextRendererProps {
  content: string;
  className?: string;
}

const RichTextRenderer: FC<RichTextRendererProps> = ({ content, className = "" }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const marked = (window as unknown as any).marked;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const katex = (window as unknown as any).katex;

    if (!containerRef.current || !marked || !katex) {
      if (containerRef.current) containerRef.current.innerText = content;
      return;
    }

    const mathBlocks: Array<{ id: string; tex: string; display: boolean }> = [];
    const protectedText = content.replace(/\$\$(.*?)\$\$|\$(.*?)\$/gs, (_match: string, blockMath: string, inlineMath: string) => {
      const id = `%%%MATH_${mathBlocks.length}%%%`;
      mathBlocks.push({ id, tex: blockMath || inlineMath, display: !!blockMath });
      return id;
    });

    let html = marked.parse(protectedText);

    mathBlocks.forEach(item => {
      let renderedMath = "";
      try {
        renderedMath = katex.renderToString(item.tex, { throwOnError: false, displayMode: item.display });
      } catch {
        renderedMath = `<span class="text-red-500 error">LaTeX Error</span>`;
      }
      html = html.replace(item.id, renderedMath);
    });

    html = html.replace(/\[(\d+)\]/g, (_match: string, num: string) => {
      return `<sup class="ref-sup"><a href="#ref-${num}" class="ref-link inline-block px-1 rounded text-indigo-600 bg-indigo-50 hover:bg-indigo-100 font-mono text-[10px] cursor-pointer select-none no-underline !border-none" style="border: none; text-decoration: none;" onclick="event.stopPropagation(); const el = document.getElementById('ref-${num}'); if(el){ el.scrollIntoView({behavior: 'smooth'}); el.classList.add('bg-yellow-100'); setTimeout(()=>el.classList.remove('bg-yellow-100'), 2000); } return false;">[${num}]</a></sup>`;
    });

    if (containerRef.current) {
      containerRef.current.innerHTML = html;
    }
  }, [content]);

  return <div ref={containerRef} className={`markdown-body ${className}`} />;
};

export default RichTextRenderer;
