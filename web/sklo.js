// Sklo hlavičky v oboch appkách: na vrchu stránky je hlavička priehľadná a pod ňou (aj pod stavovým
// riadkom iPhonu) svieti počasie karty Teraz; po posune sa pod ňou zjaví sklo. Kedysi to robilo CSS
// cez animation-timeline: scroll(root), lenže Safari v appke z plochy nechávalo sklo zapnuté aj na
// vrchu. Tu je jedna cesta pre všetky prehliadače: posun zapíše `data-posun` na <html>, vzhľad
// a prechod skla rozhoduje style.css appky.
// Neutrálny modul: nesiaha na stav ani DOM appky. Posun nie je v stave, rovnako ako ťah dňa.

/** @param {HTMLElement} [root] */
export function initSklo(root = document.documentElement) {
    let caka = false;
    const zapis = () => {
        caka = false;
        root.toggleAttribute('data-posun', window.scrollY > 0);
    };
    window.addEventListener(
        'scroll',
        () => {
            if (caka) return;
            caka = true;
            requestAnimationFrame(zapis);
        },
        { passive: true },
    );
    zapis();
}
