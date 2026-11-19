import React from 'react';
import type { SampleVideo } from '../pages/DashboardPage';
import type { DetectionModelConfig } from '../config/models';
import type { ZoneRect } from './CardVideo';

interface CardControlsProps {
  videos: SampleVideo[];
  selectedVideoId: string;
  onSelectVideo: (video: SampleVideo) => void;
  models: DetectionModelConfig[];
  selectedModelId: string;
  onSelectModel: (model: DetectionModelConfig) => void;
  availableClasses: string[];
  selectedClasses: string[];
  onToggleClass: (cls: string) => void;
  counts?: Record<string, number>;
  zone?: ZoneRect | null;
  onExportPdf?: () => void;
}

const CardControls: React.FC<CardControlsProps> = ({
  videos,
  selectedVideoId,
  onSelectVideo,
  models,
  selectedModelId,
  onSelectModel,
  availableClasses,
  selectedClasses,
  onToggleClass,
  counts,
  zone,
  onExportPdf,
}) => {
  return (
    <div className="w-full h-full bg-[#0d0f12]/90 border border-white/30 rounded-xl p-4 flex flex-col justify-between text-[#FAE1DF] min-h-0 ">
      <div className="space-y-5 overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [-ms-overflow-style:none] pr-1">
        <header className="w-full h-10 border-b border-[#A7CAB1]/40 flex items-center">
          <h2 className="text-xl font-medium">Controls & Filter</h2>
        </header>

        {/* 1. เลือกคลิปตัวอย่าง */}
        <div>
          <p className="text-xs text-white/60 mb-2">SELECT VIDEO</p>
          <div className="flex flex-col gap-2">
            {videos.map((video) => {
              const isSelected = video.id === selectedVideoId;
              return (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => onSelectVideo(video)}
                  className={`px-3 py-2 rounded-lg text-left text-sm transition border cursor-pointer ${
                    isSelected
                      ? 'bg-[#A7CAB1]/20 border-[#A7CAB1] text-[#FAE1DF]'
                      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                  }`}
                >
                  {video.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. เลือกโมเดลจาก models */}
        <div>
          <p className="text-xs text-white/60 mb-2">SELECT MODEL</p>
          <div className="flex flex-col gap-2">
            {models.map((model) => {
              const isSelected = model.id === selectedModelId;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => onSelectModel(model)}
                  className={`px-3 py-2 rounded-lg text-left text-sm transition border cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-[#A7CAB1]/20 border-[#A7CAB1] text-[#FAE1DF]'
                      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                  }`}
                >
                  <span>{model.label}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white/70">
                    {model.runtime}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. เลือกคลาสตาม availableClasses ของโมเดลที่เลือก */}
        <div>
          <p className="text-xs text-white/60 mb-2">DETECT CLASSES</p>
          <div className="flex flex-wrap gap-2">
            {availableClasses.map((cls) => {
              const active = selectedClasses.includes(cls);
              return (
                <button
                  key={cls}
                  type="button"
                  onClick={() => onToggleClass(cls)}
                  className={`px-3 py-1 rounded-lg text-xs border transition cursor-pointer ${
                    active
                      ? 'bg-[#0B6E4F]/50 border-[#A7CAB1] text-white'
                      : 'bg-white/5 border-white/10 text-white/40 hover:text-white/70'
                  }`}
                >
                  {cls}
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. แสดงผลจำนวนนับตาม availableClasses */}
        {counts && (
          <div>
            <p className="text-xs text-white/60 mb-2">DETECTION COUNTS</p>
            <div className="grid grid-cols-2 gap-2">
              {availableClasses.map((cls) => {
                const isSelected = selectedClasses.includes(cls);
                return (
                  <div
                    key={cls}
                    className={`px-3 py-2 rounded-lg border flex items-center justify-between transition ${
                      isSelected
                        ? 'bg-white/5 border-white/15'
                        : 'bg-white/[0.02] border-white/5 opacity-50'
                    }`}
                  >
                    <span className="text-xs text-white/75">{cls}</span>
                    <span className="text-sm font-semibold text-[#A7CAB1]">
                      {counts[cls] ?? 0}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 5. Zone Status */}
      {zone ? (
        <div className="mt-3 px-3 py-2 rounded-lg border border-[#A7CAB1]/30 bg-[#0B6E4F]/15 shrink-0">
          <p className="text-xs text-[#A7CAB1] font-medium mb-0.5">COUNT ZONE ACTIVE</p>
          <p className="text-[10px] text-[#FAE1DF]/40">
            x={`${(zone.x * 100).toFixed(1)}%`}&nbsp;&nbsp;y={`${(zone.y * 100).toFixed(1)}%`}&nbsp;&nbsp;w={`${(zone.w * 100).toFixed(1)}%`}&nbsp;&nbsp;h={`${(zone.h * 100).toFixed(1)}%`}
          </p>
          <p className="text-[10px] text-[#FAE1DF]/30 mt-0.5">* นับสะสมเมื่อ object ผ่าน zone (ไม่นับซ้ำ)</p>
        </div>
      ) : (
        <div className="mt-3 px-3 py-2 rounded-lg border border-white/8 bg-white/[0.02] shrink-0">
          <p className="text-[10px] text-[#FAE1DF]/25">ยังไม่ได้ตั้ง Zone — วาด Zone เพื่อเริ่มนับวัตถุที่ผ่าน</p>
        </div>
      )}

      {/* 6. ปุ่ม Export PDF */}
      <button
        type="button"
        onClick={onExportPdf}
        className="mt-4 w-full py-2.5 rounded-lg bg-[#A7CAB1] text-[#050505] font-medium text-sm hover:opacity-90 transition cursor-pointer shrink-0"
      >
        Export Summary PDF
      </button>
    </div>
  );
};

export default CardControls;