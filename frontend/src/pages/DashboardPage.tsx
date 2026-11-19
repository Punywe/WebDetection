import { useRef, useState } from 'react';
import CardVideo from '../components/CardVideo';
import type { ZoneRect } from '../components/CardVideo';
import CardControls from '../components/CardControls';
import { DETECTION_MODELS, type DetectionModelConfig } from '../config/models';
import { exportPdf } from '../services/pdfExport';

export interface SampleVideo {
  id: string;
  label: string;
  src: string;
}

const SAMPLE_VIDEOS: SampleVideo[] = [
  { id: 'ex1', label: 'Example 1', src: '/videos/example1.mp4' },
  { id: 'ex2', label: 'Example 2', src: '/videos/example2.mp4' },
  { id: 'ex3', label: 'Example 3', src: '/videos/example3.mp4' },
];

const createEmptyCounts = (classes: string[]): Record<string, number> =>
  Object.fromEntries(classes.map((cls) => [cls, 0]));

export const DashboardPage = () => {
  const initialModel = DETECTION_MODELS[0];

  const [selectedVideo, setSelectedVideo] = useState<SampleVideo>(SAMPLE_VIDEOS[0]);
  const [selectedModel, setSelectedModel] = useState<DetectionModelConfig>(initialModel);
  const [selectedClasses, setSelectedClasses] = useState<string[]>(
    initialModel.defaultSelectedClasses ?? initialModel.classes
  );
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    createEmptyCounts(initialModel.classes)
  );
  const [zone, setZone] = useState<ZoneRect | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleSelectModel = (model: DetectionModelConfig) => {
    setSelectedModel(model);
    setSelectedClasses(model.defaultSelectedClasses ?? model.classes);
    setCounts(createEmptyCounts(model.classes));
  };

  const handleToggleClass = (cls: string) => {
    setSelectedClasses((prev) =>
      prev.includes(cls) ? prev.filter((item) => item !== cls) : [...prev, cls]
    );
  };

  const handleExportPdf = () => {
    // จับภาพ canvas overlay เป็น snapshot
    const canvas = canvasRef.current;
    let snapshot: string | null = null;
    if (canvas) {
      // วาด video frame + canvas overlay รวมกัน
      const video = videoRef.current;
      const composite = document.createElement('canvas');
      composite.width = canvas.width;
      composite.height = canvas.height;
      const ctx = composite.getContext('2d');
      if (ctx && video) {
        // ใส่พื้นหลังดำ
        ctx.fillStyle = '#0d0f12';
        ctx.fillRect(0, 0, composite.width, composite.height);
        // วาด video frame
        ctx.drawImage(video, 0, 0, composite.width, composite.height);
        // วาด canvas overlay ทับ
        ctx.drawImage(canvas, 0, 0);
      }
      snapshot = composite.toDataURL('image/png');
    }

    exportPdf({
      videoLabel: selectedVideo.label,
      modelLabel: selectedModel.label,
      selectedClasses,
      counts,
      canvasSnapshot: snapshot,
      zone,
    });
  };

  return (
    <div className="w-full h-screen p-2 flex flex-col justify-center items-center bg-linear-to-br from-[#050505] from-50% to-[#A7CAB1]">
      <div
        className="w-[70%] h-[80%] rounded-2xl bg-linear-to-br from-[#A7CAB1] from-5% via-[#0B6E4F] to-[#050505]
        shadow-[-14px_-14px_48px_rgba(167,202,177,0.42),14px_14px_48px_rgba(5,5,5,0.75)] grid grid-cols-[2fr_1fr] p-4 gap-4"
      >
        {/* ฝั่งซ้าย: CardVideo */}
        <div className="w-full h-full min-h-0">
          <CardVideo
            src={selectedVideo.src}
            title={selectedVideo.label}
            videoRef={videoRef}
            model={selectedModel}
            selectedClasses={selectedClasses}
            onCountsChange={setCounts}
            onZoneChange={setZone}
          />
        </div>

        {/* ฝั่งขวา: CardControls */}
        <div className="w-full h-full min-h-0">
          <CardControls
            videos={SAMPLE_VIDEOS}
            selectedVideoId={selectedVideo.id}
            onSelectVideo={setSelectedVideo}
            models={DETECTION_MODELS}
            selectedModelId={selectedModel.id}
            onSelectModel={handleSelectModel}
            availableClasses={selectedModel.classes}
            selectedClasses={selectedClasses}
            onToggleClass={handleToggleClass}
            counts={counts}
            zone={zone}
            onExportPdf={handleExportPdf}
          />
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
