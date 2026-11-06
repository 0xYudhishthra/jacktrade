import JacktradeLogo from "./JacktradeLogo";
import portrait from "@/assets/terminal-house-shanghai-v1.png";

const CANDLES = [
  [13, 64, 75, 61, 80],
  [25, 61, 68, 55, 73],
  [37, 51, 62, 45, 69],
  [49, 55, 64, 48, 68],
  [61, 42, 56, 35, 61],
  [73, 38, 45, 31, 51],
  [85, 42, 51, 37, 56],
  [97, 34, 44, 27, 47],
  [109, 25, 35, 20, 40],
  [121, 30, 40, 23, 45],
  [133, 23, 32, 17, 37],
  [145, 15, 25, 10, 30],
  [157, 21, 32, 16, 38],
  [169, 13, 23, 8, 28],
  [181, 8, 17, 4, 22],
];

function MiniChart() {
  return (
    <svg viewBox="0 0 200 96" fill="none" className="jt-bubble-chart-art">
      {[20, 44, 68, 92].map((y) => (
        <path
          key={y}
          d={`M0 ${y}H200`}
          stroke="#9bc3ed"
          strokeOpacity=".24"
          strokeDasharray="2 3"
        />
      ))}
      {[20, 60, 100, 140, 180].map((x) => (
        <path key={x} d={`M${x} 0V96`} stroke="#9bc3ed" strokeOpacity=".18" />
      ))}
      {CANDLES.map(([x, open, close, high, low], i) => {
        const color = [3, 6, 9, 12].includes(i) ? "#e68eac" : "#44b598";
        return (
          <g key={x} stroke={color} fill={color}>
            <path d={`M${x} ${high}V${low}`} strokeWidth="1.2" />
            <rect
              x={x - 2}
              y={Math.min(open, close)}
              width="4"
              height={Math.abs(close - open)}
              rx=".5"
            />
          </g>
        );
      })}
    </svg>
  );
}

export default function LandingBubbles() {
  return (
    <div className="jt-orbit" aria-hidden="true">
      <div className="jt-bubble jt-bubble-chart">
        <div className="jt-bubble-eyebrow">
          <span className="jt-bubble-dot" /> BTC-PERP <span>15m</span>
        </div>
        <MiniChart />
        <div className="jt-bubble-chart-bottom">
          <span>price chart</span>
          <span>↗</span>
        </div>
      </div>
      <div className="jt-bubble jt-bubble-logo">
        <span className="jt-bubble-tiny-star">✧</span>
        <JacktradeLogo />
        <span className="jt-bubble-logo-note">bet against the house.</span>
      </div>
      <div className="jt-bubble jt-bubble-btc">
        <span className="jt-bubble-coin jt-bubble-bitcoin">
          <svg viewBox="0 0 32 32" fill="none">
            <g
              transform="rotate(12 16 16)"
              stroke="white"
              strokeWidth="2.25"
              strokeLinecap="square"
              strokeLinejoin="round"
            >
              <path d="M11 8h7c7 0 7 8 0 8h-7m0 0h8c7 0 7 8 0 8h-8V8M9 8h4M9 24h4M14 5v3m4-3v3m-4 16v3m4-3v3" />
            </g>
          </svg>
        </span>
        <div>
          <strong>BTC</strong>
          <span>Bitcoin</span>
        </div>
        <span className="jt-bubble-tiny-star">✦</span>
      </div>
      <div className="jt-bubble jt-bubble-portrait">
        <div className="jt-bubble-photo">
          <img src={portrait} alt="" />
        </div>
        <div className="jt-bubble-photo-note">
          <span className="jt-bubble-dot" /> THE HOUSE <span>♡</span>
        </div>
      </div>
      <div className="jt-bubble jt-bubble-leverage">
        <span className="jt-bubble-leverage-label">turn it up</span>
        <strong>
          1000<span>×</span>
        </strong>
        <span className="jt-bubble-leverage-note">leverage</span>
        <span className="jt-bubble-glint">✧</span>
      </div>
      <div className="jt-bubble jt-bubble-eth">
        <span className="jt-bubble-coin jt-bubble-ethereum">
          <svg viewBox="0 0 28 44" fill="none">
            <path d="m14 1 13 22-13 8L1 23Z" fill="#8b8dc9" />
            <path d="m14 1 13 22-13-6Z" fill="#6469a8" />
            <path d="m1 23 13-6v14Z" fill="#e3e4fa" />
            <path d="m1 27 13 16 13-16-13 8Z" fill="#969bd7" />
          </svg>
        </span>
        <div>
          <strong>ETH</strong>
          <span>Ethereum</span>
        </div>
        <span className="jt-bubble-tiny-star">✧</span>
      </div>
    </div>
  );
}
