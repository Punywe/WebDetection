/**
 * Simple, Robust Multi-Object Tracker (SORT-lite)
 * พร้อมฟังก์ชันช่วยตรวจจับการข้าม Zone แบบ Trajectory + Bounding Box
 */

import type { DetectionItem } from './detector';

export interface Point {
  x: number;
  y: number;
}

export interface Track {
  id: number;
  className: string;
  bbox: [number, number, number, number]; // [x, y, w, h]
  score: number;
  missed: number;
  age: number;
  prevCenter?: Point;
  currCenter: Point;
}

let _nextTrackId = 1;

/** คำนวณ IoU ระหว่าง 2 กล่อง */
export function computeIoU(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);

  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}

/** ตรวจสอบว่ากล่อง A และ B ทับซ้อนกันหรือไม่ */
export function checkBoundingBoxOverlap(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): boolean {
  const x1 = Math.max(boxA[0], boxB[0]);
  const y1 = Math.max(boxA[1], boxB[1]);
  const x2 = Math.min(boxA[0] + boxA[2], boxB[0] + boxB[2]);
  const y2 = Math.min(boxA[1] + boxA[3], boxB[1] + boxB[3]);
  return x2 > x1 && y2 > y1;
}

function lineIntersectsLine(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-6) return false;
  const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/** ตรวจสอบว่าเส้นวิถีการเคลื่อนที่ (prev -> curr) พาดผ่านกรอบ zone หรือไม่ */
export function trajectoryCrossesRect(
  pPrev: Point,
  pCurr: Point,
  rect: { x: number; y: number; w: number; h: number }
): boolean {
  const inside = (p: Point) =>
    p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;

  if (inside(pPrev) || inside(pCurr)) return true;

  const tl = { x: rect.x, y: rect.y };
  const tr = { x: rect.x + rect.w, y: rect.y };
  const bl = { x: rect.x, y: rect.y + rect.h };
  const br = { x: rect.x + rect.w, y: rect.y + rect.h };

  return (
    lineIntersectsLine(pPrev, pCurr, tl, tr) ||
    lineIntersectsLine(pPrev, pCurr, tr, br) ||
    lineIntersectsLine(pPrev, pCurr, br, bl) ||
    lineIntersectsLine(pPrev, pCurr, bl, tl)
  );
}

export class Tracker {
  private tracks: Track[] = [];
  private readonly iouThreshold: number;
  private readonly maxMissed: number;

  constructor(iouThreshold = 0.22, maxMissed = 15) {
    this.iouThreshold = iouThreshold;
    this.maxMissed = maxMissed;
  }

  update(detections: DetectionItem[]): Track[] {
    // 1. เพิ่ม missed ของ track เก่าทุกตัว
    for (const t of this.tracks) {
      t.missed += 1;
      t.age += 1;
    }

    // 2. จับคู่ detections กับ tracks เดิมด้วย IoU
    const matchedTrackIndices = new Set<number>();
    const matchedDetIndices = new Set<number>();

    interface CandidateMatch {
      trackIndex: number;
      detIndex: number;
      iou: number;
    }

    const candidates: CandidateMatch[] = [];
    for (let di = 0; di < detections.length; di++) {
      for (let ti = 0; ti < this.tracks.length; ti++) {
        if (this.tracks[ti].className !== detections[di].className) continue;
        const score = computeIoU(this.tracks[ti].bbox, detections[di].bbox);
        if (score >= this.iouThreshold) {
          candidates.push({ trackIndex: ti, detIndex: di, iou: score });
        }
      }
    }

    candidates.sort((a, b) => b.iou - a.iou);

    for (const match of candidates) {
      if (matchedTrackIndices.has(match.trackIndex) || matchedDetIndices.has(match.detIndex)) {
        continue;
      }
      const track = this.tracks[match.trackIndex];
      const det = detections[match.detIndex];

      track.prevCenter = { ...track.currCenter };
      track.bbox = det.bbox;
      track.currCenter = {
        x: det.bbox[0] + det.bbox[2] / 2,
        y: det.bbox[1] + det.bbox[3] / 2,
      };
      track.score = det.score;
      track.missed = 0;

      matchedTrackIndices.add(match.trackIndex);
      matchedDetIndices.add(match.detIndex);
    }

    // 3. สำหรับ detection ที่ไม่ match ให้สร้าง track ใหม่
    for (let di = 0; di < detections.length; di++) {
      if (matchedDetIndices.has(di)) continue;
      const det = detections[di];
      const center = {
        x: det.bbox[0] + det.bbox[2] / 2,
        y: det.bbox[1] + det.bbox[3] / 2,
      };

      this.tracks.push({
        id: _nextTrackId++,
        className: det.className,
        bbox: det.bbox,
        score: det.score,
        missed: 0,
        age: 1,
        prevCenter: { ...center },
        currCenter: center,
      });
    }

    // 4. ลบ track ที่หายไปนานเกิน maxMissed
    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMissed);

    // 5. ส่งคืนเฉพาะ track ที่ active ในเฟรมปัจจุบัน
    return this.tracks.filter((t) => t.missed === 0);
  }

  reset(): void {
    this.tracks = [];
    _nextTrackId = 1;
  }
}
