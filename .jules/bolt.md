## 2024-03-26 - [Avoid N+1 Queries in React Client]
**Learning:** Found sequential loops executing await inside `.map()` or `for...of` across UI components (`TopicChildCard`, `App`) and `core` utilities. This caused major I/O bottlenecks in IndexedDB storage retrieval since React had to wait for each promise to resolve sequentially.
**Action:** Used `Promise.all` to convert O(N) sequential queries into O(1) batched concurrent operations to prevent blocked rendering when loading multiple concepts or edition atoms.

## 2024-05-15 - [Optimize KnowledgeGraph re-rendering]
**Learning:** In React, passing inline functions (like `onNodeClick={() => ...}`) to heavy components (like D3 wrappers) breaks memoization because a new function reference is created on every render. This forces the child component to re-render, which in the case of D3 can cause the entire SVG simulation to tear down and rebuild, severely hurting performance.
**Action:** Always wrap heavy child components with `React.memo` and ensure any function props passed to them are wrapped in `React.useCallback` with stable dependencies to preserve reference equality.

## 2024-11-20 - [Avoid Redundant Array Filtrations in Render]
**Learning:** Found multiple identical inline array filtrations (`nodes.filter(...)`) during the render cycle of the TOPIC OVERVIEW page in `src/App.tsx`. Because `nodes` can be a very large array containing all concepts and topics, filtering it 5 separate times per render turns an O(N) operation into O(5N) and allocates new arrays unnecessarily.
**Action:** Use `useMemo` to compute derived data like filtered children arrays or unique discipline lists once per dependency change (`nodes` or `activeNode`). Then, reference these memoized values in the JSX to prevent wasteful recalculations during state updates.
## 2024-05-18 - [Memoize derived topic node datasets in React renders]
**Learning:** Found multiple identical derived state calculations (e.g. `nodes.filter(...)` and `Array.from(new Set(...))`) directly inside JSX within the "TOPIC OVERVIEW PAGE" render path of `src/App.tsx`. This causes expensive O(N) array allocation and iterations on every render, especially when the nodes array is large.
**Action:** Always extract heavy derived array calculations inside React functional components into `useMemo` hooks with proper dependency arrays, and reuse the memoized variables throughout the JSX.

## 2026-03-31 - [Replace O(N²) nested array search with O(N) iteration]
**Learning:** Found an O(N²) anti-pattern in `src/components/AttrStrand/hooks/useNetworkLayout.ts` where a `while (unassignedIds.size > 0)` loop repeatedly called `Array.prototype.find()` on an already sorted array of length N. This causes expensive redundant searches for tracking branch history in the ConceptNetworkView.
**Action:** Replaced the `while` loop and inner `find()` with a single `for...of` iteration over the pre-sorted array, skipping assigned IDs using the `Set.has()` check. This drops the algorithm's time complexity to O(N).
## 2025-04-08 - [Performance] O(1) Serializer for deterministic stringification
**Learning:** Found an exponential bottleneck in recursive `deterministicStringify`. By calling `JSON.parse` recursively, performance degrades immensely on complex objects.
**Action:** Replace `JSON.parse/stringify` in deep recursive layers with an in-memory key-sorting approach, doing the JSON conversion exactly once at the end.
