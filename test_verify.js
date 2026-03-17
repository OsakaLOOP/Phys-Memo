import fs from 'fs';

const storeContent = fs.readFileSync('src/store/workspaceStore.ts', 'utf8');
const editorContent = fs.readFileSync('src/components/AttrStrand/AtomListEditor.tsx', 'utf8');

if (storeContent.includes('list.unshift(id);')) {
  console.log('WorkspaceStore fixed.');
} else {
  console.error('WorkspaceStore bug NOT fixed.');
  process.exit(1);
}

if (editorContent.includes('w-full h-[66px] rounded-lg mt-0')) {
  console.log('AtomListEditor fixed.');
} else {
  console.error('AtomListEditor NOT fixed.');
  process.exit(1);
}

console.log('Verification Complete.');
