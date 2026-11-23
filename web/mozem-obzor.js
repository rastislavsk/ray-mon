// Obzor kresby počasia na karte Dnes (docs/navrhy/dnes-vyska-obrazovky.html, A + 2): obloha karty rastie s výškou
// telefónu, takže čiara posuvníka dňa nestojí vždy na tom istom mieste. Tu sa jej výška zmeria a zapíše do
// premennej --mz-obzor na kresbe počasia (#wx); css/dnes.css z nej skladá obzor a výšku slnka. Je to len poloha
// kresby, nie stav appky - preto nejde cez setState a render, ako ani posun pásu kariet (mozem-karty.js).

/**
 * Sleduje veľkosť karty (zobrazenie, otočenie telefónu, väčšie písmo, iná výška pásu) a pri každej zmene zapíše
 * výšku stredu čiary posuvníka od vrchu stránky. Kresba počasia stojí voči obrazovke, stránka je pri meraní
 * spravidla na vrchu - na nízkom telefóne, kde sa posúva, ostane obzor tam, kde bol pri vrchu, ako predtým.
 * @param {HTMLElement} karta @param {HTMLElement} os posuvník dňa @param {HTMLElement} wx kresba počasia
 */
export function sledujObzor(karta, os, wx) {
    const ciara = os.querySelector('.mz-os-ciara') ?? os;
    const zapis = () => {
        const r = ciara.getBoundingClientRect();
        // Skrytá karta či posuvník (bez predpovede) nemajú výšku - obzor ostane posledný platný.
        if (!r.height) return;
        wx.style.setProperty('--mz-obzor', `${Math.round(r.top + r.height / 2 + window.scrollY)}px`);
    };
    new ResizeObserver(zapis).observe(karta);
    window.addEventListener('resize', zapis);
}
