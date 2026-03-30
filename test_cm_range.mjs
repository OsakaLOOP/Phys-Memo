import { Decoration } from '@codemirror/view';

const w = Decoration.widget({
  widget: { toDOM: () => document.createElement('span') },
  side: 1,
  block: true
});

const r1 = w.range(10);
const r2 = w.range(10, 10);

console.log("r1:", r1.from, r1.to, "r1 === r2?", JSON.stringify(r1) === JSON.stringify(r2));
console.log(r1)
console.log(r2)
