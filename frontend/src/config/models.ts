export type ModelRuntime = 'yolox' | 'coco-ssd';

export interface DetectionModelConfig {
  id: string;
  label: string;
  runtime: ModelRuntime;
  modelPath?: string;
  classes: string[]; // คลาสที่รองรับในโมเดลนี้
  defaultSelectedClasses?: string[];
}

export const DETECTION_MODELS: DetectionModelConfig[] = [
  {
    id: 'yolox-nano',
    label: 'YOLOX Nano (Browser YOLO)',
    runtime: 'yolox',
    modelPath: '/models/yolox_nano.onnx',
    classes: ['person', 'car', 'motorcycle', 'bicycle', 'truck', 'bus'],
    defaultSelectedClasses: ['person', 'car'],
  },
  {
    id: 'yolox-tiny',
    label: 'YOLOX Tiny (High Acc YOLO)',
    runtime: 'yolox',
    modelPath: '/models/yolox_tiny.onnx',
    classes: ['person', 'car', 'motorcycle', 'bicycle', 'truck', 'bus'],
    defaultSelectedClasses: ['person', 'car'],
  },
  {
    id: 'coco-default',
    label: 'COCO Baseline (MobileNet)',
    runtime: 'coco-ssd',
    classes: ['person', 'car', 'motorcycle', 'bicycle', 'truck', 'bus'],
    defaultSelectedClasses: ['person', 'car'],
  },
];
