import { useState } from "react";
import { COLLATERAL, useMarketLogos } from "@/hooks/useMarketLogos";

// USDG logo from the logo API, with "$" as the fallback.
export default function CollateralIcon({ size = 16 }) {
  const logos = useMarketLogos();
  const [failedSrc, setFailedSrc] = useState(null);
  const src = logos[COLLATERAL.symbol];
  if (!src || src === failedSrc) {
    return <span aria-hidden="true">{COLLATERAL.glyph}</span>;
  }
  return (
    <img
      className="jt-collateral-logo"
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailedSrc(src)}
    />
  );
}
