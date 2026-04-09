## 2024-05-18 - Missing ARIA label for delete button
**Learning:** Found a delete button with a class `btn-danger` that only contains an icon `<Trash2>` but lacks an `aria-label` or equivalent text alternative. This is inaccessible for screen readers.
**Action:** Add `aria-label="删除条目"` to the button to improve accessibility.
