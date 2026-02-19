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
    return `\\frac{${nodeToLatex(node.numer)}}{${nodeToLatex(node.denom)}}`;
  }

  if (node.type === "ordgroup") {
      return `{${node.body.map(nodeToLatex).join("")}}`;
  }

  if (node.text) return node.text;

  return "";
};

// Check if a node is \mathrm{d}, \delta, or \Delta (or similar differentials)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDifferential = (node: any): boolean => {
  if (!node) return false;

  // \delta, \Delta, \partial, \nabla
  if (node.type === "mathord" || node.type === "textord") {
    return ["\\delta", "\\Delta", "\\partial", "\\nabla"].includes(node.text);
  }

  // \mathrm{d}
  if (node.type === "font" && node.font === "mathrm") {
    const body = nodeToLatex(node.body);
    return body === "d";
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

    // Check allow-list or pattern
    if (["\\partial", "\\nabla"].includes(text)) return text;

    // Standard Latin/Greek letters
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

  let ast;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ast = (katex as any).__parse(latex, {
      throwOnError: false,
      strict: false
    });
  } catch (e) {
    console.error("KaTeX Parse Error:", e);
    return [];
  }

  const map = new Map<string, VariableInstance[]>();

  // Recursive traversal to find variables
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const traverse = (input: any[] | any) => {
    const nodes = Array.isArray(input) ? input : [input];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;

      let consumed = false;

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
            // It's a prefix! Combine them with a space for valid LaTeX
            const prefix = nodeToLatex(node);
            const variable = nodeToLatex(nextNode);
            const fullLatex = prefix + " " + variable;

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

        // If not consumed (standalone differential)
        if (!consumed) {
           const core = getCoreType(node);
           // Strict exclusion: do NOT add \delta, \Delta, d as types if standalone
           if (core && !["\\delta", "\\Delta", "d"].includes(core)) {
              // Only add if it's a valid variable type (e.g. \nabla, \partial if treated as var)
              const latex = nodeToLatex(node);
              if (!map.has(core)) map.set(core, []);
              map.get(core)?.push({ uuid: crypto.randomUUID(), type: core, latex });
              consumed = true;
           }
        }
      }
      // 2. Check for Standard Variable
      else if (!consumed) {
        const core = getCoreType(node);
        if (core) {
          // Check exclusion (redundant if getCoreType filters well, but safe)
          if (!["\\delta", "\\Delta", "d"].includes(core)) {
             const latex = nodeToLatex(node);
             if (!map.has(core)) map.set(core, []);
             map.get(core)?.push({ uuid: crypto.randomUUID(), type: core, latex });
             consumed = true;
          }
        }
      }

      // 3. Recurse into children if NOT consumed
      if (!consumed) {
        if (node.type === "ordgroup") traverse(node.body);
        if (node.type === "genfrac") {
           traverse(node.numer);
           traverse(node.denom);
        }
        if (node.type === "sqrt") {
           traverse(node.body);
        }
        // Add recursion for supsub if it wasn't consumed as a variable
        // Wait, getCoreType handles supsub by extracting base.
        // If a supsub IS a variable (e.g. x_i), it was consumed in step 2.
        // If it was NOT consumed (e.g. base not variable?), we might need to recurse?
        // But getCoreType logic is recursive for base.
        // If getCoreType returned null, step 2 failed.
        // Example: 2^x -> base 2 (null core).
        // We should recurse into 2^x components?
        // base=2 (no vars), sup=x (var).
        // Yes, need to handle supsub recursion for non-variable bases!

        if (node.type === "supsub") {
            // If we are here, it wasn't a variable instance (e.g. x_i).
            // So check base and sup/sub separately.
            traverse(node.base);
            if (node.sub) traverse(node.sub);
            if (node.sup) traverse(node.sup);
        }
      }
    }
  };

  traverse(ast);

  // Convert map to array and sort
  const result: ParsedCategory[] = [];
  map.forEach((instances, type) => {
    result.push({ type, instances });
  });

  return result.sort((a, b) => a.type.localeCompare(b.type));
};
