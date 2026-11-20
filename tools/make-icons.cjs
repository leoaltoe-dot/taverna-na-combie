// Gera os ícones (PNG) do app Windows e Android a partir da Kombi em pixel art.
// Uso: npm i --no-save @resvg/resvg-js && node tools/make-icons.cjs
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const svg = require('./pixel-van.js');
const root = path.join(__dirname, '..');
const render = (svgText, size) => new Resvg(svgText, { fitTo: { mode: 'width', value: size }, shapeRendering: 0 }).render().asPng();
const write = (file, buf) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); console.log('ícone', path.relative(root, file)); };

const square = svg({ bg: '#1b0a3a', pad: 3 });
write(path.join(root, 'desktop/build/icon.png'), render(square, 512));
const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, size] of Object.entries(dens)) {
  const dir = path.join(root, `android/app/src/main/res/mipmap-${d}`);
  write(path.join(dir, 'ic_launcher.png'), render(square, size));
  write(path.join(dir, 'ic_launcher_round.png'), render(svg({ bg: '#1b0a3a', pad: 4, round: true }), size));
}
