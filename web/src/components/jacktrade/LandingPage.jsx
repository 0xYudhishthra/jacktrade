import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import Trade from '@/routes/trade';
import GlassButton from '@/components/dream/GlassButton';
import RippleSky from '@/components/dream/RippleSky';
import DreamAtmosphere from '@/components/dream/DreamAtmosphere';
import DreamTunnel from '@/components/dream/DreamTunnel';
import { JacktradeSparkle } from '@/components/jacktrade/JacktradeLogo';
import { useLandingGravity } from '@/components/jacktrade/useLandingGravity';
import { ThemeToggle } from '@/components/dream/ThemeProvider';

function RippleText({ children }) {
  return <><span aria-hidden="true">{children.split('').map((letter, index) => <span key={index} data-ripple-letter>{letter === ' ' ? '\u00a0' : letter}</span>)}</span><span className="sr-only">{children}</span></>;
}

export default function LandingPage() {
  const preview = useRef(null);
  const landing = useRef(null);
  const [scale, setScale] = useState(.6);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      const mode = document.documentElement.dataset.motion;
      setReduced(!matchMedia('(hover: hover) and (pointer: fine)').matches || mode === 'reduced' || (mode !== 'full' && media.matches));
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes:true, attributeFilter:['data-motion'] });
    media.addEventListener('change', sync);
    sync();
    return () => { observer.disconnect(); media.removeEventListener('change', sync); };
  }, []);
  useLandingGravity(landing, reduced);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1440));
    observer.observe(preview.current);
    return () => observer.disconnect();
  }, []);
  return <main className="dream-landing dream-landing-white" ref={landing}>
    <div className="dream-theme-control"><ThemeToggle /></div>
    <DreamTunnel />
    <RippleSky />
    <DreamAtmosphere />
    <section className="dream-hero" aria-label="JackTrade trading">
      <div className="dream-hero-copy">
        <h1><RippleText>JACKTRADE</RippleText><JacktradeSparkle className="dream-brand-sparkle" /></h1>
        <p className="dream-tagline"><RippleText>play with JackTrade.</RippleText></p>
        <p className="dream-subline"><RippleText>Trade against the house.</RippleText></p>
        <p className="dream-multiplier"><span><RippleText>Up to</RippleText></span> <em><RippleText>1000x</RippleText></em> <span><RippleText>leverage</RippleText></span></p>
        <div className="dream-ripple-action" data-ripple-surface>
          <GlassButton to="/trade" primary className="dream-enter"><RippleText>Enter JackTrade</RippleText> <span className="dream-arrow" aria-hidden="true"><ArrowRight size={18} /></span></GlassButton>
        </div>
      </div>
      <div className="dream-preview-area" data-gravity="preview" data-ripple-surface>
        <div className="dream-preview-float">
          <div className="dream-preview-frame">
            <div className="dream-preview-screen" ref={preview}>
              <div className="dream-preview-content" inert aria-hidden="true" style={{transform:`scale(${scale})`}}><Trade preview /></div>
            </div>
            <Link to="/trade" className="dream-preview-link" aria-label="Open trading terminal" />
          </div>
        </div>
      </div>
    </section>
  </main>;
}
