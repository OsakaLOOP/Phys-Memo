## 2024-05-18 - [Optimizing Topic Title Modification UI]
**Learning:** In global React state updates containing tree-like data modifications (like updating a node and its children), using `Array.prototype.find()` inside `Array.prototype.map()` creates an $O(N^2)$ bottleneck. Similarly, sequentially awaiting `IndexedDB.put` requests blocks the main thread unnecessarily.
**Action:** Always combine array filtering and mapping into a single $O(N)$ pass. Always batch independent DB updates (like saving multiple child nodes) using `Promise.all()` to prevent UI stutter during state updates.
