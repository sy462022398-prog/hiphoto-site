import { useEffect, useRef, useState } from 'react';
import { X, Check, Loader2 } from 'lucide-react';

interface Props {
  file: File;
  /** 已选定的秒数；未选过时用默认值（第 1 秒或时长一半） */
  value?: number;
  onChange: (timeSec: number) => void;
  onClose: () => void;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

/** 视频封面选择器：拖动滑杆定位到某一秒，用当前画面做封面 */
export default function VideoCoverPicker({ file, value, onChange, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(value ?? 0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const v = videoRef.current;
    if (!v) return;
    v.src = url;
    return () => {
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  function handleLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    setDuration(dur);
    const initial = value ?? Math.min(1, dur / 2);
    const t = Math.max(0, Math.min(initial, Math.max(0, dur - 0.05)));
    setTime(t);
    v.currentTime = t;
    setReady(true);
  }

  function seek(t: number) {
    setTime(t);
    const v = videoRef.current;
    if (v) v.currentTime = t;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-100">选择视频封面</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-1.5 rounded-full text-gray-400 hover:text-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-500 truncate">{file.name}</p>

        <div className="relative aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
          <video
            ref={videoRef}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={handleLoadedMetadata}
            onError={() => setFailed(true)}
            className="w-full h-full object-contain"
          />
          {!ready && !failed && (
            <Loader2 className="w-6 h-6 text-gray-500 animate-spin absolute" />
          )}
          {failed && (
            <span className="text-sm text-gray-500 absolute px-4 text-center">
              浏览器无法预览该视频，可直接输入秒数指定封面
            </span>
          )}
        </div>

        <div className="space-y-2">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            disabled={!ready}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">封面时间点</span>
            <span className="text-gray-200 font-mono">
              {fmtTime(time)} / {fmtTime(duration)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400 shrink-0">精确到秒</label>
            <input
              type="number"
              min={0}
              max={duration || undefined}
              step={0.1}
              value={Number(time.toFixed(1))}
              onChange={(e) => {
                const t = Number(e.target.value);
                if (Number.isFinite(t)) {
                  seek(Math.max(0, duration ? Math.min(t, duration) : t));
                }
              }}
              className="w-24 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm focus:outline-none focus:border-amber-500"
            />
            <span className="text-xs text-gray-600">秒</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            onChange(Number(time.toFixed(1)));
            onClose();
          }}
          className="w-full py-2.5 rounded-lg bg-amber-500 text-gray-900 font-semibold hover:bg-amber-400 transition flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4" />
          用第 {time.toFixed(1)} 秒画面做封面
        </button>
      </div>
    </div>
  );
}
