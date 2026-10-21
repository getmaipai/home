// Temporary: replaced by the kit player (CMEDIA-PLAYER-01); Home draws it here only for the editor's preview.
import { useEffect, useRef, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";

const activePreviewTokens = new Set<symbol>();

export const STACKED_ALPHA_FRAGMENT_SHADER = `precision mediump float;
uniform sampler2D frame;
varying vec2 uv;
void main() {
  vec4 color = texture2D(frame, vec2(uv.x, (1.0 - uv.y) * 0.5));
  float alpha = texture2D(frame, vec2(uv.x, 0.5 + (1.0 - uv.y) * 0.5)).r;
  gl_FragColor = vec4(color.rgb / max(alpha, 0.001), alpha);
}`;
export function unpremultiply(r: number, g: number, b: number, a: number): [number, number, number, number] {
  const alpha = Math.max(a, 0.001);
  return [r / alpha, g / alpha, b / alpha, a];
}

type Props = { urls: { h264: string; av1: string; still: string }; label: string; priority?: boolean };
export function StackedAlphaPreview({ urls, label, priority = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState(false);
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(!document.hidden);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [source, setSource] = useState(urls.h264);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const av1 = video.canPlayType('video/mp4; codecs="av01.0.05M.08"');
    setSource(av1 === "probably" ? urls.av1 : urls.h264);
  }, [urls.av1, urls.h264]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update(); query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  useEffect(() => {
    const update = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { threshold: 0.15 });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || !visible || !documentVisible || reduced || (!priority && !playing)) return;
    if (activePreviewTokens.size >= 2) { if (!priority) setPlaying(false); return; }
    const token = Symbol("preview"); activePreviewTokens.add(token);
    let gl: WebGLRenderingContext | null = null;
    try { gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false }); } catch { gl = null; }
    if (!gl) { activePreviewTokens.delete(token); setFailed(true); return; }
    const compile = (type: number, sourceText: string) => { const shader = gl.createShader(type); if (!shader) return null; gl.shaderSource(shader, sourceText); gl.compileShader(shader); return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null; };
    const vertex = compile(gl.VERTEX_SHADER, "attribute vec2 position; varying vec2 uv; void main(){ uv=(position+1.0)*0.5; gl_Position=vec4(position,0.0,1.0); }");
    const fragment = compile(gl.FRAGMENT_SHADER, STACKED_ALPHA_FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) { activePreviewTokens.delete(token); setFailed(true); return; }
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { activePreviewTokens.delete(token); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); setFailed(true); return; }
    gl.useProgram(program); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.disable(gl.BLEND);
    let frame = 0, raf = 0, alive = true;
    const draw = () => { if (!alive || video.readyState < 2) return; canvas.width = video.videoWidth; canvas.height = video.videoHeight / 2; gl.viewport(0, 0, canvas.width, canvas.height); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
    const next = () => { if (!alive) return; draw(); if ("requestVideoFrameCallback" in video) frame = video.requestVideoFrameCallback(next); else raf = requestAnimationFrame(next); };
    const onVisibility = () => { if (document.hidden) { video.pause(); } else if (visible && !reduced && (priority || playing)) void video.play().catch(() => setFailed(true)); };
    document.addEventListener("visibilitychange", onVisibility);
    video.addEventListener("loadeddata", next); video.addEventListener("error", () => setFailed(true));
    void video.play().then(() => setFailed(false)).catch(() => setFailed(true));
    return () => { activePreviewTokens.delete(token); alive = false; cancelAnimationFrame(raf); if ("cancelVideoFrameCallback" in video && frame) video.cancelVideoFrameCallback(frame); document.removeEventListener("visibilitychange", onVisibility); video.removeEventListener("loadeddata", next); video.pause(); gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); };
  }, [visible, documentVisible, priority, playing, reduced, source]);
  const canPlay = visible && (priority || playing) && !reduced && !failed;
  return <div className="flex flex-col gap-2"><div ref={hostRef} className={`companion-alpha-frame ${dark ? "companion-alpha-frame-dark" : ""}`}>
    <video ref={videoRef} aria-hidden="true" muted loop playsInline autoPlay preload="metadata" src={source} className="hidden" />
    {canPlay ? <canvas ref={canvasRef} aria-label={`${label} transparent clip preview`} className="absolute inset-0 h-full w-full object-contain" /> : <img src={urls.still} alt={`${label} clip still`} className="absolute inset-0 h-full w-full object-contain" onError={() => setFailed(true)} />}
    {failed ? <p className="absolute inset-x-2 bottom-2 rounded bg-background/80 p-1 text-center text-xs text-muted-foreground">Preview not available in this browser.</p> : null}
  </div><div className="flex flex-wrap gap-2">{reduced || (!priority && !playing) ? <Button type="button" variant="outline" onClick={() => { setReduced(false); setPlaying(true); }}>Play</Button> : null}<Button type="button" variant="outline" onClick={() => setDark((value) => !value)}>{dark ? "Light" : "Dark"}</Button></div></div>;
}
