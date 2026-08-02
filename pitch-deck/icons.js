const React = require('react');
const ReactDOMServer = require('react-dom/server');
const sharp = require('sharp');
const fs = require('fs');
const {
  FiClock, FiLayers, FiTrendingUp, FiShield, FiZap, FiLink,
  FiCpu, FiUsers, FiCheckCircle, FiDollarSign, FiRepeat, FiActivity,
} = require('react-icons/fi');

const ICONS = {
  clock: FiClock,
  layers: FiLayers,
  trending: FiTrendingUp,
  shield: FiShield,
  zap: FiZap,
  link: FiLink,
  cpu: FiCpu,
  users: FiUsers,
  check: FiCheckCircle,
  dollar: FiDollarSign,
  repeat: FiRepeat,
  activity: FiActivity,
};

async function renderIcon(name, color, outPath, size = 256) {
  const Icon = ICONS[name];
  if (!Icon) throw new Error(`Unknown icon: ${name}`);
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Icon, { size, color, style: { display: 'block' } })
  );
  const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`;
  await sharp(Buffer.from(fullSvg)).png().toFile(outPath);
  return outPath;
}

async function renderAll(color, dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const out = {};
  for (const name of Object.keys(ICONS)) {
    const p = `${dir}/${name}_${color}.png`;
    await renderIcon(name, color, p);
    out[name] = p;
  }
  return out;
}

module.exports = { renderIcon, renderAll };
