/** Generates SVG images for test catalogue fixtures. */
const COLORS = {
  Black: ["#1b1d22", "#2c2f36"], "Space Black": ["#202226", "#34373d"], Graphite: ["#3a3d42", "#4c5057"], Midnight: ["#1f2530", "#2e3644"],
  White: ["#f4f5f7", "#dfe2e8"], Silver: ["#d9dce1", "#bfc4cc"], Starlight: ["#ece6dc", "#d9d1c3"], Gold: ["#e6d3b3", "#cdb48a"],
  Blue: ["#3d6ad6", "#2a4fae"], "Sierra Blue": ["#9bb6d3", "#7b9abb"], Green: ["#4f7a62", "#3b6049"], Pink: ["#f0b8c6", "#dc93a7"],
  Red: ["#d1343f", "#a8232d"], Purple: ["#8f7bd6", "#6d58b8"], "Natural Titanium": ["#b8b3aa", "#9d978d"], "Titanium Black": ["#2e2f33", "#43454a"],
  "Titanium Gray": ["#7e8085", "#65676c"], Lavender: ["#c7b7e6", "#a692cf"], Mint: ["#b5e0cf", "#8fc9b2"], Orange: ["#f08a3c", "#d06a1e"], Yellow: ["#f2d35a", "#d9b73a"],
  "Space Gray": ["#6d7075", "#55585d"], Grey: ["#8a8d93", "#6f7278"], "Deep Blue": ["#27439a", "#1b2f73"],
};
export const colorPair = (name) => COLORS[name] || COLORS.Black;

