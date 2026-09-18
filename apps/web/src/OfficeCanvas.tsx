import { useEffect, useRef, useState } from "react";
import { OfficeState, renderOffice, TILE, worldFromEvent } from "@swarm/office";
import type { RunSnapshot } from "@swarm/schema";

interface Props {
  snapshot: RunSnapshot;
  layoutId: string;
  selectedId: string | null;
  pinned?: boolean;
  onSelect: (id: string | null) => void;
}

interface SpriteHit {
  id: string;
  name: string;
  left: number;
  top: number;
}

function camera(canvas: HTMLCanvasElement, layout: { width: number; height: number }) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  const sx = cssW / (layout.width * TILE);
  const sy = cssH / (layout.height * TILE);
  const scale = Math.max(0.5, Math.min(sx, sy, 0.9));
  const ox = (cssW - layout.width * TILE * scale) / 2;
  const oy = (cssH - layout.height * TILE * scale) / 2;
  return { scale, ox, oy };
}

export function OfficeCanvas({ snapshot, layoutId, selectedId, pinned = false, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const officeRef = useRef(new OfficeState(layoutId));
  const snapshotRef = useRef(snapshot);
  const onSelectRef = useRef(onSelect);
  snapshotRef.current = snapshot;
  onSelectRef.current = onSelect;
  const [hits, setHits] = useState<SpriteHit[]>([]);

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
    let lastHits = "";

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
    const parent = canvas.parentElement;
    const observer = parent ? new ResizeObserver(resize) : null;
    if (parent && observer) observer.observe(parent);

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      officeRef.current.sync(snapshotRef.current);
      officeRef.current.update(dt);
      renderOffice(ctx, officeRef.current, now);

      const cam = camera(canvas, officeRef.current.layout);
      const next: SpriteHit[] = [];
      for (const character of officeRef.current.characters.values()) {
        if (!character.visible || character.despawn > 0) continue;
        next.push({
          id: character.agentId,
          name: character.name,
          left: cam.ox + (character.x + 8) * cam.scale,
          top: cam.oy + (character.y + 8) * cam.scale,
        });
      }
      const encoded = JSON.stringify(next);
      if (encoded !== lastHits) {
        lastHits = encoded;
        setHits(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      observer?.disconnect();
    };
  }, []);

  function selectAt(event: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = worldFromEvent(canvas, officeRef.current.layout, event);
    onSelectRef.current(officeRef.current.pick(world.x, world.y));
  }

  return (
    <div className="office-wrap">
      <canvas
        ref={canvasRef}
        onClick={selectAt}
        onPointerUp={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          selectAt(event);
        }}
      />
      {hits.map((hit) => (
        <button
          key={hit.id}
          type="button"
          className={`sprite-hit${selectedId === hit.id ? " selected" : ""}`}
          aria-label={`Inspect ${hit.name}`}
          style={{ left: hit.left, top: hit.top }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(hit.id);
          }}
        />
      ))}
      <p className="office-hint">
        {pinned ? "Pinned — click Follow live in Results to resume auto-follow." : "Click a desk to pin; otherwise following live output."}
      </p>
    </div>
  );
}
