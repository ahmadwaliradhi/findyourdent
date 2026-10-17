import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

/** Matches the 60-second cap in spec 01; the server also refuses anything bigger. */
export const MAX_RECORDING_SECONDS = 60;

/** Types the agent contract accepts, in order of preference; Safari only records audio/mp4. */
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

type RecorderState = "idle" | "recording" | "denied" | "failed";

function recordingType(): string | undefined {
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function MicIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Large record button for a voice note of up to 60 seconds (spec 01, T07). The
 * recording stays in memory until it is handed to onRecorded, which sends it; it is
 * never stored. Hidden where the browser cannot record, so the typed complaint
 * stays the way in.
 */
export function VoiceRecorder({ disabled, onRecorded }: { disabled: boolean; onRecorded: (audio: Blob) => void }) {
  const { t } = useTranslation();
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    setSupported(typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
    // Leaving the page mid-recording releases the microphone and sends nothing.
    return () => {
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (state === "recording" && elapsed >= MAX_RECORDING_SECONDS) recorder.current?.stop();
  }, [state, elapsed]);

  if (!supported) return null;

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setState(error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "failed");
      return;
    }
    try {
      const type = recordingType();
      const media = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      media.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        recorder.current = null;
        if (cancelled.current) {
          setState("idle");
          return;
        }
        const audio = new Blob(chunks, { type: media.mimeType || type || "audio/webm" });
        setState(audio.size > 0 ? "idle" : "failed");
        if (audio.size > 0) onRecorded(audio);
      };
      cancelled.current = false;
      recorder.current = media;
      media.start();
      setElapsed(0);
      setState("recording");
    } catch {
      for (const track of stream.getTracks()) track.stop();
      setState("failed");
    }
  };

  const stop = (cancel: boolean) => {
    cancelled.current = cancel;
    recorder.current?.stop();
  };

  const recording = state === "recording";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{t("home.voiceOr")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          variant={recording ? "destructive" : "secondary"}
          className="h-14 w-full gap-3 px-6 text-lg sm:w-auto"
          aria-describedby="voiceStatus"
          disabled={disabled && !recording}
          onClick={() => (recording ? stop(false) : void start())}
        >
          <MicIcon />
          {recording ? `${t("home.voiceStop")} (${clock(elapsed)})` : t("home.voiceRecord")}
        </Button>
        {recording && (
          <Button type="button" variant="outline" size="lg" onClick={() => stop(true)}>
            {t("home.voiceCancel")}
          </Button>
        )}
      </div>
      <p
        id="voiceStatus"
        aria-live="polite"
        className={
          state === "denied" || state === "failed" ? "text-sm text-destructive" : "text-xs text-muted-foreground"
        }
      >
        {state === "recording" && t("home.voiceRecording")}
        {state === "idle" && t("home.voiceHint")}
        {state === "denied" && t("home.voiceDenied")}
        {state === "failed" && t("home.voiceFailed")}
      </p>
    </div>
  );
}
