import { useState } from "react";
import { useMarketLogos } from "@/hooks/useMarketLogos";

export default function MarketIcon({ market, size = 16 }) {
  const logos = useMarketLogos();
  const [failedSrc, setFailedSrc] = useState(null);
  const src = logos[market.symbol];
  if (!src || src === failedSrc) {
    return (
      <span
        className="jt-market-glyph"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.7), color: market.color }}
        aria-hidden="true"
      >
        {market.glyph ?? "●"}
      </span>
    );
  }
  return (
    <img
      className="jt-market-logo"
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailedSrc(src)}
    />
  );
}
