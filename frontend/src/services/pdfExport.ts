import { jsPDF } from 'jspdf';
import type { ZoneRect } from '../components/CardVideo';

export interface PdfExportOptions {
  videoLabel: string;
  modelLabel: string;
  selectedClasses: string[];
  counts: Record<string, number>;
  canvasSnapshot?: string | null; // base64 dataURL จาก canvas
  zone: ZoneRect | null;
}

/** สีหลักของโปรเจกต์ (hex → rgb) */
const C = {
  bg: [13, 15, 18],       // #0d0f12
  green: [167, 202, 177], // #A7CAB1
  dark: [5, 5, 5],        // #050505
  cream: [250, 225, 223], // #FAE1DF
  teal: [11, 110, 79],    // #0B6E4F
  white: [255, 255, 255],
} as const;

export function exportPdf(opts: PdfExportOptions): void {
  const { videoLabel, modelLabel, selectedClasses, counts, canvasSnapshot, zone } = opts;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  /* ── BACKGROUND ── */
  doc.setFillColor(...C.bg);
  doc.rect(0, 0, W, H, 'F');

  /* ── WATERMARK (วาดก่อน content เพื่อให้อยู่ด้านล่าง) ── */
  doc.saveGraphicsState();
  // กำหนด opacity ผ่านการตั้งค่า transparency
  doc.setGState(doc.GState({ opacity: 0.08 }));
  doc.setTextColor(...C.green);
  doc.setFontSize(28);
  const watermarks = [
    'ห้ามใช้ในเชิงพาณิชย์',
    'NOT FOR COMMERCIAL USE',
  ];
  const wmAngle = 45;
  const step = 55;
  for (let wy = -20; wy < H + step; wy += step) {
    for (let wx = -30; wx < W + step; wx += step) {
      doc.text(watermarks[0], wx, wy, { angle: wmAngle });
    }
  }
  doc.setFontSize(14);
  for (let wy = step / 2 - 20; wy < H + step; wy += step) {
    for (let wx = -10; wx < W + step; wx += step) {
      doc.text(watermarks[1], wx, wy, { angle: wmAngle });
    }
  }
  doc.restoreGraphicsState();

  /* ── HEADER BAR ── */
  doc.setFillColor(...C.teal);
  doc.rect(0, 0, W, 20, 'F');

  doc.setTextColor(...C.cream);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Object Detection — Summary Report', W / 2, 13, { align: 'center' });

  /* ── META INFO ── */
  const now = new Date();
  const dateStr = now.toLocaleString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.green);
  doc.text(`วันที่ออกรายงาน: ${dateStr}`, 14, 28);
  doc.text(`วิดีโอ: ${videoLabel}`, 14, 34);
  doc.text(`โมเดล: ${modelLabel}`, 14, 40);
  doc.text(`คลาสที่เลือก: ${selectedClasses.join(', ') || '-'}`, 14, 46);

  if (zone) {
    doc.text(
      `Zone: x=${(zone.x * 100).toFixed(1)}%  y=${(zone.y * 100).toFixed(1)}%  ` +
      `w=${(zone.w * 100).toFixed(1)}%  h=${(zone.h * 100).toFixed(1)}%`,
      14, 52
    );
  }

  /* ── DIVIDER ── */
  let curY = zone ? 58 : 54;
  doc.setDrawColor(...C.green);
  doc.setLineWidth(0.3);
  doc.line(14, curY, W - 14, curY);
  curY += 6;

  /* ── SNAPSHOT ── */
  if (canvasSnapshot) {
    const imgW = W - 28;
    const imgH = imgW * (9 / 16); // สัดส่วน 16:9
    doc.addImage(canvasSnapshot, 'PNG', 14, curY, imgW, imgH);
    curY += imgH + 6;
    doc.setDrawColor(...C.green);
    doc.setLineWidth(0.3);
    doc.line(14, curY, W - 14, curY);
    curY += 6;
  }

  /* ── DETECTION COUNTS TABLE ── */
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.cream);
  doc.text('Detection Counts', 14, curY);
  curY += 5;

  const colW = (W - 28) / 2;
  const rowH = 9;
  const relevantClasses = selectedClasses.length > 0 ? selectedClasses : Object.keys(counts);

  relevantClasses.forEach((cls, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cellX = 14 + col * colW;
    const cellY = curY + row * rowH;

    // bg row
    const bgColor = row % 2 === 0
      ? { r: 255, g: 255, b: 255, a: 0.04 }
      : { r: 255, g: 255, b: 255, a: 0 };
    if (bgColor.a > 0) {
      doc.saveGraphicsState();
      doc.setGState(doc.GState({ opacity: bgColor.a }));
      doc.setFillColor(bgColor.r, bgColor.g, bgColor.b);
      doc.rect(cellX, cellY - rowH + 2, colW - 1, rowH, 'F');
      doc.restoreGraphicsState();
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.cream);
    doc.text(cls, cellX + 2, cellY - 1);

    const countVal = counts[cls] ?? 0;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.green);
    doc.text(String(countVal), cellX + colW - 8, cellY - 1, { align: 'right' });

    // เส้นแบ่ง
    doc.setDrawColor(C.green[0], C.green[1], C.green[2]);
    doc.setLineWidth(0.1);
    doc.line(cellX, cellY + 1, cellX + colW - 1, cellY + 1);
  });

  const rows = Math.ceil(relevantClasses.length / 2);
  curY += rows * rowH + 8;

  /* ── TOTAL ── */
  const total = relevantClasses.reduce((sum, cls) => sum + (counts[cls] ?? 0), 0);
  doc.setFillColor(...C.teal);
  doc.roundedRect(14, curY, W - 28, 11, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C.cream);
  doc.text('Total Detections', 18, curY + 7.5);
  doc.setTextColor(...C.green);
  doc.text(String(total), W - 14, curY + 7.5, { align: 'right' });
  curY += 18;

  /* ── ZONE NOTE ── */
  if (zone) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(C.green[0], C.green[1], C.green[2]);
    doc.text('* ตัวเลขนับเฉพาะวัตถุที่เคลื่อนที่ผ่าน Zone ที่กำหนด', 14, curY);
    curY += 8;
  }

  /* ── FOOTER ── */
  doc.setFillColor(...C.dark);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.green);
  doc.text(
    '⚠ เอกสารนี้สร้างจาก Web Object Detection — ห้ามนำไปใช้ในเชิงพาณิชย์ / NOT FOR COMMERCIAL USE',
    W / 2,
    H - 5,
    { align: 'center' }
  );

  /* ── SAVE ── */
  const fileName = `detection-report_${now.toISOString().slice(0, 19).replace(/[T:]/g, '-')}.pdf`;
  doc.save(fileName);
}