const bg = (id) => `<defs><radialGradient id="bg${id}" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3e9f5"/></radialGradient></defs><ellipse cx="400" cy="690" rx="230" ry="22" fill="#0b1633" opacity=".10"/>`;
const wrap = (inner, id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img">${bg(id)}${inner}</svg>`;

function phone(c, { brand, fold } = {}) {
  const [a, b] = c;
  const lens = brand === "Apple"
    ? `<rect x="300" y="170" width="112" height="112" rx="28" fill="${b}" opacity=".55"/><circle cx="335" cy="205" r="20" fill="#0c0d10"/><circle cx="380" cy="205" r="20" fill="#0c0d10" opacity="0"/><circle cx="335" cy="205" r="12" fill="#1c2a44"/><circle cx="378" cy="248" r="20" fill="#0c0d10"/><circle cx="378" cy="248" r="12" fill="#1c2a44"/><circle cx="335" cy="248" r="0"/><circle cx="385" cy="200" r="8" fill="#f6f0d6"/>`
    : `<circle cx="338" cy="205" r="20" fill="#0c0d10"/><circle cx="338" cy="205" r="11" fill="#1c2a44"/><circle cx="338" cy="256" r="20" fill="#0c0d10"/><circle cx="338" cy="256" r="11" fill="#1c2a44"/><circle cx="338" cy="307" r="20" fill="#0c0d10"/><circle cx="338" cy="307" r="11" fill="#1c2a44"/>`;
  return `<defs><linearGradient id="pb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect x="270" y="110" width="260" height="540" rx="46" fill="url(#pb)"/><rect x="270" y="110" width="260" height="540" rx="46" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="3"/>
${lens}${fold ? `<line x1="270" y1="380" x2="530" y2="380" stroke="#000" stroke-opacity=".25" stroke-width="3"/>` : ""}
<rect x="283" y="140" width="6" height="60" rx="3" fill="#000" opacity=".18"/><rect x="511" y="190" width="6" height="90" rx="3" fill="#000" opacity=".18"/>`;
}
function laptop(c, { mac } = {}) {
  const [a, b] = c;
  return `<defs><linearGradient id="lw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mac ? "#7a8cff" : "#2b6cff"}"/><stop offset=".55" stop-color="${mac ? "#c26bff" : "#19c3d9"}"/><stop offset="1" stop-color="#ffb26b"/></linearGradient><linearGradient id="lb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect x="165" y="185" width="470" height="300" rx="16" fill="#101216"/><rect x="178" y="198" width="444" height="274" rx="8" fill="url(#lw)"/>${mac ? `<rect x="370" y="185" width="60" height="14" rx="7" fill="#101216"/>` : `<circle cx="400" cy="191" r="3" fill="#3a3f4a"/>`}
<path d="M95 500 H705 L735 540 Q737 556 720 556 H80 Q63 556 65 540 Z" fill="url(#lb)"/><rect x="335" y="500" width="130" height="14" rx="7" fill="#000" opacity=".16"/>`;
}
function tablet(c, { kids } = {}) {
  const [a, b] = c;
  return `<defs><linearGradient id="tw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${kids ? "#ffb347" : "#3a7bff"}"/><stop offset="1" stop-color="${kids ? "#ff5e8a" : "#13c6c0"}"/></linearGradient><linearGradient id="tb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect x="130" y="190" width="540" height="400" rx="${kids ? 58 : 34}" fill="url(#tb)"/>
<rect x="${kids ? 175 : 150}" y="${kids ? 235 : 210}" width="${kids ? 450 : 500}" height="${kids ? 310 : 360}" rx="${kids ? 20 : 14}" fill="#0f1116"/><rect x="${kids ? 187 : 162}" y="${kids ? 247 : 222}" width="${kids ? 426 : 476}" height="${kids ? 286 : 336}" rx="10" fill="url(#tw)"/>
${kids ? `<circle cx="330" cy="390" r="46" fill="#fff" opacity=".85"/><circle cx="470" cy="390" r="46" fill="#fff" opacity=".55"/><rect x="340" y="450" width="120" height="14" rx="7" fill="#fff" opacity=".8"/>` : `<circle cx="140" cy="390" r="3" fill="#000" opacity=".5"/>`}`;
}
function brick(c) {
  return `<defs><linearGradient id="cb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe3ea"/></linearGradient></defs>
<path d="M310 560 C300 640 520 700 520 640" fill="none" stroke="#dfe3ea" stroke-width="16" stroke-linecap="round"/>
<rect x="300" y="260" width="200" height="260" rx="30" fill="url(#cb)" stroke="#000" stroke-opacity=".08" stroke-width="3"/>
<rect x="360" y="200" width="16" height="62" rx="4" fill="#9aa1ad"/><rect x="424" y="200" width="16" height="62" rx="4" fill="#9aa1ad"/>
<rect x="360" y="440" width="80" height="30" rx="15" fill="#2a2d34"/><rect x="372" y="448" width="56" height="14" rx="7" fill="#0f1116"/>
<rect x="378" y="320" width="44" height="44" rx="12" fill="${c[0]}"/>`;
}
function laptopCharger(c) {
  return `<path d="M250 420 C170 560 330 640 430 600 S600 520 560 430" fill="none" stroke="#2a2d34" stroke-width="14" stroke-linecap="round"/>
<rect x="230" y="330" width="170" height="110" rx="18" fill="#2a2d34"/><rect x="250" y="350" width="60" height="8" rx="4" fill="${c[0]}"/>
<rect x="540" y="400" width="64" height="40" rx="8" fill="#b9bec7"/><rect x="552" y="412" width="40" height="16" rx="6" fill="#1a1c20"/>
<rect x="150" y="360" width="82" height="50" rx="10" fill="#2a2d34"/><rect x="132" y="372" width="22" height="26" rx="4" fill="#9aa1ad"/>`;
}
function cable(c) {
  return `<path d="M170 560 C170 300 380 700 380 420 S640 520 630 250" fill="none" stroke="${c[0]}" stroke-width="16" stroke-linecap="round"/>
<rect x="132" y="560" width="76" height="70" rx="10" fill="#d4d8df"/><rect x="152" y="620" width="36" height="24" rx="5" fill="#8f96a3"/>
<rect x="592" y="170" width="76" height="86" rx="10" fill="#d4d8df"/><rect x="606" y="150" width="48" height="26" rx="8" fill="#8f96a3"/>`;
}
function multiport(c) {
  return `<defs><linearGradient id="mb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9dde5"/></linearGradient></defs>
<rect x="190" y="300" width="420" height="190" rx="34" fill="url(#mb)" stroke="#000" stroke-opacity=".08" stroke-width="3"/>
${[0, 1, 2, 3].map((i) => `<rect x="${236 + i * 92}" y="${i < 2 ? 350 : 350}" width="60" height="${i % 2 ? 24 : 24}" rx="12" fill="#23262d"/><rect x="${248 + i * 92}" y="356" width="36" height="12" rx="6" fill="#0f1116"/><rect x="${236 + i * 92}" y="420" width="60" height="10" rx="5" fill="${i < 2 ? c[0] : "#9aa1ad"}"/>`).join("")}
<rect x="372" y="250" width="14" height="52" rx="4" fill="#9aa1ad"/><rect x="414" y="250" width="14" height="52" rx="4" fill="#9aa1ad"/>`;
}

export function deviceInner(kind, colorName) {
  const c = colorPair(colorName);
  const parts = {
    iphone: () => phone(c, { brand: "Apple" }), galaxy: () => phone(c, { brand: "Samsung" }), fold: () => phone(c, { brand: "Samsung", fold: true }),
    laptop: () => laptop(c), macbook: () => laptop(c, { mac: true }), tablet: () => tablet(c), kids: () => tablet(c, { kids: true }),
    charger: () => brick(c), laptopCharger: () => laptopCharger(c), cable: () => cable(c), multiport: () => multiport(c),
  };
  return (parts[kind] || parts.iphone)();
}
export const deviceSvg = (kind, colorName, id = "x") => wrap(deviceInner(kind, colorName), id);
