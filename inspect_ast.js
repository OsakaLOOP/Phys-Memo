import katex from 'katex';

const formulas = [
  "x",
  "\\alpha",
  "x_i^2",
  "\\hat{x}",
  "\\mathrm{d}x",
  "\\Delta t",
  "\\sin x",
  "\\Delta",
  "\\vec{v}_0"
];

formulas.forEach(f => {
  console.log(`--- Formula: ${f} ---`);
  try {
    const ast = katex.__parse(f);
    console.log(JSON.stringify(ast, null, 2));
  } catch (e) {
    console.error(e);
  }
});
