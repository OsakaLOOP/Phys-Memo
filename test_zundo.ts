import { create } from 'zustand';
import { temporal } from 'zundo';

interface State {
  count: number;
  cmGroupId: string | null;
  inc: (g: string | null) => void;
}

const useStore = create<State>()(
  temporal(
    (set) => ({
      count: 0,
      cmGroupId: null,
      inc: (g) => set((state) => ({ count: state.count + 1, cmGroupId: g })),
    }),
    {
       partialize: (state) => ({ count: state.count, cmGroupId: state.cmGroupId })
    }
  )
);

useStore.getState().inc('group1');
useStore.getState().inc('group1');
useStore.getState().inc('group1');
useStore.getState().inc('group2');
useStore.getState().inc('group2');

console.log("Current state:", useStore.getState());
const temporalStore = useStore.temporal.getState();
console.log("Past states:", temporalStore.pastStates.map(s => `count:${s.count} grp:${s.cmGroupId}`));

// Find how many steps back to jump to the last state of 'group1'
const past = temporalStore.pastStates;
let stepsToUndo = 1;
// ... we'll implement this logic ...
