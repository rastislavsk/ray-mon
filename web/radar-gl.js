// Vrstva karty Radar v mape: WebGL nad MapLibre (custom layer). Do textúr idú sily, nie farby. Farbu
// a plynulý posun medzi snímkami dopočíta grafická karta, preto ostanú okraje čisté aj pri zväčšení.

import { RADAR } from '../shared/config.js';
import { dazdLut } from '../shared/radar.js';

const VS = `#version 300 es
uniform mat4 mapa;
uniform vec4 rohy;
out vec2 uv;
void main() {
    int i = gl_VertexID;
    uv = vec2(i == 1 || i == 2 || i == 4 ? 1. : 0., i == 2 || i >= 4 ? 1. : 0.);
    gl_Position = mapa * vec4(mix(rohy.xy, rohy.zw, uv), 0., 1.);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D A, B, CA, CB, F, L;
uniform float f, cf, oblaky, pohyb, doba, slabne, mierka;
uniform vec2 sz;
uniform vec3 g;
void main() {
    vec2 fl = vec2(0.);
    if (pohyb > 0.) fl = (texture(F, (uv * sz / g.z + .5) / g.xy).rg * 255. - 127.) / mierka / sz;
    // doba > 0: predpoveď, posledná snímka posunutá proti pohybu a čoraz rozmazanejšia.
    float v = doba > 0.
        ? textureLod(A, uv - fl * doba, doba / 16.).r * slabne
        : mix(texture(A, uv - fl * f).r, texture(B, uv + fl * (1. - f)).r, f);
    vec4 r = texture(L, vec2((v * 255. + .5) / 256., .5));
    float c = mix(texture(CA, uv).r, texture(CB, uv).r, cf);
    float ca = smoothstep(.2, 1., c) * .56 * oblaky;
    vec3 cc = mix(vec3(.62, .68, .78), vec3(.9, .93, .98), smoothstep(.45, 1., c));
    vec4 hore = vec4(r.rgb * r.a, r.a);
    o = hore + vec4(cc * ca, ca) * (1. - hore.a);
}`;

const JEDNOTKY = /** @type {const} */ (['A', 'B', 'CA', 'CB', 'F', 'L']);
const CISLA = /** @type {const} */ (['mapa', 'rohy', 'f', 'cf', 'oblaky', 'pohyb', 'doba', 'slabne', 'mierka', 'sz', 'g']);

/**
 * Čo kresliť v tejto chvíli: dve snímky a podiel medzi nimi, dve hodiny oblakov a ich podiel.
 * `doba` je pri predpovedi počet krokov od poslednej snímky.
 * @typedef {{ a: WebGLTexture | null, b: WebGLTexture | null, f: number, ca: WebGLTexture | null, cb: WebGLTexture | null,
 *   cf: number, pohyb: boolean, doba: number, slabne: number, oblaky: boolean }} Obraz
 */

/**
 * Textúra sily alebo pohybu.
 * @param {WebGL2RenderingContext} gl @param {WebGLTexture | null} t
 * @param {{ w: number, h: number, format: number, typ: number, data: Uint8Array }} o
 */
function nahraj(gl, t, { w, h, format, typ, data }) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, typ, gl.UNSIGNED_BYTE, data);
}

/** @param {WebGL2RenderingContext} gl @param {boolean} [mip] @returns {WebGLTexture | null} */
function novaTextura(gl, mip = false) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
}

/** @param {WebGL2RenderingContext} gl @param {number} typ @param {string} src */
function shader(gl, typ, src) {
    const s = /** @type {WebGLShader} */ (gl.createShader(typ));
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
}

export class RadarVrstva {
    id = 'radar';
    type = /** @type {const} */ ('custom');
    renderingMode = /** @type {const} */ ('2d');
    /** @type {WebGL2RenderingContext | null} */ gl = null;
    /** @type {WebGLProgram | null} */ program = null;
    /** @type {WebGLVertexArrayObject | null} */ vao = null;
    /** @type {Record<string, WebGLUniformLocation | null>} */ u = {};
    /** @type {WebGLTexture | null} */ tLut = null;
    /** @type {WebGLTexture | null} */ tPohyb = null;
    /** @type {WebGLTexture | null} */ tNic = null;
    g = [1, 1, 1];

