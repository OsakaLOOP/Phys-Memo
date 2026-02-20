import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const katex = require('katex');

const latex = '\begin{array}{cc} a & b \\ c & d \end{array}';
try {
    const ast = katex.__parse(latex, { strict: false });
    console.log(JSON.stringify(ast, null, 2));
} catch (e) {
    console.error(e);
}
