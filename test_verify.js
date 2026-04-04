import fs from 'fs';

const content = fs.readFileSync('src/App.tsx', 'utf8');
if (content.includes('tickCount % 3 === 0')) {
  console.log('throttle condition found!');
} else {
  console.log('throttle condition missing!');
  process.exit(1);
}
