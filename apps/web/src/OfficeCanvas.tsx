import { useEffect, useRef } from "react";
import { OfficeState, renderOffice, worldFromEvent } from "@swarm/office";
import type { RunSnapshot } from "@swarm/schema";

interface Props {
  snapshot: RunSnapshot;
  layoutId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function OfficeCanvas({ snapshot, layoutId, selectedId, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const officeRef = useRef(new OfficeState(layoutId));
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    officeRef.current.setLayout(layoutId);
  }, [layoutId]);

  useEffect(() => {
    officeRef.current.sync(snapshot);
    officeRef.current.selectedId = selectedId;
  }, [snapshot, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const parent = canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      const w = parent?.clientWidth ?? 800;
      const h = parent?.clientHeight ?? 480;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      officeRef.current.sync(snapshotRef.current);
      officeRef.current.update(dt);
      renderOffice(ctx, officeRef.current, now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="office-wrap">
      <canvas
        ref={canvasRef}
        onClick={(event) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const world = worldFromEvent(canvas, officeRef.current.layout, event);
          onSelect(officeRef.current.pick(world.x, world.y));
        }}
      />
    </div>
  );
}
