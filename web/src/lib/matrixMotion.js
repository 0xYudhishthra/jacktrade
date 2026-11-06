// DREAM.EXE opens animated; ?motion=system or reduced remains an explicit option.
const KEY = "jacktrade.dream.motion";
const valid = (value) => value === "full" || value === "system" || value === "reduced";
let motion = "full";
try {
    const requested = new URLSearchParams(window.location.search).get("motion");
    const saved = sessionStorage.getItem(KEY);
    if (valid(requested)) {
        motion = requested;
        sessionStorage.setItem(KEY, motion);
    }
    else if (valid(saved))
        motion = saved;
}
catch {
    /* Storage is optional; the animated default still works without it. */
}
document.documentElement.dataset.motion = motion;
export const reduceMotion = (media) => motion === "reduced" || (motion === "system" && media.matches);
