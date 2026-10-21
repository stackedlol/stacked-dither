"use client";

import { useEffect, useRef } from "react";
import { DitherEngine, type DitherOptions } from "./engine";

/** Size it with CSS (className); the backing store follows. */
export function Dither({ className, ...options }: DitherOptions & { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DitherEngine | null>(null);
  const key = JSON.stringify(options);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new DitherEngine(canvas, options);
    engineRef.current = engine;
    return () => engine.destroy();
    // Created once; option changes go through set() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.set(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ display: "block" }} />;
}
