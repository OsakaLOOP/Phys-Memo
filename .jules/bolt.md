## 2024-03-26 - [Avoid N+1 Queries in React Client]
**Learning:** Found sequential loops executing await inside `.map()` or `for...of` across UI components (`TopicChildCard`, `App`) and `core` utilities. This caused major I/O bottlenecks in IndexedDB storage retrieval since React had to wait for each promise to resolve sequentially.
**Action:** Used `Promise.all` to convert O(N) sequential queries into O(1) batched concurrent operations to prevent blocked rendering when loading multiple concepts or edition atoms.
