import { create } from 'zustand';
import { temporal } from 'zundo';

const useStore = create(
  temporal(
    (set) => ({
      count: 0,
      inc: () => set((state) => ({ count: state.count + 1 })),
    }),
    { partialize: (state) => ({ count: state.count }) }
  )
);

useStore.getState().inc(); // count = 1
useStore.getState().inc(); // count = 2
useStore.getState().inc(); // count = 3

const temporalStore = useStore.temporal.getState();
console.log("Current count:", useStore.getState().count); // 3
console.log("Past states:", temporalStore.pastStates.map(s => s.count));

temporalStore.undo(2);
console.log("--- After undo(2) ---");
console.log("Current count:", useStore.getState().count); // 1
console.log("Past states:", useStore.temporal.getState().pastStates.map(s => s.count));
console.log("Future states:", useStore.temporal.getState().futureStates.map(s => s.count));
