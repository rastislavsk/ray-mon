// „Zdieľať do story“: plagát ako obrázok 1080 × 1920 (formát story), nakreslený v prehliadači.
// Kreslí tú istú kartu, akú vidno v dialógu (.pc): obloha ako pozadie, písmo Archivo, nadpis,
// veľké kWh, stĺpce dní a čísla. Berie model plagátu (shared/statistika.js), nie stav appky,
// takže obrázok a dialóg nemôžu hovoriť dve rôzne čísla. Zdieľanie rieši web/share-file.js.

const W = 1080;
const H = 1920;
const PAD = 90;

/**
 * Farby a písmo plagátu z tokenov v obloha/style.css - karta v dialógu a obrázok tak nemôžu mať
 * dve rôzne palety. Obloha plagátu je prechod troch farieb pod uhlom `angle`.
 * @typedef {{ stops: string[], angle: number, ink: string, font: string }} Look
 * @returns {Look}
 */
function look() {
    const css = getComputedStyle(document.documentElement);
    const token = (/** @type {string} */ name) => css.getPropertyValue(name).trim();
    return {
        stops: [token('--poster-1'), token('--poster-2'), token('--poster-3')],
        angle: parseFloat(token('--poster-angle')),
        ink: token('--poster-ink'),
        font: token('--font'),
    };
}

/**
 * Prechod ako CSS `linear-gradient(<uhol>deg, …)` cez celé plátno: čiara ide stredom pod daným
 * uhlom a je dlhá tak, aby rohy dostali krajné farby.
 * @param {CanvasRenderingContext2D} ctx @param {Look} t
 */
function sky(ctx, t) {
    const a = (t.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const g = ctx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
    t.stops.forEach((c, i) => g.addColorStop(i / (t.stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}

/**
 * Rozdelí text na riadky do danej šírky.
 * @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} width
 */
function wrap(ctx, text, width) {
    /** @type {string[]} */ const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > width) {
            lines.push(line);
            line = word;
        } else line = next;
    }
    if (line) lines.push(line);
    return lines;
}

/**
 * Písmo plátna: hrúbka, veľkosť a šírka (Archivo má premenlivú šírku, nadpisy sú široké ako
 * v dialógu). @param {CanvasRenderingContext2D} ctx @param {Look} t @param {number} weight @param {number} size
 * @param {CanvasFontStretch} [stretch]
 */
function font(ctx, t, weight, size, stretch = 'normal') {
    ctx.font = `${weight} ${size}px ${t.font}`;
    ctx.fontStretch = stretch;
}

/** Stĺpce dní; chýbajúci deň je len obrys, aby bolo vidno, že číslo chýba. @param {CanvasRenderingContext2D} ctx @param {import('../../shared/statistika.js').PosterModel['cols']} cols @param {number} y @param {number} h */
function columns(ctx, cols, y, h) {
    const gap = cols.length > 10 ? 8 : 20;
    const w = (W - 2 * PAD - gap * (cols.length - 1)) / cols.length;
    cols.forEach((c, i) => {
        const x = PAD + i * (w + gap);
        if (c.h === null) {
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 4;
            ctx.strokeRect(x + 2, y + h * 0.7 + 2, w - 4, h * 0.3 - 4);
        } else {
            ctx.globalAlpha = c.best ? 0.9 : 0.55;
            const ch = (h * c.h) / 100;
            ctx.fillRect(x, y + h - ch, w, ch);
        }
    });
    ctx.globalAlpha = 1;
}

/** Výška stĺpcov dní na obrázku. */
const COLS_H = 420;

/**
 * Čísla plagátu v dvoch stĺpcoch: veľké číslo a popisok pod ním. Vracia výšku, ktorú zaberú;
 * s `draw: false` len meria.
 * @param {CanvasRenderingContext2D} ctx @param {import('../../shared/statistika.js').PosterModel['tiles']} tiles
 * @param {Look} t @param {number} y @param {boolean} draw
 */
function tiles(ctx, tiles, t, y, draw) {
    const colW = (W - 2 * PAD - 60) / 2;
    let h = 0;
    for (let i = 0; i < tiles.length; i += 2) {
        let rowH = 0;
        for (const [j, tile] of tiles.slice(i, i + 2).entries()) {
            const x = PAD + j * (colW + 60);
            font(ctx, t, 900, 84, 'semi-expanded');
            if (draw) ctx.fillText(tile.value, x, y + h + 84);
            font(ctx, t, 500, 42);
            const lines = wrap(ctx, tile.label, colW);
            if (draw) lines.forEach((l, k) => ctx.fillText(l, x, y + h + 84 + 60 + k * 50));
            rowH = Math.max(rowH, 84 + 60 + (lines.length - 1) * 50);
        }
        h += rowH + (i + 2 < tiles.length ? 80 : 0);
    }
    return h;
}

/**
 * Nakreslí plagát na plátno. Obsah (nadpis až čísla) stojí vo zvislom strede nad pätičkou, aby
 * pri kratšom plagáte neostal dole prázdny pás.
 * @param {CanvasRenderingContext2D} ctx @param {import('../../shared/statistika.js').PosterModel} m @param {Look} t
 */
function draw(ctx, m, t) {
    sky(ctx, t);
    ctx.fillStyle = t.ink;
    ctx.strokeStyle = t.ink;
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = '5px';
    font(ctx, t, 800, 44);
    const title = wrap(ctx, m.title.toUpperCase(), W - 2 * PAD);
    ctx.letterSpacing = '0px';
    // Veľké číslo čo najväčšie, ale celé v šírke plagátu.
    let size = 280;
    font(ctx, t, 900, size, 'expanded');
    while (size > 100 && ctx.measureText(m.kwh).width > W - 2 * PAD) {
        size -= 10;
        font(ctx, t, 900, size, 'expanded');
    }
    const titleH = title.length * 60;
    const height = titleH + 60 + size * 0.8 + 90 + COLS_H + 120 + tiles(ctx, m.tiles, t, 0, false);
    const foot = H - 130;
    let y = Math.max(160, (foot - 80 - height) / 2);
    ctx.letterSpacing = '5px';
    font(ctx, t, 800, 44);
    title.forEach((l, i) => ctx.fillText(l, PAD, y + 44 + i * 60));
    ctx.letterSpacing = '0px';
    y += titleH + 60 + size * 0.8;
    font(ctx, t, 900, size, 'expanded');
    ctx.fillText(m.kwh, PAD - 6, y);
    y += 90;
    columns(ctx, m.cols, y, COLS_H);
    y += COLS_H + 120;
    tiles(ctx, m.tiles, t, y - 84, true);
    ctx.letterSpacing = '4px';
    font(ctx, t, 800, 36);
    ctx.fillText(m.foot.toUpperCase(), PAD, foot);
    ctx.letterSpacing = '0px';
}

/**
 * Obrázok plagátu ako súbor PNG, alebo null, keď plátno nejde.
 * @param {import('../../shared/statistika.js').PosterModel} m
 * @returns {Promise<File | null>}
 */
export async function posterImage(m) {
    const t = look();
    // Písmo sa do stránky načíta až pri prvom použití - plátno by bez neho kreslilo náhradným.
    await Promise.all([500, 800, 900].map((w) => document.fonts.load(`${w} 100px ${t.font}`))).catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    draw(ctx, m, t);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
    return blob ? new File([/** @type {Blob} */ (blob)], `ray-mon-${m.period}.png`, { type: 'image/png' }) : null;
}
