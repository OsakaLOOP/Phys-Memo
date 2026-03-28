## 2024-03-26 - [Avoid N+1 Queries in React Client]
**Learning:** Found sequential loops executing await inside `.map()` or `for...of` across UI components (`TopicChildCard`, `App`) and `core` utilities. This caused major I/O bottlenecks in IndexedDB storage retrieval since React had to wait for each promise to resolve sequentially.
**Action:** Used `Promise.all` to convert O(N) sequential queries into O(1) batched concurrent operations to prevent blocked rendering when loading multiple concepts or edition atoms.

## 2024-03-26 - [Prevent Expensive Re-renders in D3 Visualizations]
**Learning:** Complex visualization components like the D3 `KnowledgeGraph` in `src/App.tsx` were completely destroyed and recreated on every parent state change (e.g., typing in a search bar). This was caused by passing an inline arrow function as an `onNodeClick` handler, which triggered the `useEffect` responsible for D3 initialization.
**Action:** Wrap heavy React components like `KnowledgeGraph` in `React.memo()` and use `useCallback` for event handlers passed as props to avoid unnecessary and expensive DOM/physics simulation rebuilds.
