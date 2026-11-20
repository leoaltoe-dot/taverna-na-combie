// Gera o desenho em pixel art da Kombi (logo e ícone do app).
const MAP = [
  '............yy..',
  '..............y.',
  '...........y..y.',
  '...PPPPPPPP.y...',
  '..PPPPPPPPPPP...',
  '..PkkPkkPkkPkP..',
  '..PkkPkkPkkPkkP.',
  '..PPPPPPPPPPPPP.',
  '..WWWWWWWWWWWWW.',
  '..WWWWWWWWWWWWWy',
  '..WWWWWWWWWWWWW.',
  '..DbbbDDDDbbbDD.',
  '...bgb....bgb...',
  '...bbb....bbb...',
];
const COLORS = { P: '#b026ff', p: '#d68cff', k: '#12062a', W: '#f3e8ff', D: '#6d12b8', b: '#07020f', g: '#b9a3d6', y: '#ffd23f' };
module.exports = function svg({ size = 16, bg = null, pad = 0, round = false } = {}) {
  const w = 16 + pad * 2, h = 14 + pad * 2;
  const side = Math.max(w, h);
  const ox = (side - 16) / 2, oy = (side - 14) / 2;
  let rects = '';
  MAP.forEach((row, y) => [...row].forEach((c, x) => {
    if (COLORS[c]) rects += `<rect x="${x + ox}" y="${y + oy}" width="1.02" height="1.02" fill="${COLORS[c]}"/>`;
  }));
  const back = bg ? (round ? `<circle cx="${side / 2}" cy="${side / 2}" r="${side / 2}" fill="${bg}"/>` : `<rect width="${side}" height="${side}" rx="${side * 0.18}" fill="${bg}"/>`) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">${back}${rects}</svg>`;
};

