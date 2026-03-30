import { Decoration } from '@codemirror/view';

const w = Decoration.widget({
  widget: { toDOM: () => document.createElement('span') },
  side: 1,
  block: true
});

try {
  w.range(0, 10);
  console.log("widget with to did not throw");
} catch(e) {
  console.log("widget threw:", e.message);
}

const r = Decoration.replace({
  widget: { toDOM: () => document.createElement('span') },
  block: true
});

try {
  r.range(0, 10);
  console.log("replace with to did not throw");
} catch(e) {
  console.log("replace threw:", e.message);
}
