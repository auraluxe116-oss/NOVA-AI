import { Download, Film, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { VideoScene, VideoStoryboard } from '../types/nova';

interface VideoStudioCanvasProps {
  storyboard: VideoStoryboard;
  onChangeStoryboard: (next: VideoStoryboard) => void;
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function drawSceneFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  storyboard: VideoStoryboard,
  scene: VideoScene,
  sceneIndex: number,
  sceneProgress: number,
  globalProgress: number
) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(scene.accentColor || '')
    ? scene.accentColor
    : '#3B82F6';
  const isVertical = storyboard.format === '9:16';

  // Background
  ctx.fillStyle = '#08080B';
  ctx.fillRect(0, 0, width, height);

  // Animated subtle radial gradient glow
  const driftX = Math.sin(globalProgress * Math.PI * 2) * (width * 0.12);
  const driftY = Math.cos(globalProgress * Math.PI * 2) * (height * 0.08);
  const grad = ctx.createRadialGradient(
    width * 0.5 + driftX,
    height * 0.36 + driftY,
    width * 0.05,
    width * 0.5 + driftX,
    height * 0.36 + driftY,
    width * 0.85
  );
  grad.addColorStop(0, `${accent}55`);
  grad.addColorStop(0.5, '#7C3AED28');
  grad.addColorStop(1, '#08080B00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle architectural grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  const step = isVertical ? 60 : 80;
  for (let x = step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Top progress track
  const padX = isVertical ? 48 : 72;
  const topY = isVertical ? 54 : 44;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(padX, topY, width - padX * 2, 6);
  ctx.fillStyle = accent;
  ctx.fillRect(padX, topY, Math.max(8, (width - padX * 2) * globalProgress), 6);

  // Header metadata
  ctx.font = `600 ${isVertical ? 20 : 22}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#C4B5FD';
  ctx.textAlign = 'left';
  ctx.fillText(
    `SCÈNE ${sceneIndex + 1}/${storyboard.scenes.length}  ·  ${scene.shotType.toUpperCase()}`,
    padX,
    topY + 42
  );

  ctx.font = `500 ${isVertical ? 18 : 20}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#9E9EB5';
  ctx.fillText(storyboard.title.slice(0, 48), padX, topY + 72);

  // Center kinetic on-screen text with fade/slide entrance
  const enter = Math.min(1, sceneProgress * 4.5);
  const offsetY = (1 - enter) * 24;
  ctx.save();
  ctx.globalAlpha = Math.max(0.15, enter);

  const displaySize = isVertical ? 54 : 52;
  ctx.font = `800 ${displaySize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#FAFAFA';
  ctx.textAlign = 'center';
  const mainLines = wrapTextLines(ctx, scene.onScreenText || scene.title, width - padX * 2);
  const lineH = displaySize * 1.2;
  const blockTop = height * 0.44 - (mainLines.length * lineH) / 2 + offsetY;
  mainLines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, blockTop + idx * lineH);
  });

  // Visual direction hint
  if (scene.visualDirection) {
    ctx.font = `500 ${isVertical ? 22 : 20}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = '#B4B4CC';
    const dirLines = wrapTextLines(ctx, scene.visualDirection, width - padX * 2.5).slice(0, 2);
    dirLines.forEach((line, idx) => {
      ctx.fillText(line, width / 2, blockTop + mainLines.length * lineH + 28 + idx * 28);
    });
  }
  ctx.restore();

  // Bottom Subtitle Plate
  const subText = (scene.subtitle || scene.voiceover || '').trim();
  if (subText) {
    ctx.font = `600 ${isVertical ? 28 : 26}px system-ui, -apple-system, sans-serif`;
    const subLines = wrapTextLines(ctx, subText, width - padX * 2.4).slice(0, 3);
    const subLineH = isVertical ? 36 : 34;
    const boxH = subLines.length * subLineH + 34;
    const boxY = height - boxH - (isVertical ? 96 : 56);

    ctx.fillStyle = 'rgba(11, 11, 16, 0.88)';
    ctx.strokeStyle = 'rgba(124, 58, 237, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(padX, boxY, width - padX * 2, boxH, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    subLines.forEach((line, idx) => {
      ctx.fillText(line, width / 2, boxY + 34 + idx * subLineH);
    });
  }
}

