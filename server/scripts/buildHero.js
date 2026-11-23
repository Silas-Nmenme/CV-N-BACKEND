// Generates client/assets/img/hero-devices.svg (run once: node server/scripts/buildHero.js)
import fs from "node:fs";
import { deviceInner } from "./deviceArt.js";
const g = (kind, colour, t) => `<g transform="${t}">${deviceInner(kind, colour)}</g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620" role="img" aria-label="Phone, laptop, tablet and charger">
${g("laptop", "Silver", "translate(-60 40) scale(.95)")}
${g("tablet", "Space Gray", "translate(380 150) scale(.62)")}
${g("iphone", "Starlight", "translate(330 -10) scale(.78) rotate(6 400 400)")}
${g("charger", "Black", "translate(560 300) scale(.48)")}
</svg>`;
fs.mkdirSync("client/assets/img", { recursive: true });
fs.writeFileSync("client/assets/img/hero-devices.svg", svg);
console.log("hero written");
