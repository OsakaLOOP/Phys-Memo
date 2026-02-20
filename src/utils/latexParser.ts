import katex from 'katex';

// Types
export interface VariableInstance {
  uuid: string; // unique ID for React keys
  type: string; // The "Base Type" (e.g., "x", "\alpha")
  latex: string; // The full instance string (e.g., "\Delta x_i")
}

export interface ParsedCategory {
  type: string;
  instances: VariableInstance[];
}

// --- Helpers ---

// Reconstruct LaTeX from AST
// This is a simplified reconstruction focused on standard math notation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeToLatex = (node: any): string => {
  if (!node) return "";

  if (node.type === "mathord" || node.type === "textord" || node.type === "atom") {
    return node.text;
  }

  if (node.type === "supsub") {
    let res = nodeToLatex(node.base);
    if (node.sub) {
      const subTex = nodeToLatex(node.sub);
      res += `_{${subTex}}`;
    }
    if (node.sup) {
      const supTex = nodeToLatex(node.sup);
      res += `^{${supTex}}`;
    }
    return res;
  }

  if (node.type === "accent") {
    return `${node.label}{${nodeToLatex(node.base)}}`;
  }

  if (node.type === "font") {
    return `\\${node.font}{${nodeToLatex(node.body)}}`;
  }

  if (node.type === "genfrac") {
    // Fractions etc: \frac{numer}{denom}
    // Note: Genfrac usually not "letters" but could contain them.
    // For now we might not be extracting "fractions" as variables,
    // but if a variable IS a fraction (rare), this handles it.
    return `\\frac{${nodeToLatex(node.numer)}}{${nodeToLatex(node.denom)}}`;
  }

  if (node.type === "ordgroup") {
      return `{${node.body.map(nodeToLatex).join("")}}`;
  }

  // Fallback for known "differential" like structures if they appear as simple text
  if (node.text) return node.text;

  return "";
};

// Check if a node is \mathrm{d}, \delta, or \Delta
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDifferential = (node: any): boolean => {
  if (!node) return false;

  // \delta, \Delta
  if (node.type === "mathord" || node.type === "textord") {
    return ["\\delta", "\\Delta", "\\partial", "\\nabla"].includes(node.text);
  }

  // \mathrm{d}
  if (node.type === "font" && node.font === "mathrm") {
    const body = nodeToLatex(node.body);
    return body === "d";
  }

  // Check for supsub where base is differential (e.g. d^2, \delta^n)
  if (node.type === "supsub") {
     return isDifferential(node.base);
  }

  return false;
};

// Get the "Core Type" (innermost base symbol)
// Returns null if it's not a valid "variable" (e.g. number, operator)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getCoreType = (node: any): string | null => {
  if (!node) return null;

  if (node.type === "mathord" || node.type === "textord") {
    const text = node.text;
    // Exclude numbers
    if (/^[\d.,]+$/.test(text)) return null;
    // Exclude common symbols that aren't variables
    if (["+", "-", "=", "(", ")", "[", "]", "\\rightarrow", "\\Rightarrow", "\\approx", "\\sim"].includes(text)) return null;
    // Exclude differentials (handled at higher level, but if we reach here they are Types)
    if (["\\partial", "\\nabla"].includes(text)) return text;

    // Standard Latin/Greek letters
    // Check if it looks like a letter or known LaTeX command for letter
    if (/^[a-zA-Z]$/.test(text)) return text;
    if (text.startsWith("\\")) return text; // Greek etc.

    return null;
  }

  if (node.type === "supsub") {
    return getCoreType(node.base);
  }

  if (node.type === "accent") {
    return getCoreType(node.base);
  }

  if (node.type === "font") {
    
    // Type is the inner content, without style or script, unless it's \mathrm{d}, special case.
    return getCoreType(node.body);
  }

  if (node.type === "ordgroup" && node.body.length === 1) {
      return getCoreType(node.body[0]);
  }

  return null;
};

