## 2024-03-26 - [Avoid N+1 Queries in React Client]
**Learning:** Found sequential loops executing await inside `.map()` or `for...of` across UI components (`TopicChildCard`, `App`) and `core` utilities. This caused major I/O bottlenecks in IndexedDB storage retrieval since React had to wait for each promise to resolve sequentially.
**Action:** Used `Promise.all` to convert O(N) sequential queries into O(1) batched concurrent operations to prevent blocked rendering when loading multiple concepts or edition atoms.

## 2024-05-15 - [Optimize KnowledgeGraph re-rendering]
**Learning:** In React, passing inline functions (like `onNodeClick={() => ...}`) to heavy components (like D3 wrappers) breaks memoization because a new function reference is created on every render. This forces the child component to re-render, which in the case of D3 can cause the entire SVG simulation to tear down and rebuild, severely hurting performance.
**Action:** Always wrap heavy child components with `React.memo` and ensure any function props passed to them are wrapped in `React.useCallback` with stable dependencies to preserve reference equality.

## 2024-05-18 - [Memoize derived topic node datasets in React renders]
**Learning:** Found multiple identical derived state calculations (e.g. `nodes.filter(...)` and `Array.from(new Set(...))`) directly inside JSX within the "TOPIC OVERVIEW PAGE" render path of `src/App.tsx`. This causes expensive O(N) array allocation and iterations on every render, especially when the nodes array is large.
**Action:** Always extract heavy derived array calculations inside React functional components into `useMemo` hooks with proper dependency arrays, and reuse the memoized variables throughout the JSX.