    /**
     * @param {import('../shared/radar-data.js').Oblast} oblast
     * @param {() => Obraz} obraz
     */
    constructor(oblast, obraz) {
        this.oblast = oblast;
        this.obraz = obraz;
    }

    /** @param {unknown} _map @param {WebGL2RenderingContext} gl */
    onAdd(_map, gl) {
        this.gl = gl;
        const pr = /** @type {WebGLProgram} */ (gl.createProgram());
        gl.attachShader(pr, shader(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(pr, shader(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(pr);
        this.program = pr;
        for (const n of [...JEDNOTKY, ...CISLA]) this.u[n] = gl.getUniformLocation(pr, n);
        this.vao = gl.createVertexArray();
        this.tLut = novaTextura(gl);
        nahraj(gl, this.tLut, { w: 256, h: 1, format: gl.RGBA8, typ: gl.RGBA, data: dazdLut() });
        this.tNic = novaTextura(gl);
        nahraj(gl, this.tNic, { w: 1, h: 1, format: gl.R8, typ: gl.RED, data: new Uint8Array(1) });
        this.tPohyb = novaTextura(gl);
        nahraj(gl, this.tPohyb, { w: 1, h: 1, format: gl.RG8, typ: gl.RG, data: new Uint8Array([127, 127]) });
    }

    /** @param {WebGL2RenderingContext} gl @param {{ defaultProjectionData: { mainMatrix: ArrayLike<number> } }} args */
    render(gl, args) {
        const o = this.obraz();
        const u = this.u;
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.uniformMatrix4fv(u.mapa, false, /** @type {Float32List} */ (args.defaultProjectionData.mainMatrix));
        const { x0, y0, x1, y1, w, h } = this.oblast;
        gl.uniform4f(u.rohy, x0, y0, x1, y1);
        gl.uniform2f(u.sz, w, h);
        gl.uniform3f(u.g, this.g[0], this.g[1], this.g[2]);
        gl.uniform1f(u.mierka, RADAR.pohyb.mierka);
        [o.a, o.b ?? o.a, o.ca, o.cb, this.tPohyb, this.tLut].forEach((t, i) => {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, t ?? this.tNic);
            gl.uniform1i(u[JEDNOTKY[i]], i);
        });
        gl.uniform1f(u.f, o.f);
        gl.uniform1f(u.cf, o.cf);
        gl.uniform1f(u.oblaky, o.oblaky ? 1 : 0);
        gl.uniform1f(u.pohyb, o.pohyb ? 1 : 0);
        gl.uniform1f(u.doba, o.doba);
        gl.uniform1f(u.slabne, o.slabne);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
    }

    /** Nová snímka ako textúra. @param {number} w @param {number} h @param {Uint8Array} data @param {boolean} [mip] */
    textura(w, h, data, mip = false) {
        const gl = this.gl;
        if (!gl) return null;
        const t = novaTextura(gl, mip);
        nahraj(gl, t, { w, h, format: gl.R8, typ: gl.RED, data });
        if (mip) gl.generateMipmap(gl.TEXTURE_2D);
        return t;
    }

    /** @param {WebGLTexture | null} t */
    zmaz(t) {
        if (t) this.gl?.deleteTexture(t);
    }

    /** @param {{ gx: number, gy: number, g: number, bajty: Uint8Array }} p */
    pohyb({ gx, gy, g, bajty }) {
        const gl = this.gl;
        if (!gl) return;
        this.g = [gx, gy, g];
        nahraj(gl, this.tPohyb, { w: gx, h: gy, format: gl.RG8, typ: gl.RG, data: bajty });
    }
}
