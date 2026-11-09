/**
 * Frost Bloom / 霜华晶球 · jewellery finishing pass
 * Original 2D faceted enamel artwork. 100 × 100 local coordinate system;
 * the outline and six primary cuts remain legible at the real 36px launcher size.
 * Sixfold branches are generated, never simulated with a font glyph or emoji.
 */
const frostBloomGeometry = (() => {
const ICE = '#EDF8FA';
const LAKE = '#B9DAE2';
const LILAC = '#D3C7F0';
const MINT = '#A8D4CF';
const METAL = '#E6D8C5';

// Optical hierarchy: six large pointed inlays, intervening bevelled facets,
// fine seams and narrow white knife-edge highlights. No random triangle tiling.
const orbPetal = (degrees, i) => {
  const light = [ICE, LAKE, LILAC, ICE, LAKE, LILAC][i];
  const glass = [MINT, LILAC, LAKE, LILAC, MINT, LAKE][i];
  const shade = [LAKE, ICE, MINT, LAKE, LILAC, MINT][i];
  return `<g class="pp-frost-orb-petal" transform="rotate(${degrees} 50 50)">
    <path d="M50 50 38.8 30.6 50 12.4Z" fill="${light}" fill-opacity=".94"/>
    <path d="M50 50 50 12.4 61.2 30.6Z" fill="${glass}" fill-opacity=".86"/>
    <path d="M50 12.4 43.6 23.1 50 38.8 56.4 23.1Z" fill="#fffdfa" fill-opacity=".30"/>
    <path d="M50 12.4 50 38.8 43.6 23.1Z" fill="${shade}" fill-opacity=".34"/>
    <path d="M50 38.8 38.8 30.6 29.4 41.3 50 50Z" fill="${shade}" fill-opacity=".64"/>
    <path d="M50 38.8 61.2 30.6 70.6 41.3 50 50Z" fill="${glass}" fill-opacity=".52"/>
    <path d="M38.8 30.6 25.9 24.7 30.7 39.3 50 50Z" fill="${glass}" fill-opacity=".42"/>
    <path d="M61.2 30.6 74.1 24.7 69.3 39.3 50 50Z" fill="${light}" fill-opacity=".43"/>
    <path d="M50 12.4 38.8 30.6 25.9 24.7 36.3 14.8Z" fill="${shade}" fill-opacity=".38"/>
    <path d="M50 12.4 61.2 30.6 74.1 24.7 63.7 14.8Z" fill="#fff" fill-opacity=".29"/>
    <path d="M50 12.4 38.8 30.6 50 50 61.2 30.6Z" fill="none" stroke="#fffefe" stroke-opacity=".78" stroke-width=".72" stroke-linejoin="round"/>
    <path d="M25.9 24.7 38.8 30.6 29.4 41.3 50 50 70.6 41.3 61.2 30.6 74.1 24.7" fill="none" stroke="#7898aa" stroke-opacity=".78" stroke-width=".94" stroke-linejoin="round"/>
    <path d="M50 12.4 43.6 23.1 50 38.8 56.4 23.1 50 12.4" fill="none" stroke="#fffefb" stroke-opacity=".84" stroke-width=".66"/>
    <path d="M36.3 14.8 25.9 24.7" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".64"/>
  </g>`;
};

// Three tiers: central spine, opposed crystalline leaf-pairs and tiny cut tips.
// Branches stay deliberately slim; the six spaces between them are left open.
const snowBranch = (degrees, i) => {
  const front = i % 2 ? LILAC : LAKE;
  const back = i % 2 ? MINT : LILAC;
  return `<g class="pp-frost-branch" transform="rotate(${degrees} 50 50)">
    <path d="M50 44.6 47.6 34.4 48.1 20.8 50 8.4 51.9 20.8 52.4 34.4Z" fill="${front}" fill-opacity=".85" stroke="#819aaa" stroke-opacity=".82" stroke-width=".90" stroke-linejoin="round"/>
    <path d="M50 44.6 47.6 34.4 48.1 20.8 50 8.4Z" fill="${ICE}" fill-opacity=".9"/>
    <path d="M50 8.4 51.9 20.8 52.4 34.4 50 44.6Z" fill="${back}" fill-opacity=".61"/>
    <path d="M50 8.4 46.3 18.4 50 25.8 53.7 18.4Z" fill="${LILAC}" fill-opacity=".70" stroke="#b6b3c8" stroke-width=".46"/>
    <path d="M50 8.4 46.3 18.4 50 25.8Z" fill="${ICE}" fill-opacity=".78"/>
    <path d="M50 4.6 53.9 10.4 50 16.3 46.1 10.4Z" fill="${METAL}" fill-opacity=".68" stroke="#9daab9" stroke-width=".70"/>
    <path d="M50 5.9 52.6 10.4 50 14.8 47.4 10.4Z" fill="${front}" fill-opacity=".84" stroke="#fff" stroke-opacity=".85" stroke-width=".55"/>
    <path d="M50 5.9 50 14.8 47.4 10.4Z" fill="${ICE}" fill-opacity=".87"/>

    <path d="M48.3 33.3 Q41 25.8 33 23 M51.7 33.3 Q59 25.8 67 23" fill="none" stroke="#b0a8bb" stroke-width=".86" stroke-linecap="round"/>
    <path d="M48.3 32.5 39 24.8 32.0 20.6 36.5 29.9Z" fill="${front}" fill-opacity=".73" stroke="#a8b3c3" stroke-width=".63" stroke-linejoin="round"/>
    <path d="M51.7 32.5 61 24.8 68 20.6 63.5 29.9Z" fill="${back}" fill-opacity=".70" stroke="#a8b3c3" stroke-width=".63" stroke-linejoin="round"/>
    <path d="M48.3 32.5 39 24.8 32 20.6 36.5 29.9Z" fill="${ICE}" fill-opacity=".34"/>
    <path d="M51.7 32.5 61 24.8 68 20.6 63.5 29.9Z" fill="#fff" fill-opacity=".24"/>
    <path d="M32 20.6 39 24.8 36.5 29.9 M68 20.6 61 24.8 63.5 29.9" fill="none" stroke="#fff" stroke-opacity=".77" stroke-width=".62"/>

    <path d="M48.7 26.9 Q44.8 20 41.1 17.1 M51.3 26.9 Q55.2 20 58.9 17.1" fill="none" stroke="#b0a7c1" stroke-opacity=".77" stroke-width=".72" stroke-linecap="round"/>
    <path d="M42 18.6 39.9 13.8 44.6 16.2 45.8 22.9Z" fill="${back}" fill-opacity=".77" stroke="#adb4c5" stroke-width=".53"/>
    <path d="M58 18.6 60.1 13.8 55.4 16.2 54.2 22.9Z" fill="${front}" fill-opacity=".72" stroke="#adb4c5" stroke-width=".53"/>
    <path d="M50 16.2 50 44" stroke="#fffefd" stroke-opacity=".87" stroke-width=".66"/>
  </g>`;
};

const setGem = degrees => `<g class="pp-frost-setting" transform="rotate(${degrees} 50 50)">
    <path d="M50 0.6 55.3 7.7 50 15.0 44.7 7.7Z" fill="${METAL}" stroke="#a7a1aa" stroke-width=".85" stroke-linejoin="round"/>
    <path d="M50 2.4 53.6 7.8 50 13.2 46.4 7.8Z" fill="${ICE}" stroke="#fefdfc" stroke-width=".60"/>
    <path d="M50 2.4 50 13.2 46.4 7.8Z" fill="${LAKE}" fill-opacity=".78"/>
    <path d="M50 2.4 53.6 7.8 50 13.2Z" fill="${LILAC}" fill-opacity=".77"/>
    <path d="M44.2 7.8 41.9 10.8 44.6 10.2 M55.8 7.8 58.1 10.8 55.4 10.2" fill="none" stroke="${METAL}" stroke-width="1" stroke-linecap="round"/>
  </g>`;

function orbSvg() {
  return `<g class="pp-frost-orb">
    <circle cx="50" cy="50" r="47.0" fill="#8f97a4" fill-opacity=".16"/>
    <circle cx="50" cy="50" r="46.1" fill="${METAL}" fill-opacity=".9" stroke="#a09ca3" stroke-width="1.0"/>
    <circle cx="50" cy="50" r="44.3" fill="#fdfbf8" stroke="#fffefa" stroke-width=".78"/>
    <g clip-path="url(#pp-frost-clip)">
      <circle cx="50" cy="50" r="43.2" fill="url(#pp-frost-ground)"/>
      ${Array.from({length:12}, (_,i)=>`<path d="M50 8.2 43.6 11.9 41.8 17.3 50 22.0 58.2 17.3 56.4 11.9Z" transform="rotate(${30*i} 50 50)" fill="${[LAKE,ICE,LILAC,MINT][i%4]}" fill-opacity="${i%2?'.20':'.31'}"/>`).join('')}
      ${Array.from({length:6}, (_,i)=>orbPetal(i*60,i)).join('')}
      <path d="M50 11.6 50 88.4 M16.8 30.8 83.2 69.2 M16.8 69.2 83.2 30.8" fill="none" stroke="#fefdfb" stroke-width=".55" stroke-opacity=".57"/>
      <path d="M12.0 30.2Q20.6 15 36.9 10.5 M70.3 87Q82.1 81 87.4 65.3" fill="none" stroke="#fff" stroke-linecap="round" stroke-opacity=".77" stroke-width="1.1"/>
      <path d="M50 39.2 58.4 44.5 58.4 55.5 50 60.8 41.6 55.5 41.6 44.5Z" fill="${METAL}" fill-opacity=".32" stroke="#fff" stroke-opacity=".7" stroke-width=".56"/>
      <path d="M50 41.5 56.3 45.5 56.3 54.5 50 58.5 43.7 54.5 43.7 45.5Z" fill="${ICE}" fill-opacity=".77" stroke="#aebdcc" stroke-width=".75"/>
      ${Array.from({length:6},(_,i)=>`<path d="M50 50 50 41.5 56.3 45.5Z" transform="rotate(${i*60} 50 50)" fill="${[LAKE,LILAC,ICE,MINT,LAKE,LILAC][i]}" fill-opacity=".8" stroke="#fffefa" stroke-width=".41"/>`).join('')}
    </g>
    <circle cx="50" cy="50" r="43.6" fill="none" stroke="#fbf8f4" stroke-width="1.32" stroke-opacity=".98"/>
    <circle cx="50" cy="50" r="45.4" fill="none" stroke="#fffdf5" stroke-width=".67" stroke-opacity=".89"/>
    <circle cx="50" cy="50" r="46.5" fill="none" stroke="#8d99a7" stroke-width="1.0" stroke-opacity=".82"/>
    ${[0,90,180,270].map(setGem).join('')}
  </g>`;
}

function snowSvg() {
  return `<g class="pp-frost-snow">
    ${Array.from({length:6}, (_,i)=>snowBranch(i*60,i)).join('')}
    <path d="M50 38.8 60 44.4 60 55.6 50 61.2 40 55.6 40 44.4Z" fill="${METAL}" stroke="#a1a1ad" stroke-width=".8" stroke-linejoin="round"/>
    <path d="M50 40.8 58.2 45.4 58.2 54.6 50 59.2 41.8 54.6 41.8 45.4Z" fill="#f9fbfa" stroke="#fffdf8" stroke-width="1.15"/>
    ${Array.from({length:6}, (_,i)=>`<path d="M50 50 50 40.8 58.2 45.4Z" transform="rotate(${i*60} 50 50)" fill="${[ICE,LAKE,LILAC,MINT,LAKE,LILAC][i]}" fill-opacity=".86" stroke="#fefefa" stroke-width=".55"/>`).join('')}
    <path d="M50 45.9 53.5 47.9 53.5 52.1 50 54.1 46.5 52.1 46.5 47.9Z" fill="${ICE}" fill-opacity=".88" stroke="#c1c7d4" stroke-opacity=".65" stroke-width=".52"/>
    <path d="M50 45.9 53.5 47.9 50 50Z" fill="#fff" fill-opacity=".85"/>
  </g>`;
}

return {orbSvg,snowSvg};
})();

/** Inline SVG: preserves jewellery seams in the phone's Shadow DOM. */
export function frostBloomLauncherArt() {
  return `<span class="pp-haze-launcher-art pp-frost-bloom" aria-hidden="true">
    <svg class="pp-frost-art" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <defs>
        <clipPath id="pp-frost-clip"><circle cx="50" cy="50" r="43.2"/></clipPath>
        <radialGradient id="pp-frost-ground" cx=".3" cy=".22" r=".88">
          <stop stop-color="#FCFFFF"/><stop offset=".43" stop-color="#E5F4F5"/>
          <stop offset=".79" stop-color="#C9DEE4"/><stop offset="1" stop-color="#D7D2EB"/>
        </radialGradient>
      </defs>
      ${frostBloomGeometry.orbSvg()}
      ${frostBloomGeometry.snowSvg()}
    </svg>
  </span>`;
}
