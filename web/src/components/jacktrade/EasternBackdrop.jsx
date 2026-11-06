import wallpaper from "@/assets/terminal-house-shanghai-v1.png";

export default function EasternBackdrop({ className = "jt-wallpaper" }) {
  return (
    <div className={className} aria-hidden="true">
      <img src={wallpaper} alt="" fetchPriority="high" />
      <img className="jt-eastern-city" src={wallpaper} alt="" />
      <div className="jt-eastern-caption">
        <span lang="zh-Hans">交易终端</span>
        <span>JACKTRADE</span>
      </div>
    </div>
  );
}
