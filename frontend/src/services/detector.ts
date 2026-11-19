import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as ort from 'onnxruntime-web';
import type { DetectionModelConfig } from '../config/models';

export interface DetectionItem {
  className: string;
  score: number;
  // พิกัดอิงตามขนาดจริงของวิดีโอ [x, y, width, height]
  bbox: [number, number, number, number];
}

export interface LoadedDetector {
  modelId: string;
  runtime: DetectionModelConfig['runtime'];
  detect: (video: HTMLVideoElement) => Promise<DetectionItem[]>;
  dispose: () => void;
}

// 80 คลาสตามมาตรฐาน COCO Dataset (ใช้กับโมเดล YOLOX)
const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush',
];

const YOLOX_INPUT_SIZE = 416;
const YOLOX_STRIDES = [8, 16, 32];

interface PrecomputedGrid {
  gridX: number;
  gridY: number;
  stride: number;
}

// สร้าง grid คำนวณล่วงหน้า 3549 จุดสำหรับ 416x416
const PRECOMPUTED_GRIDS: PrecomputedGrid[] = [];
for (const stride of YOLOX_STRIDES) {
  const numGridY = Math.floor(YOLOX_INPUT_SIZE / stride);
  const numGridX = Math.floor(YOLOX_INPUT_SIZE / stride);
  for (let gY = 0; gY < numGridY; gY++) {
    for (let gX = 0; gX < numGridX; gX++) {
      PRECOMPUTED_GRIDS.push({ gridX: gX, gridY: gY, stride });
    }
  }
}

// Canvas ชั่วคราวสำหรับ Letterbox preprocessing
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;

function getPreprocessingCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
    sharedCanvas.width = YOLOX_INPUT_SIZE;
    sharedCanvas.height = YOLOX_INPUT_SIZE;
    sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: sharedCanvas, ctx: sharedCtx! };
}

function computeIoU(
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

function nms(items: DetectionItem[], iouThreshold = 0.45): DetectionItem[] {
  items.sort((a, b) => b.score - a.score);
  const selected: DetectionItem[] = [];

  for (const item of items) {
    const overlap = selected.some(
      (s) => s.className === item.className && computeIoU(s.bbox, item.bbox) > iouThreshold
    );
    if (!overlap) {
      selected.push(item);
    }
  }

  return selected;
}

export async function loadDetector(config: DetectionModelConfig): Promise<LoadedDetector> {
  if (config.runtime === 'yolox') {
    const modelUrl = config.modelPath || '/models/yolox_nano.onnx';

    let session: ort.InferenceSession;
    try {
      ort.env.wasm.wasmPaths = '/ort-dist/';
      ort.env.wasm.numThreads = 1;
      session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
      });
    } catch {
      // Fallback ไป CDN หาก local path มีปัญหา
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
      session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
      });
    }

    const inputTensorData = new Float32Array(3 * YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE);
    const channelSize = YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;

    return {
      modelId: config.id,
      runtime: config.runtime,
      detect: async (video: HTMLVideoElement) => {
        const vidW = video.videoWidth || 1;
        const vidH = video.videoHeight || 1;

        const { ctx } = getPreprocessingCanvas();

        // 1. เติมสีพื้นหลังเทา 114 ตามสเปค YOLOX
        ctx.fillStyle = 'rgb(114, 114, 114)';
        ctx.fillRect(0, 0, YOLOX_INPUT_SIZE, YOLOX_INPUT_SIZE);

        // 2. คำนวณอัตราส่วน Letterbox
        const ratio = Math.min(YOLOX_INPUT_SIZE / vidW, YOLOX_INPUT_SIZE / vidH);
        const newW = Math.round(vidW * ratio);
        const newH = Math.round(vidH * ratio);

        // วาดเฟรมวิดีโอบน canvas ที่ตำแหน่งมุมซ้ายบน
        ctx.drawImage(video, 0, 0, vidW, vidH, 0, 0, newW, newH);

        // 3. แปลงภาพเป็น Float32Array แบบ CHW (RGB)
        const imgData = ctx.getImageData(0, 0, YOLOX_INPUT_SIZE, YOLOX_INPUT_SIZE).data;
        for (let i = 0; i < channelSize; i++) {
          const pixelOffset = i * 4;
          inputTensorData[i] = imgData[pixelOffset];                   // R
          inputTensorData[channelSize + i] = imgData[pixelOffset + 1]; // G
          inputTensorData[2 * channelSize + i] = imgData[pixelOffset + 2]; // B
        }

        const inputTensor = new ort.Tensor('float32', inputTensorData, [1, 3, YOLOX_INPUT_SIZE, YOLOX_INPUT_SIZE]);
        const outputMap = await session.run({ images: inputTensor });
        const outputData = outputMap.output.data as Float32Array;

        // 4. ถอดรหัสผลลัพธ์ (Decoding Anchor-free grids)
        const candidates: DetectionItem[] = [];
        const numClasses = 80;
        const colCount = 5 + numClasses;
        const confThreshold = 0.25;

        for (let i = 0; i < PRECOMPUTED_GRIDS.length; i++) {
          const offset = i * colCount;
          const objScore = outputData[offset + 4];
          if (objScore < confThreshold) continue;

          let maxClassScore = 0;
          let classId = -1;
          for (let c = 0; c < numClasses; c++) {
            const clsVal = outputData[offset + 5 + c];
            if (clsVal > maxClassScore) {
              maxClassScore = clsVal;
              classId = c;
            }
          }

          const finalScore = objScore * maxClassScore;
          if (finalScore >= confThreshold) {
            const g = PRECOMPUTED_GRIDS[i];
            const rawX = outputData[offset + 0];
            const rawY = outputData[offset + 1];
            const rawW = outputData[offset + 2];
            const rawH = outputData[offset + 3];

            const cx = (rawX + g.gridX) * g.stride;
            const cy = (rawY + g.gridY) * g.stride;
            const w = Math.exp(rawW) * g.stride;
            const h = Math.exp(rawH) * g.stride;

            // ปรับสเกลกลับสู่ขนาดวิดีโอต้นฉบับ
            const origX = Math.max(0, (cx - w / 2) / ratio);
            const origY = Math.max(0, (cy - h / 2) / ratio);
            const origW = Math.min(vidW - origX, w / ratio);
            const origH = Math.min(vidH - origY, h / ratio);

            candidates.push({
              className: COCO_CLASSES[classId] || 'object',
              score: finalScore,
              bbox: [origX, origY, origW, origH],
            });
          }
        }

        // 5. ตัดกล่องที่ทับซ้อนด้วย NMS
        return nms(candidates, 0.45);
      },
      dispose: () => {
        session.release().catch(console.error);
      },
    };
  }

  if (config.runtime === 'coco-ssd') {
    await tf.ready();
    const model = await cocoSsd.load({ base: 'mobilenet_v2' });

    return {
      modelId: config.id,
      runtime: config.runtime,
      detect: async (video: HTMLVideoElement) => {
        const predictions = await model.detect(video, 40, 0.35);
        return predictions.map((p) => ({
          className: p.class,
          score: p.score,
          bbox: p.bbox as [number, number, number, number],
        }));
      },
      dispose: () => {
        model.dispose();
      },
    };
  }

  throw new Error(`ไม่รองรับ runtime: ${String(config.runtime)}`);
}
