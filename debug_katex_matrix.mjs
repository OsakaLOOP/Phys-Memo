import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const katex = require('katex');

const latex = '\begin{pmatrix} x & y \\ z & w \end{pmatrix}';
try {
    const ast = katex.__parse(latex, { strict: false });
    console.log(JSON.stringify(ast, null, 2));
} catch (e) {
    console.error(e);
}
