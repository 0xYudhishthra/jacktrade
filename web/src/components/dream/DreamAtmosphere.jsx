const assets = {
  portrait: { file: 'portrait-mirror-v1.png', width: 1024, height: 1536 },
  landscape: { file: 'landscape-mirror-v1.png', width: 1402, height: 1122 },
  orb: { file: 'iridescent-orb-v1.png', width: 1254, height: 1254 },
};
const objects = [
  ['portrait', 'near-left'],
  ['portrait', 'high-right'],
  ['orb', 'pearl'],
  ['orb', 'small-left'],
  ['orb', 'small-right'],
];
const placards = [
  ['sp500', 'S&P 500'],
  ['leverage', '1000X'],
  ['tesla', 'TSLA'],
];

/** Independent glass windows carry the landscape inside their alpha cutouts. */
export default function DreamAtmosphere() {
  return <div className="dream-atmosphere" aria-hidden="true">
    {objects.map(([kind, position]) => <div key={position} className={`dream-object dream-object-${position}`} data-ripple-surface>
      <div className="dream-object-float">
        <img className="dream-object-image" src={`/images/dream-objects/${assets[kind].file}`} width={assets[kind].width} height={assets[kind].height} alt="" draggable={false} decoding="async" />
      </div>
    </div>)}
    {placards.map(([position, label]) => <div key={position} className={`dream-object dream-market-placard dream-market-${position}`} data-ripple-surface>
      <div className="dream-object-float">
        <div className="dream-market-depth"><div className="dream-market-glass"><span className="dream-market-label">{Array.from(label, (letter, index) => <span key={index} data-ripple-letter>{letter === ' ' ? '\u00a0' : letter}</span>)}</span></div></div>
      </div>
    </div>)}
  </div>;
}