export function VideoStudioCanvas({
  storyboard,
  onChangeStoryboard,
}: VideoStudioCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [voicePreviewEnabled, setVoicePreviewEnabled] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const lastSpokenSceneRef = useRef<number>(-1);

  const dimensions = useMemo(
    () =>
      storyboard.format === '9:16'
        ? { width: 720, height: 1280 }
        : { width: 1280, height: 720 },
    [storyboard.format]
  );

  const timeline = useMemo(() => {
    let cursor = 0;
    return storyboard.scenes.map((scene) => {
      const dur = Math.max(2, Math.min(20, Number(scene.durationSec) || 4));
      const start = cursor;
      cursor += dur;
      return { scene, start, end: cursor, dur };
    });
  }, [storyboard.scenes]);

  const totalDuration = useMemo(
    () => Math.max(1, timeline.reduce((acc, item) => acc + item.dur, 0)),
    [timeline]
  );

  const activeEntry = useMemo(() => {
    const idx = timeline.findIndex((t) => currentTime >= t.start && currentTime < t.end);
    const resolvedIdx = idx >= 0 ? idx : Math.max(0, timeline.length - 1);
    return {
      index: resolvedIdx,
      entry: timeline[resolvedIdx],
    };
  }, [timeline, currentTime]);

  // Draw current frame whenever time or storyboard changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeEntry.entry) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { scene, start, dur } = activeEntry.entry;
    const sceneProgress = Math.max(0, Math.min(1, (currentTime - start) / dur));
    const globalProgress = Math.max(0, Math.min(1, currentTime / totalDuration));

    drawSceneFrame(
      ctx,
      dimensions.width,
      dimensions.height,
      storyboard,
      scene,
      activeEntry.index,
      sceneProgress,
      globalProgress
    );
  }, [activeEntry, currentTime, dimensions.height, dimensions.width, storyboard, totalDuration]);

  // Optional French browser voiceover while previewing
  useEffect(() => {
    if (!isPlaying || !voicePreviewEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    if (lastSpokenSceneRef.current !== activeEntry.index && activeEntry.entry) {
      lastSpokenSceneRef.current = activeEntry.index;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(activeEntry.entry.scene.voiceover);
      utter.lang = 'fr-FR';
      utter.rate = 1.04;
      window.speechSynthesis.speak(utter);
    }
  }, [activeEntry.index, activeEntry.entry, isPlaying, voicePreviewEnabled]);

  useEffect(() => {
    if (!isPlaying && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      lastSpokenSceneRef.current = -1;
    }
  }, [isPlaying]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let lastTs = performance.now();

    const step = (now: number) => {
      const dt = (now - lastTs) / 1000;
      lastTs = now;
      setCurrentTime((prev) => {
        const next = prev + dt;
        if (next >= totalDuration) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, totalDuration]);

  const handleExportWebm = async () => {
    setExportError(null);
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
      setExportError(
        "Votre navigateur ne supporte pas l'export vidéo MediaRecorder. Essayez avec Chrome, Edge ou Firefox à jour."
      );
      return;
    }

    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mimeType) {
      setExportError('Aucun codec WebM compatible trouvé dans ce navigateur.');
      return;
    }

    setIsPlaying(false);
    setIsExporting(true);
    setExportProgress(0);

    try {
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_500_000 });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunks.push(ev.data);
        }
      };

      const stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: mimeType }));
        };
      });

      recorder.start(200);
      const ctx = canvas.getContext('2d');
      const fps = 30;
      const totalFrames = Math.ceil(totalDuration * fps);

      for (let f = 0; f <= totalFrames; f++) {
        const t = Math.min(totalDuration - 0.001, (f / fps));
        const matchIdx = timeline.findIndex((item) => t >= item.start && t < item.end);
        const idx = matchIdx >= 0 ? matchIdx : timeline.length - 1;
        const entry = timeline[idx];
        if (ctx && entry) {
          const sProg = Math.max(0, Math.min(1, (t - entry.start) / entry.dur));
          const gProg = Math.max(0, Math.min(1, t / totalDuration));
          drawSceneFrame(
            ctx,
            dimensions.width,
            dimensions.height,
            storyboard,
            entry.scene,
            idx,
            sProg,
            gProg
          );
        }
        setExportProgress(Math.round((f / totalFrames) * 100));
        // Real-time pacing at ~33ms so MediaRecorder records accurate timestamps
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }

      recorder.stop();
      const blob = await stopped;
      stream.getTracks().forEach((tr) => tr.stop());

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug =
        storyboard.title
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'video-nova';
      a.href = url;
      a.download = `${slug}-${storyboard.format.replace(':', 'x')}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Erreur lors de l'encodage vidéo WebM."
      );
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      setCurrentTime(0);
    }
  };

  const updateScene = (index: number, patch: Partial<VideoScene>) => {
    const nextScenes = storyboard.scenes.map((sc, i) => (i === index ? { ...sc, ...patch } : sc));
    onChangeStoryboard({ ...storyboard, scenes: nextScenes });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Canvas Player + Controls */}
      <div className="lg:col-span-5 space-y-4">
        <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-white">
              <Film className="h-4 w-4 text-[#3B82F6]" />
              Aperçu Vidéo ({storyboard.format})
            </span>
            <span className="font-mono tabular-nums text-[#A8A8BE]">
              {currentTime.toFixed(1)}s / {totalDuration.toFixed(1)}s
            </span>
          </div>

          <div className="flex items-center justify-center rounded-lg border border-[#1E1E2B] bg-[#08080B] p-3">
            <canvas
              ref={canvasRef}
              width={dimensions.width}
              height={dimensions.height}
              className={`rounded-md bg-[#08080B] shadow-lg ${
                storyboard.format === '9:16'
                  ? 'max-h-[460px] w-auto aspect-[9/16]'
                  : 'w-full h-auto aspect-[16/9]'
              }`}
            />
          </div>

          {/* Scrubber */}
          <input
            type="range"
            min={0}
            max={totalDuration}
            step={0.1}
            value={currentTime}
            disabled={isExporting}
            onChange={(e) => {
              setIsPlaying(false);
              setCurrentTime(Number(e.target.value));
            }}
            aria-label="Position temporelle de la vidéo"
            className="w-full accent-[#7C3AED]"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isExporting}
              onClick={() => setIsPlaying((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#7C3AED] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-45"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isPlaying ? 'Pause' : 'Lire'}
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={() => {
                setIsPlaying(false);
                setCurrentTime(0);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-[#2C2C40] bg-[#171722] px-3 py-2 text-xs font-medium text-[#D6D6E6] hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Début
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={() => setVoicePreviewEnabled((v) => !v)}
              title="Lire la voix off via la synthèse vocale du navigateur pendant l'aperçu"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${
                voicePreviewEnabled
                  ? 'border-[#3B82F6] bg-[#3B82F6]/15 text-[#93C5FD]'
                  : 'border-[#2C2C40] bg-[#171722] text-[#A8A8BE] hover:text-white'
              }`}
            >
              {voicePreviewEnabled ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
              Voix off
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={() => void handleExportWebm()}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#2563EB] disabled:opacity-55"
            >
              <Download className="h-3.5 w-3.5" />
              {isExporting ? `Export ${exportProgress}%...` : 'Exporter (.webm)'}
            </button>
          </div>

          {exportError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {exportError}
            </div>
          )}

          <p className="text-[11px] text-[#8D8DA4]">
            L&apos;export génère un véritable fichier vidéo WebM ({dimensions.width}×
            {dimensions.height} px, 30 fps) via le moteur Canvas + MediaRecorder de votre
            navigateur.
          </p>
        </div>
      </div>

      {/* Scene Timeline Editor */}
      <div className="lg:col-span-7 space-y-3">
        <div className="rounded-xl border border-[#232332] bg-[#111117] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F1F2D] pb-3">
            <div>
              <h3 className="font-display text-base font-semibold text-white">
                {storyboard.title}
              </h3>
              <p className="text-xs text-[#9E9EB5]">
                Accroche : <span className="text-[#DDD6FE]">{storyboard.hook}</span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-[#262638] bg-[#0B0B10] p-1 text-xs">
              {(['9:16', '16:9'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onChangeStoryboard({ ...storyboard, format: fmt })}
                  className={`rounded px-2.5 py-1 font-mono font-semibold ${
                    storyboard.format === fmt
                      ? 'bg-[#7C3AED] text-white'
                      : 'text-[#A8A8BE] hover:text-white'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
            {storyboard.scenes.map((scene, idx) => {
              const entry = timeline[idx];
              const isActive = activeEntry.index === idx;
              return (
                <div
                  key={scene.id || idx}
                  className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                    isActive
                      ? 'border-[#7C3AED] bg-[#161227]'
                      : 'border-[#232332] bg-[#0B0B10]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentTime(entry?.start ?? 0);
                      }}
                      className="text-left text-xs font-semibold text-white hover:text-[#C4B5FD]"
                    >
                      Scène {idx + 1} : {scene.title} ({scene.shotType})
                    </button>
                    <div className="flex items-center gap-2 text-xs">
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(scene.accentColor) ? scene.accentColor : '#3B82F6'}
                        onChange={(e) => updateScene(idx, { accentColor: e.target.value })}
                        title="Couleur d'accent de la scène"
                        className="h-6 w-7 cursor-pointer rounded border border-[#2C2C40] bg-transparent"
                      />
                      <label className="text-[#8D8DA4]">Durée (s)</label>
                      <input
                        type="number"
                        min={2}
                        max={20}
                        value={scene.durationSec}
                        onChange={(e) =>
                          updateScene(idx, {
                            durationSec: Math.max(2, Math.min(20, Number(e.target.value) || 4)),
                          })
                        }
                        className="w-14 rounded border border-[#262638] bg-[#111117] px-2 py-1 font-mono tabular-nums text-white"
                      />
                    </div>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2 text-xs">
                    <div>
                      <label className="mb-1 block text-[#9E9EB5]">Texte affiché à l&apos;écran</label>
                      <input
                        type="text"
                        value={scene.onScreenText}
                        onChange={(e) => updateScene(idx, { onScreenText: e.target.value })}
                        className="w-full rounded-lg border border-[#262638] bg-[#111117] px-2.5 py-1.5 text-white focus:border-[#7C3AED] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[#9E9EB5]">Sous-titres</label>
                      <input
                        type="text"
                        value={scene.subtitle}
                        onChange={(e) => updateScene(idx, { subtitle: e.target.value })}
                        className="w-full rounded-lg border border-[#262638] bg-[#111117] px-2.5 py-1.5 text-white focus:border-[#7C3AED] focus:outline-none"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-[#9E9EB5]">Script Voix off</label>
                      <textarea
                        rows={2}
                        value={scene.voiceover}
                        onChange={(e) => updateScene(idx, { voiceover: e.target.value })}
                        className="w-full rounded-lg border border-[#262638] bg-[#111117] px-2.5 py-1.5 text-white focus:border-[#7C3AED] focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
