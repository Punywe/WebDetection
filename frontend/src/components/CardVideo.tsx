import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectionModelConfig } from '../config/models';
import { loadDetector, type LoadedDetector } from '../services/detector';
import { Tracker, checkBoundingBoxOverlap, trajectoryCrossesRect } from '../services/tracker';

export interface ZoneRect {
  x: number; // 0–1 (สัดส่วนเทียบกับ canvas)
  y: number;
  w: number;
  h: number;
}

interface NotificationState {
  type: 'loading' | 'success' | 'error' | null;
  message: string;
  detail?: string;
}

interface CardVideoProps {
  src: string | null;
  title?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  model: DetectionModelConfig;
  selectedClasses: string[];
  onCountsChange?: (counts: Record<string, number>) => void;
  onZoneChange?: (zone: ZoneRect | null) => void;
  minScore?: number;
}

// สีวนตาม Track ID (เฉพาะ 4 สี palette ของระบบ: #A7CAB1, #FAE1DF, #0B6E4F)
const TRACK_COLORS = ['#A7CAB1', '#FAE1DF', '#0B6E4F'];
function trackColor(id: number): string {
  return TRACK_COLORS[id % TRACK_COLORS.length];
}

const CardVideo: React.FC<CardVideoProps> = ({
  src,
  title = 'Detection Video',
  videoRef,
  model,
  selectedClasses,
  onCountsChange,
  onZoneChange,
  minScore = 0.35,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<LoadedDetector | null>(null);
  const isDetectingRef = useRef<boolean>(false);
  const trackerRef = useRef<Tracker>(new Tracker(0.22, 15));

  // Zone drawing state
  const [zone, setZone] = useState<ZoneRect | null>(null);
  const [isDrawingZone, setIsDrawingZone] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const drawPreviewRef = useRef<ZoneRect | null>(null);
  const zoneRef = useRef<ZoneRect | null>(null);

  // ── Counting zone state (สะสมตาม track ID ที่ผ่าน zone) ──
  const countedIdsRef = useRef<Set<number>>(new Set());
  const zoneCumulativeCountsRef = useRef<Record<string, number>>({});

  const selectedClassesRef = useRef<string[]>(selectedClasses);
  const availableClassesRef = useRef<string[]>(model.classes);
  const onCountsChangeRef = useRef(onCountsChange);
  const onZoneChangeRef = useRef(onZoneChange);

  // ── Notification State ──
  const [notify, setNotify] = useState<NotificationState>({
    type: 'loading',
    message: 'กำลังเตรียมโมเดล...',
  });
  const [retryKey, setRetryKey] = useState<number>(0);

  useEffect(() => { selectedClassesRef.current = selectedClasses; }, [selectedClasses]);
  useEffect(() => { availableClassesRef.current = model.classes; }, [model.classes]);
  useEffect(() => { onCountsChangeRef.current = onCountsChange; }, [onCountsChange]);
  useEffect(() => { onZoneChangeRef.current = onZoneChange; }, [onZoneChange]);
  useEffect(() => { zoneRef.current = zone; }, [zone]);

  // รีเซ็ตยอดนับให้เป็น 0 ทั้งหมด
  const resetZoneCounts = useCallback(() => {
    countedIdsRef.current.clear();
    const empty = Object.fromEntries(
      availableClassesRef.current.map((cls) => [cls, 0])
    );
    zoneCumulativeCountsRef.current = empty;
    onCountsChangeRef.current?.(empty);
  }, []);

  // 1. โหลดโมเดลพร้อม Notification จัดการสถานะอย่างเรียบร้อย
  useEffect(() => {
    let cancelled = false;
    setNotify({
      type: 'loading',
      message: `กำลังโหลด ${model.label}...`,
    });
    detectorRef.current?.dispose();
    detectorRef.current = null;
    trackerRef.current.reset();
    resetZoneCounts();

    loadDetector(model)
      .then((loaded) => {
        if (cancelled) {
          loaded.dispose();
          return;
        }
        detectorRef.current = loaded;
        setNotify({
          type: 'success',
          message: `${model.label} พร้อมใช้งาน`,
        });

        // ซ่อนข้อความแจ้งความสำเร็จหลัง 2.5 วินาที
        const timer = setTimeout(() => {
          if (!cancelled) {
            setNotify({ type: null, message: '' });
          }
        }, 2500);

        return () => clearTimeout(timer);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const rawMsg = err instanceof Error ? err.message : String(err);
          const friendlyMsg =
            rawMsg.includes('Failed to fetch') || rawMsg.includes('backend')
              ? 'ไม่สามารถเชื่อมต่อ runtime ของโมเดลได้'
              : 'โหลดโมเดลไม่สำเร็จ';
          setNotify({
            type: 'error',
            message: friendlyMsg,
            detail: rawMsg,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [model, resetZoneCounts, retryKey]);

  // 2. เคลียร์ Canvas + reset เมื่อเปลี่ยนคลิป
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    trackerRef.current.reset();
    resetZoneCounts();
  }, [src, model, resetZoneCounts]);

  // แปลงพิกัด mouse บน canvas → สัดส่วน 0-1
  const toRelative = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingZone) return;
    e.preventDefault();
    setDrawStart(toRelative(e));
    drawPreviewRef.current = null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingZone || !drawStart) return;
    e.preventDefault();
    const pos = toRelative(e);
    drawPreviewRef.current = {
      x: Math.min(drawStart.x, pos.x),
      y: Math.min(drawStart.y, pos.y),
      w: Math.abs(pos.x - drawStart.x),
      h: Math.abs(pos.y - drawStart.y),
    };
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingZone || !drawStart) return;
    e.preventDefault();
    const pos = toRelative(e);
    const newZone: ZoneRect = {
      x: Math.min(drawStart.x, pos.x),
      y: Math.min(drawStart.y, pos.y),
      w: Math.abs(pos.x - drawStart.x),
      h: Math.abs(pos.y - drawStart.y),
    };
    if (newZone.w > 0.01 && newZone.h > 0.01) {
      setZone(newZone);
      zoneRef.current = newZone;
      onZoneChangeRef.current?.(newZone);
      resetZoneCounts();
    }
    drawPreviewRef.current = null;
    setDrawStart(null);
    setIsDrawingZone(false);
  };

  // วาดกรอบ zone / preview ด้วยสี #A7CAB1 / #0B6E4F
  const drawZoneRect = (
    ctx: CanvasRenderingContext2D,
    z: ZoneRect,
    cw: number,
    ch: number,
    label?: string,
  ) => {
    const zx = z.x * cw, zy = z.y * ch;
    const zw = z.w * cw, zh = z.h * ch;
    ctx.save();
    ctx.strokeStyle = '#A7CAB1';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(zx, zy, zw, zh);
    ctx.fillStyle = 'rgba(167,202,177,0.07)';
    ctx.fillRect(zx, zy, zw, zh);
    ctx.restore();

    if (label) {
      ctx.save();
      ctx.font = 'bold 11px monospace';
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = '#0B6E4F';
      ctx.fillRect(zx, zy, tw, 18);
      ctx.fillStyle = '#A7CAB1';
      ctx.fillText(label, zx + 4, zy + 13);
      ctx.restore();
    }
  };

  // 3. Detection & Tracking Render Loop
  useEffect(() => {
    let rafId: number;

    const renderLoop = async () => {
      const video = videoRef?.current;
      const canvas = canvasRef.current;
      const detector = detectorRef.current;

      if (video && canvas && video.readyState >= 2) {
        const rect = video.getBoundingClientRect();
        const targetW = Math.max(1, Math.round(rect.width));
        const targetH = Math.max(1, Math.round(rect.height));
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) { rafId = requestAnimationFrame(renderLoop); return; }

        if (detector && !video.paused && !video.ended && !isDetectingRef.current) {
          isDetectingRef.current = true;
          try {
            const rawDetections = await detector.detect(video);
            const activeClasses = selectedClassesRef.current;
            const currentZone = zoneRef.current;

            // กรองตาม class ที่ผู้ใช้เลือก และคะแนนความมั่นใจ
            const filtered = rawDetections.filter(
              (item) => item.score >= minScore && activeClasses.includes(item.className)
            );

            // อัปเดตผ่าน Tracker เพื่อสร้างและรักษา Track ID ข้ามเฟรม
            const activeTracks = trackerRef.current.update(filtered);

            // คำนวณ Scale & Offset สำหรับ Object-contain
            const vidW = video.videoWidth || 1;
            const vidH = video.videoHeight || 1;
            const vidRatio = vidW / vidH;
            const boxRatio = targetW / targetH;
            let drawW = targetW, drawH = targetH, offsetX = 0, offsetY = 0;
            if (vidRatio > boxRatio) {
              drawH = targetW / vidRatio;
              offsetY = (targetH - drawH) / 2;
            } else {
              drawW = targetH * vidRatio;
              offsetX = (targetW - drawW) / 2;
            }
            const scaleX = drawW / vidW;
            const scaleY = drawH / vidH;

            // ── Zone Counting Logic ──
            if (currentZone) {
              const zx = currentZone.x * targetW;
              const zy = currentZone.y * targetH;
              const zw = currentZone.w * targetW;
              const zh = currentZone.h * targetH;
              const zoneBox: [number, number, number, number] = [zx, zy, zw, zh];

              let countsUpdated = false;

              for (const track of activeTracks) {
                // ถ้า track ID นี้เคยถูกนับแล้ว ให้ข้าม
                if (countedIdsRef.current.has(track.id)) continue;

                // พิกัดของ track บน Canvas
                const [bx, by, bw, bh] = track.bbox;
                const ox = offsetX + bx * scaleX;
                const oy = offsetY + by * scaleY;
                const ow = bw * scaleX;
                const oh = bh * scaleY;
                const trackBox: [number, number, number, number] = [ox, oy, ow, oh];

                const cx = ox + ow / 2;
                const cy = oy + oh / 2;

                // 1. ตรวจสอบว่ากล่องวัตถุทับซ้อนกับ Zone หรือไม่
                const boxOverlap = checkBoundingBoxOverlap(trackBox, zoneBox);

                // 2. ตรวจสอบว่าจุดศูนย์กลางอยู่ใน Zone หรือไม่
                const centerInside = cx >= zx && cx <= zx + zw && cy >= zy && cy <= zy + zh;

                // 3. ตรวจสอบว่าเส้นวิถี (Previous Center -> Current Center) พาดผ่าน Zone หรือไม่
                let trajectoryCrossed = false;
                if (track.prevCenter) {
                  const px = offsetX + track.prevCenter.x * scaleX;
                  const py = offsetY + track.prevCenter.y * scaleY;
                  trajectoryCrossed = trajectoryCrossesRect(
                    { x: px, y: py },
                    { x: cx, y: cy },
                    { x: zx, y: zy, w: zw, h: zh }
                  );
                }

                if (boxOverlap || centerInside || trajectoryCrossed) {
                  countedIdsRef.current.add(track.id);
                  if (track.className in zoneCumulativeCountsRef.current) {
                    zoneCumulativeCountsRef.current[track.className] += 1;
                    countsUpdated = true;
                  }
                }
              }

              if (countsUpdated) {
                onCountsChangeRef.current?.({ ...zoneCumulativeCountsRef.current });
              }
            } else {
              // หากยังไม่มีการตั้ง Zone จะไม่นับใดๆ เพื่อไม่ให้นับเองโดยไม่มี Zone
            }

            // ── วาดผลลัพธ์ลงบน Canvas ──
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.setLineDash([]);

            // 1. วาดกรอบ Zone ถ้ามี
            if (currentZone) {
              drawZoneRect(ctx, currentZone, targetW, targetH, 'COUNT ZONE');
            }

            // 2. วาด Bounding Box ของวัตถุที่ตรวจจับได้
            ctx.font = '11px monospace';
            for (const track of activeTracks) {
              const [bx, by, bw, bh] = track.bbox;
              const x = offsetX + bx * scaleX;
              const y = offsetY + by * scaleY;
              const w = bw * scaleX;
              const h = bh * scaleY;

              const alreadyCounted = countedIdsRef.current.has(track.id);
              const color = trackColor(track.id);

              ctx.save();
              if (currentZone && alreadyCounted) {
                ctx.globalAlpha = 0.45;
              }
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.setLineDash([]);
              ctx.strokeRect(x, y, w, h);
              ctx.restore();

              const counted = currentZone && alreadyCounted;
              const labelText = `${track.className} #${track.id}${counted ? ' \u2713' : ''}`;
              const textW = ctx.measureText(labelText).width + 10;
              const labelY = Math.max(18, y);

              ctx.save();
              if (counted) ctx.globalAlpha = 0.45;
              ctx.fillStyle = '#050505';
              ctx.fillRect(x, labelY - 18, textW, 18);
              ctx.fillStyle = color;
              ctx.fillText(labelText, x + 5, labelY - 5);
              ctx.restore();
            }

            // 3. วาดเส้น Preview ขณะผู้ใช้กำลังลากเมาส์สร้าง Zone
            const preview = drawPreviewRef.current;
            if (preview) {
              drawZoneRect(ctx, preview, targetW, targetH);
            }

          } finally {
            isDetectingRef.current = false;
          }
        } else {
          // กรณีวิดีโอหยุด (Paused) ให้เคลียร์และวาดเฉพาะ Zone
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const currentZone = zoneRef.current;
          const preview = drawPreviewRef.current;
          if (currentZone) drawZoneRect(ctx, currentZone, targetW, targetH, 'COUNT ZONE');
          if (preview) drawZoneRect(ctx, preview, targetW, targetH);
        }
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [src, minScore, videoRef]);

  return (
    <div className="w-full h-full bg-[#0d0f12]/90 border border-white/30 rounded-xl p-4 flex flex-col min-h-0">
      <header className="w-full h-10 border-b border-[#A7CAB1]/40 flex items-center justify-between shrink-0">
        <h1 className="text-2xl text-[#FAE1DF] truncate max-w-[200px]">{title}</h1>

        <div className="flex items-center gap-2">
          {/* Header Status Notification Badge */}
          {notify.type === 'loading' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0B6E4F]/25 border border-[#A7CAB1]/30 text-xs text-[#A7CAB1]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#A7CAB1] animate-ping" />
              <span className="truncate max-w-[150px]">{notify.message}</span>
            </div>
          )}
          {notify.type === 'success' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0B6E4F]/35 border border-[#A7CAB1]/40 text-xs text-[#A7CAB1]">
              <span>✓</span>
              <span className="truncate max-w-[150px]">{notify.message}</span>
            </div>
          )}
          {notify.type === 'error' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#050505] border border-[#FAE1DF]/40 text-xs text-[#FAE1DF]">
              <span>!</span>
              <span className="truncate max-w-[150px]">{notify.message}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsDrawingZone(true)}
            disabled={isDrawingZone}
            className={`text-xs px-3 py-1 rounded border font-medium transition cursor-pointer select-none ${
              isDrawingZone
                ? 'bg-[#0B6E4F] border-[#A7CAB1] text-[#A7CAB1] cursor-crosshair'
                : 'bg-transparent border-[#A7CAB1]/40 text-[#A7CAB1] hover:border-[#A7CAB1] hover:bg-[#A7CAB1]/10'
            }`}
          >
            {isDrawingZone ? 'วาด Zone...' : 'Set Zone'}
          </button>
          {zone && !isDrawingZone && (
            <button
              type="button"
              onClick={() => {
                setZone(null);
                zoneRef.current = null;
                onZoneChangeRef.current?.(null);
                resetZoneCounts();
              }}
              className="text-xs px-3 py-1 rounded border border-[#A7CAB1]/40 text-[#FAE1DF]/60 hover:border-[#FAE1DF]/60 hover:text-[#FAE1DF] transition cursor-pointer select-none"
            >
              Clear Zone
            </button>
          )}
        </div>
      </header>

      <div className="mt-4 w-full flex-1 min-h-0 bg-[#0d0f12]/40 rounded-lg overflow-hidden flex items-center justify-center relative">
        {/* Floating In-Card Error Toast Notification */}
        {notify.type === 'error' && (
          <div className="absolute top-3 left-4 right-4 z-20 flex items-start justify-between p-3 rounded-lg bg-[#050505]/95 border border-[#FAE1DF]/40 shadow-xl backdrop-blur-sm text-xs">
            <div className="flex flex-col gap-1 pr-3 max-w-[85%]">
              <span className="font-semibold text-[#FAE1DF] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#FAE1DF]" />
                {notify.message}
              </span>
              {notify.detail && (
                <span className="text-[#FAE1DF]/60 font-mono text-[10px] break-all max-h-14 overflow-y-auto pr-1">
                  {notify.detail}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setRetryKey((k) => k + 1)}
                className="px-2 py-1 rounded bg-[#0B6E4F] border border-[#A7CAB1]/40 text-[#A7CAB1] hover:bg-[#0B6E4F]/80 transition cursor-pointer font-medium"
              >
                ลองใหม่
              </button>
              <button
                type="button"
                onClick={() => setNotify({ type: null, message: '' })}
                className="px-1.5 py-1 text-[#FAE1DF]/50 hover:text-[#FAE1DF] transition cursor-pointer"
                title="ปิด"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Loading Spinner Indicator */}
        {notify.type === 'loading' && !detectorRef.current && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#050505]/60 backdrop-blur-[2px]">
            <div className="w-8 h-8 rounded-full border-2 border-[#A7CAB1]/30 border-t-[#A7CAB1] animate-spin mb-2" />
            <span className="text-xs text-[#A7CAB1] font-medium">{notify.message}</span>
          </div>
        )}

        {src ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              key={src}
              src={src}
              controls
              className="w-full h-full object-contain"
            />
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              className={`absolute inset-0 w-full h-full select-none ${
                isDrawingZone ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'
              }`}
            />
          </div>
        ) : (
          <p className="text-sm text-white/50">ยังไม่ได้เลือกคลิปวิดีโอ</p>
        )}
      </div>
    </div>
  );
};

export default CardVideo;
