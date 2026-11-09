/*
 * Soft Haze Enamel — opt-in launcher art.
 * Original vector artwork, no third-party asset/license required.
 * Utility glyphs and branded app interiors keep their existing icons.
 */
const ppEnamelArtMarks = {
  phone:['M31 3C48 2 60 15 61 31S49 60 32 61C15 62 3 49 3 32S14 4 31 3Z','#8da99e','#4d756c','<path d="M18 16c-4 0-6 5-5 10 3 13 16 26 29 28 5 1 10-2 10-6l-10-10-6 5c-7-3-12-8-15-15l5-5-8-7Z" fill="#f8f2e7" stroke="#557b70" stroke-width="2" stroke-linejoin="round"/><path d="m18 20 5 5m19 18 5 5" stroke="#ddc4c8" stroke-width="2"/>'],
  messages:['M13 6H49Q61 6 61 18V40Q61 53 47 53H30L13 62 16 49Q3 45 3 32V18Q3 6 13 6Z','#adbcc8','#6d8b9f','<path d="M17 18H47Q53 18 53 24V39Q53 45 47 45H29L18 51 20 43Q12 41 12 34V24Q12 18 17 18Z" fill="#faf6ed" stroke="#788b9b" stroke-width="2"/><path d="M22 27H44M22 34H37" stroke="#8396a9" stroke-width="3" stroke-linecap="round"/>'],
  whatsapp:['M31 4C47 3 60 15 60 31C60 49 46 61 31 60Q24 60 18 57L5 61 9 48A28 28 0 0 1 4 31C4 15 16 4 31 4Z','#83b79b','#397c5f','<path d="M32 14a19 19 0 0 0-17 28l-2 10 10-3A19 19 0 1 0 32 14Z" fill="none" stroke="#faf5e9" stroke-width="4"/><path d="m23 22-3 4c1 8 11 18 20 19l5-4-6-5-4 3c-4-2-7-5-9-9l3-3-6-5Z" fill="#faf5e9"/>'],
  wechat:['M30 3C46 3 61 15 61 31C61 48 48 61 31 61C14 61 3 47 3 32C3 15 15 3 30 3Z','#8ab49b','#46846d','<path d="M31 16C18 11 8 19 8 29c0 5 3 9 8 12l-2 7 9-4 9 1" fill="#f7f5ea" stroke="#6b8e7c" stroke-width="1.5"/><path d="M39 27c10 0 17 7 17 15 0 5-3 8-6 10l1 6-8-3C32 58 22 51 22 42s7-15 17-15Z" fill="#e7f0e4" stroke="#527e6b" stroke-width="1.8"/><g fill="#52816e"><circle cx="19" cy="29" r="2"/><circle cx="30" cy="29" r="2"/><circle cx="34" cy="41" r="2"/><circle cx="46" cy="41" r="2"/></g>'],
  x:['M21 3 46 6 61 21 57 48 40 60 15 59 3 43 7 17Z','#86818d','#42404b','<path d="m16 15 31 35h-8L8 15h8ZM49 15 17 50" stroke="#f8f1e6" fill="none" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="m16 15 31 35" stroke="#dbc7b0" stroke-width="1"/>'],
  daily:['M13 5 46 3 59 15 57 53 48 61 15 59 5 49 6 15Z','#c4aa8f','#866b57','<path d="M15 11h28l9 9v34H15Z" fill="#faf5e9" stroke="#927661" stroke-width="2"/><path d="M43 11v9h9" fill="#e6d4c2" stroke="#927661" stroke-width="1.7"/><path d="M21 22h17M21 27h24M21 49h24M37 33h8m-8 5h8m-8 5h8" stroke="#a38974" fill="none" stroke-width="2" stroke-linecap="round"/><rect x="21" y="33" width="12" height="12" rx="1" fill="#dcc4c8" stroke="#b79e9d"/>'],
  assets:['M9 16 22 5 47 8 59 21 61 49 47 60 16 60 4 49 5 25Z','#9cad86','#5c7558','<path d="M11 23v-8q0-5 6-5h29v13" fill="#e8d6bb" stroke="#6b7e5f" stroke-width="2"/><rect x="9" y="22" width="46" height="32" rx="6" fill="#f6eddd" stroke="#6d805f" stroke-width="2.4"/><path d="M35 31h20v15H35a7 7 0 0 1 0-15Z" fill="#90a480" stroke="#667c5c" stroke-width="1.5"/><circle cx="42" cy="38" r="3" fill="#f5e1b9"/>'],
  weather:['M32 3c11 0 15 7 21 13 9 5 10 12 8 22-3 14-15 24-29 23C19 60 6 51 4 38 1 26 9 13 20 8c4-4 8-5 12-5Z','#b6c5ca','#7194a3','<circle cx="25" cy="25" r="9" fill="#f3d6a5" stroke="#bc9664" stroke-width="1.6"/><path d="M25 11V8m0 34v-3M11 25H8m33 0h-3m-23-9-2-2m24 24-2-2m0-20 2-2M13 38l2-2" stroke="#f9e6c4" stroke-width="2.5" stroke-linecap="round"/><path d="M19 47h28c6 0 9-4 9-9s-4-9-9-9c-3 0-5 1-7 3-4-7-15-7-19 1-6-1-11 3-11 8s4 6 9 6Z" fill="#fbf7f0" stroke="#86a3ad" stroke-width="2"/>'],
  amazon:['M14 6 47 5 59 17 61 51 49 60 13 59 4 49 6 16Z','#c6b49f','#8c7868','<path d="M13 24h38l4 28H10Z" fill="#fcf5e9" stroke="#9c8975" stroke-width="2"/><path d="M22 25v-8a10 10 0 0 1 20 0v8" fill="none" stroke="#998571" stroke-width="3" stroke-linecap="round"/><path d="M19 40c8 8 20 8 28-1m-5-1 6 1-2 6" fill="none" stroke="#bc8657" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'],
  food:['M30 3 44 9 56 20 61 35 55 51 44 60 19 60 7 50 3 32 11 13Z','#ca9b90','#91645f','<path d="M20 25c-3-6 7-8 5-13m8 13c-3-6 7-8 5-13m8 13c-2-6 5-8 3-13" stroke="#fbe3ca" fill="none" stroke-width="2.2" stroke-linecap="round"/><path d="M10 32h44c-1 14-8 20-22 22C19 52 12 46 10 32Z" fill="#faf0e3" stroke="#906d64" stroke-width="2"/><path d="M11 33h42M22 54h20m-8-24 18-16m-13 17 17-12" stroke="#b68b77" stroke-width="2.3" stroke-linecap="round"/>'],
  settings:['M26 3h12l3 7 7-2 9 9-2 7 7 3v11l-7 3 2 8-9 9-8-3-3 7H26l-3-7-8 3-9-9 3-8-7-3V27l7-3-2-7 9-9 8 2Z','#b8adb9','#7c7183','<path d="m27 14h9l2 6 5 2 6-2 5 8-5 4v6l5 4-5 8-6-2-5 2-2 6h-9l-2-6-5-2-6 2-5-8 5-4v-6l-5-4 5-8 6 2 5-2Z" fill="#f9f2e9" stroke="#84798a" stroke-width="1.8"/><circle cx="32" cy="35" r="11" fill="#afa4b7" stroke="#817386" stroke-width="2"/><circle cx="32" cy="35" r="5.5" fill="#faf1e6"/>']
};
export const enamelNames = Object.freeze(Object.keys(ppEnamelArtMarks));
export function enamelIcon(name) {
  const mark = ppEnamelArtMarks[name];
  if (!mark) return '';
  const [outline,light,dark,detail] = mark;
  const id = 'pp-haze-' + name;
  return '<svg viewBox="0 0 64 64" class="pp-haze-art" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#fff9ed"/><stop offset=".18" stop-color="' + light + '"/><stop offset=".77" stop-color="' + dark + '"/><stop offset="1" stop-color="' + light + '"/></linearGradient></defs>' +
    '<path d="' + outline + '" transform="translate(0 1.4)" fill="#6b5a53" opacity=".22"/>' +
    '<path d="' + outline + '" fill="url(#' + id + ')" stroke="#c6a67d" stroke-width="2.2" stroke-linejoin="round"/>' +
    '<path d="' + outline + '" fill="none" stroke="#fff7e9" stroke-width=".95" opacity=".59"/>' + detail + '</svg>';
}
export function enamelLauncherArt() {
  return '<span class="pp-haze-launcher-art" aria-hidden="true"><svg viewBox="0 0 36 36"><defs><linearGradient id="pp-haze-ball" x1="0" x2="1" y2="1"><stop stop-color="#e4dbe8"/><stop offset=".63" stop-color="#a99caf"/><stop offset="1" stop-color="#7d778a"/></linearGradient></defs><path d="M18 2c8 0 16 8 16 16s-8 16-16 16S2 26 2 18 10 2 18 2Z" fill="url(#pp-haze-ball)" stroke="#c9a678" stroke-width="1.3"/><path d="M18 7 20.7 15.3 29 18l-8.3 2.7L18 29l-2.7-8.3L7 18l8.3-2.7Z" fill="#faf4e7" stroke="#c5a77b" stroke-width=".55"/><circle cx="18" cy="18" r="2.3" fill="#b7afc1"/></svg></span>';
}
export function enamelParticles() {
  const points = [[0,-30,12], [20,-22,-26], [31,-5,33], [26,18,-19], [9,31,24], [-13,29,-23], [-29,12,19], [-30,-10,-17],[-16,-28,28],[29,29,18],[-30,28,-12],[9,-34,17]];
  return '<span class="pp-haze-sparks" aria-hidden="true">' + points.map(([dx,dy,rotation],i) =>
    '<svg class="pp-haze-spark ' + (i % 3 === 0 ? 'is-snow' : 'is-star') + '" viewBox="0 0 16 16" style="--dx:' + dx + 'px;--dy:' + dy + 'px;--spin:' + rotation + 'deg;--delay:' + (i % 4 * 12) + 'ms"><path d="' +
    (i % 3 === 0 ? 'M8 1v14M1 8h14M3 3l10 10M13 3 3 13' : 'M8 1l1.8 5.2L15 8l-5.2 1.8L8 15l-1.8-5.2L1 8l5.2-1.8Z') +
    '"/></svg>').join('') + '</span>';
}
