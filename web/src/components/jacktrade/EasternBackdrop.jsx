import wallpaper from "@/assets/terminal-house-shanghai-v1.png";

export default function EasternBackdrop({ className = "hm-wallpaper" }) {
  return (
    <div className={className} aria-hidden="true">
      <img src={wallpaper} alt="" fetchPriority="high" />
      <img className="hm-eastern-city" src={wallpaper} alt="" />
      <div className="hm-eastern-caption">
        <span lang="zh-Hans">交易终端</span>
        <span>JACKTRADE</span>
      </div>
    </div>
  );
}