// Main Parser Function
export const parseFormula = (latex: string): ParsedCategory[] => {
  if (!latex) return [];

  // Strip delimiters ($$, $, \[, \])
  const cleanLatex = latex
    .trim()
    .replace(/^(\$\$|\$|\\\[)(.*?)(\$\$|\$|\\\])$/s, '$2');

  let ast;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ast = (katex as any).__parse(cleanLatex, {
      throwOnError: false,
      strict: false
    });
  } catch (e) {
    console.error("KaTeX Parse Error:", e);
    return [];
  }

  const map = new Map<string, VariableInstance[]>();

  // Flatten AST if top level is just an array.
  // Note: KaTeX __parse returns an array of nodes.

  // Recursive traversal to find variables
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const traverse = (input: any[] | any) => {
    const nodes = Array.isArray(input) ? input : [input];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;

      let consumed = false;

      // Special Check: d/dx form (genfrac)
      if (node.type === "genfrac") {
          // Check if numerator is just "d" or "\partial"
          // We can reuse isDifferential but need to check if it's the ONLY thing in numerator
          // node.numer is typically an ordgroup or list of nodes.
          const numerBody = node.numer.type === "ordgroup" ? node.numer.body : (Array.isArray(node.numer) ? node.numer : [node.numer]);

          if (numerBody.length === 1 && isDifferential(numerBody[0])) {
             // It's likely a derivative operator like d/dt or \partial/\partial x
             // The user wants this to be associated with the variable in denominator?
             // "把 d/dx ... 也看成一个整体, 算到分类x里"
             // This implies we extract 'x' from 'dx' in denominator.

             // Check denominator
             const denomBody = node.denom.type === "ordgroup" ? node.denom.body : (Array.isArray(node.denom) ? node.denom : [node.denom]);

             // We expect something like 'd x' or '\partial x' in denominator
             // Or if it's just 'dx' where d is differential

             // Let's try to match the pattern in denominator:
             // It might be [d, x] or just one node if parsed differently?
             // Usually 'dx' is parsed as 'd' (mathord/font) and 'x' (mathord).

             // Find the differential node in denominator matching the numerator's style if possible, or just any differential
             let diffIndex = -1;
             for(let k=0; k<denomBody.length; k++) {
                 if (isDifferential(denomBody[k])) {
                     diffIndex = k;
                     break;
                 }
             }

             if (diffIndex !== -1 && diffIndex + 1 < denomBody.length) {
                 const varNode = denomBody[diffIndex + 1];
                 const core = getCoreType(varNode);
                 if (core) {
                     const fullLatex = nodeToLatex(node); // The whole fraction \frac{d}{dx}

                     if (!map.has(core)) map.set(core, []);
                     map.get(core)?.push({
                        uuid: crypto.randomUUID(),
                        type: core,
                        latex: fullLatex
                     });
                     consumed = true;

                     // We should NOT traverse into numer/denom if we consumed the whole fraction
                     // But we might want to check for other variables in denom?
                     // "d/dx" is operator.
                     // If denom was "d(x^2)", then x is variable?
                     // User example is simple "d/dx".
                     // Let's assume for this specific structure we consume it entirely.
                 }
             }
          }
      }

      // 0. Check for Exponential e^... (Special Case)
      // Must have superscript, NO subscript, and base must be 'e'
      if (node.type === "supsub" && !node.sub && node.sup) {
          const baseTex = nodeToLatex(node.base);
          if (baseTex === 'e') {
              // It is e^... with no subscript.
              // Treat as exponential function: ignore 'e', recurse into superscript.
              traverse(node.sup);
              consumed = true;
          }
      }

      // 1. Check for Differential Prefix
      if (!consumed && isDifferential(node)) {
        // Look ahead
        if (i + 1 < nodes.length) {
          const nextNode = nodes[i + 1];
          const core = getCoreType(nextNode);
          if (core) {
            // It's a prefix! Combine them.
            const prefix = nodeToLatex(node);
            const variable = nodeToLatex(nextNode);
            const fullLatex = prefix + " " + variable; // Add space to prevent rendering errors (e.g., \Delta x)

            if (!map.has(core)) map.set(core, []);
            map.get(core)?.push({
              uuid: crypto.randomUUID(),
              type: core,
              latex: fullLatex
            });

            i++; // Skip next node
            consumed = true;
          }
        }

        // If not consumed (standalone differential), treat as variable
        if (!consumed) {
           const latex = nodeToLatex(node);
           // Ignore isolated \mathrm{d} or d
           if (latex !== "\\mathrm{d}" && latex !== "d") {
              const typeName = latex; // Use the latex itself as type name for these specials
              if (!map.has(typeName)) map.set(typeName, []);
              map.get(typeName)?.push({ uuid: crypto.randomUUID(), type: typeName, latex });
              consumed = true;
           } else {
              consumed = true; // Consumed but ignored
           }
        }
      }
      // 2. Check for Standard Variable
      else if (!consumed) {
        const core = getCoreType(node);
        if (core) {
          // Check if it's an excluded differential symbol (in case it slipped through as mathord)
          if (!["\\delta", "\\Delta", "d"].includes(core)) {
             const latex = nodeToLatex(node);
             if (!map.has(core)) map.set(core, []);
             map.get(core)?.push({ uuid: crypto.randomUUID(), type: core, latex });
             consumed = true;
          }
        }
      }

      // 3. Recurse into children if NOT consumed
      // If we consumed it as a variable, we treat it as atomic. We don't look inside for more variables.
      // e.g. x_i, we want "x_i" as instance of "x". We do NOT want "i" as instance of "i" separately?
      // "提取出最终的不可分割字母整体... 对象包含这些样式以及所属的类型"
      // Usually in Physics context, x_i is the symbol. i is just an index.
      // User said: "subscripts... included in instance".
      // So yes, we do NOT recurse into consumed variables.

      if (!consumed) {
        // Recurse to find variables inside non-variable structures (like fractions, sqrt, etc)
        // Note: supsub/accent/font ARE variable structures so they would be consumed if valid.
        // So we only recurse if getCoreType returned null (e.g. operators, relations, or complex groupings)

        if (node.type === "ordgroup") traverse(node.body);
        if (node.type === "genfrac") {
           traverse(node.numer);
           traverse(node.denom);
        }
        if (node.type === "sqrt") {
           traverse(node.body);
        }
        if (node.type === "supsub") {
            traverse(node.base);
            traverse(node.sub);
            traverse(node.sup);
        }
        if (node.type === "leftright") {
            traverse(node.body);
        }
      }
    }
  };

  traverse(ast);

  // Convert map to array
  const result: ParsedCategory[] = [];
  map.forEach((instances, type) => {
    result.push({ type, instances });
  });

  return result.sort((a, b) => a.type.localeCompare(b.type));
};
