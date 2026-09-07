// One-off generator: reads draftout-goals.json and writes goals-data.js
// as a plain <script>-loadable global, so the app works over file:// with
// no fetch/CORS issues. Re-run this if draftout-goals.json changes.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'draftout-goals.json');
const out = path.join(__dirname, '..', 'goals-data.js');

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));

const baseGoals = raw.goals.map(g => ({
  id: g.id,
  name: g.name,
  needsData: g.needsData,
}));

const DYE_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink',
  'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red',
  'black',
];

const banner = `// Generated from draftout-goals.json by scripts/gen-goals-data.js
// Do not hand-edit — re-run the generator instead.
`;

const content = `${banner}
window.BASE_GOALS = ${JSON.stringify(baseGoals, null, 2)};

window.DYE_COLORS = ${JSON.stringify(DYE_COLORS, null, 2)};
`;

fs.writeFileSync(out, content);
console.log(`Wrote ${out} (${baseGoals.length} base goals, ${DYE_COLORS.length} colors)`);
