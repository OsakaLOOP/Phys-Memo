import katex from 'katex';
const latex = '\begin{array}{cc} a & b \\ c & d \end{array}';
// Access internal parse method. Note: it might not be exposed on the default export in ESM.
// If this fails, I might need to try a different approach.
// But based on previous read_file of latexParser.ts, it uses (katex as any).__parse
// So let's try accessing it.
const ast = katex.__parse(latex, { strict: false });
console.log(JSON.stringify(ast, null, 2));
