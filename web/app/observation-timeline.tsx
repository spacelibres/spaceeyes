"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  TIME_RATES,
  adjacentRate,
  formatRate,
  rateToSliderIndex,
} from "../lib/time-controls";
import {
  RateDispatcher,
  observationClock,
  timeKnob,
} from "../lib/observation-ui";

export default function ObservationTimeline(p: {
  active: boolean;
  busy: boolean;
  playing: boolean;
  rate: number;
  live?: boolean;
  utc: string;
  dateOpen: boolean;
  onDate: () => void;
  onNow: () => void;
  onPlay: () => void;
  onRate: (rate: string) => void;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState(rateToSliderIndex(p.rate));
  const [editing, setEditing] = useState(false);
  const callback = useRef(p.onRate);
  callback.current = p.onRate;
  const dispatcher = useRef<RateDispatcher | null>(null);
  if (!dispatcher.current)
    dispatcher.current = new RateDispatcher((rate) =>
      callback.current(String(rate)),
    );
  useEffect(() => {
    if (!editing) setDraft(rateToSliderIndex(p.rate));
  }, [p.rate, editing]);
  useEffect(() => () => dispatcher.current?.cancel(), []);
  useEffect(() => {
    if (!p.active || p.busy) {
      dispatcher.current?.cancel();
      setEditing(false);
    }
  }, [p.active, p.busy]);
  useEffect(() => {
    const stop = () => {
      dispatcher.current?.cancel();
      setEditing(false);
    };
    window.addEventListener("blur", stop);
    return () => window.removeEventListener("blur", stop);
  }, []);
  const finish = () => {
    dispatcher.current?.flush();
    setEditing(false);
  };
  const setRate = (rate: number) => {
    dispatcher.current?.cancel();
    setEditing(false);
    p.onRate(String(rate));
  };
  const knob = timeKnob(draft);
  const clock = observationClock(p.utc);
  const gradient = useId().replaceAll(":", "");
  const style = {
    "--knob-x": `${knob.x * 100}%`,
    "--knob-y": `${knob.y}px`,
    "--thumb-offset": `${knob.y - 25}px`,
  } as CSSProperties;
  const disabled = !p.active || p.busy;
  return (
    <section
      className={`nasa-timeline ${p.live ? "is-live" : ""} ${p.playing ? "" : "is-paused"}`}
      aria-label="统一时间控制"
      hidden={!p.active}
    >
      <button
        className="timeline-now"
        onClick={p.onNow}
        disabled={!p.active}
        aria-label="当前时间"
        title="跳转到当前时间"
      >
        <span aria-hidden="true">●</span> {p.live ? "LIVE" : "当前时间"}
      </button>
      <div className="timeline-instrument">
        <div className="timeline-readout">
          <button
            className="timeline-date"
            data-panel="time"
            aria-label="日期与跳转"
            aria-expanded={p.dateOpen}
            aria-controls="time-panel"
            onClick={p.onDate}
          >
            <time dateTime={p.utc || undefined}>{clock.date}</time>
          </button>
          <output className="timeline-rate" aria-live="off">
            {p.playing
              ? formatRate(editing ? TIME_RATES[draft] : p.rate).toUpperCase()
              : "已暂停"}
          </output>
          <button
            className="timeline-clock"
            aria-label="编辑UTC时间"
            aria-expanded={p.dateOpen}
            aria-controls="time-panel"
            onClick={p.onDate}
          >
            <time dateTime={p.utc || undefined}>{clock.time}</time>
            <small>UTC</small>
          </button>
        </div>
        <div className="timeline-playback">
          <button
            aria-label="降低播放倍率"
            title="降低播放倍率"
            disabled={disabled || p.rate <= TIME_RATES[0]}
            onClick={() => setRate(adjacentRate(p.rate, -1))}
          >
            ◀◀
          </button>
          <button
            aria-label={p.playing ? "暂停" : "播放"}
            title={p.playing ? "暂停" : "播放"}
            disabled={!p.active || (p.busy && !p.playing)}
            onClick={() => {
              dispatcher.current?.cancel();
              setEditing(false);
              p.onPlay();
            }}
          >
            {p.playing ? "Ⅱ" : "▶"}
          </button>
          <button
            aria-label="提高播放倍率"
            title="提高播放倍率"
            disabled={disabled || p.rate >= TIME_RATES[100]}
            onClick={() => setRate(adjacentRate(p.rate, 1))}
          >
            ▶▶
          </button>
        </div>
        <div className="timeline-curve" style={style}>
          <svg
            viewBox="0 0 600 50"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0" />
                <stop offset="1" stopColor="currentColor" stopOpacity=".65" />
              </linearGradient>
            </defs>
            <path
              d="M0,0 C60,50 540,50 600,0"
              fill="none"
              stroke={`url(#${gradient})`}
              strokeWidth="2"
            />
          </svg>
          <input
            className="timeline-rate-input"
            aria-label="播放速率"
            aria-valuetext={formatRate(editing ? TIME_RATES[draft] : p.rate)}
            type="range"
            min="0"
            max="100"
            step="1"
            value={draft}
            disabled={disabled}
            onPointerDown={() => setEditing(true)}
            onKeyDown={() => setEditing(true)}
            onChange={(event) => {
              const index = Number(event.target.value);
              setDraft(index);
              dispatcher.current?.request(TIME_RATES[index]);
            }}
            onPointerUp={finish}
            onKeyUp={finish}
            onBlur={finish}
            onPointerCancel={() => {
              dispatcher.current?.cancel();
              setEditing(false);
              setDraft(rateToSliderIndex(p.rate));
            }}
          />
          <span className="timeline-knob" aria-hidden="true" />
          <button
            className="timeline-realtime"
            aria-label="恢复实时倍率"
            title="恢复1倍速（不改变日期）"
            hidden={draft >= 47 && draft <= 53}
            disabled={disabled}
            onClick={() => setRate(1)}
          />
        </div>
      </div>
      {p.children}
    </section>
  );
}
