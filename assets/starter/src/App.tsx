import { useCallback, useEffect, useRef, useState } from 'react';
import TowerScene, { type ViewId } from './TowerScene';
import { FLOORS, storeyAt } from './structure/tower';
import { DEFAULT_TIME, TIMES, presetOf, type TimeId } from './structure/daylight';

const DURATION = 16;
/** Display-only labels. The real schedule lives in `structure/tower.ts` — when
 *  you retime a phase there, retime its label here too. */
const STAGES: [string, number][] = [
  ['场地与基座', .08],
  ['裙房结构', .18],
  ['裙房幕墙与大堂', .27],
  ['标准层逐层生长', .74],
  ['屋顶结构', .845],
  ['塔冠与桅杆', .91],
  ['景观与水池', .945],
  ['灯光依次点亮', 1],
];
const VIEWS: [ViewId, string][] = [
  ['overview', '全景'], ['facade', '幕墙细部'], ['crown', '塔冠'], ['plaza', '裙房广场'],
];

export default function App() {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<ViewId>('overview');
  const [time, setTime] = useState<TimeId>(DEFAULT_TIME);
  const started = useRef(0);
  const onReady = useCallback(() => { started.current = performance.now(); setReady(true); }, []);

  useEffect(() => {
    if (!ready || !playing) return;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(1, (now - started.current) / (DURATION * 1000));
      setProgress(next);
      if (next === 1) setPlaying(false); else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, playing]);

  const seek = useCallback((p: number) => {
    const next = Math.max(0, Math.min(1, p));
    started.current = performance.now() - next * DURATION * 1000;
    setProgress(next);
  }, []);
  const replay = () => { setView('overview'); seek(0); setPlaying(true); };
  const toggle = () => { seek(progress === 1 ? 0 : progress); setPlaying(progress === 1 || !playing); };
  const detail = (v: ViewId) => { setView(v); if (v !== 'overview') { seek(1); setPlaying(false); } };

  const stage = STAGES.find(([, end]) => progress < end)?.[0] ?? '落成';
  const storeys = storeyAt(progress);
  const climbing = progress >= .27 && progress < .74;
  const hour = presetOf(time);

  return <main className="poster">
    <div className="tower-stage">
      <TowerScene progress={progress} view={view} time={time} onReady={onReady}/>

      {/* Floats over the scene. Doubles as the stage read-out — the old floating
          stage chip sat exactly where this card now lives. */}
      <aside className="brief">
        <p className="micro">GLASS · CONCRETE · LIGHT<br/>藏品 〇一 / 镜面塔楼</p>
        <h2>一层楼板，<br/>一圈幕墙。</h2>
        <p className="accent">{hour.caption}</p>
        <blockquote>核心筒爬升，楼板逐层落位。<br/>竖梃与玻璃自外而内就位。</blockquote>
        <ul className="spec">
          <li><span>层数</span><b>{FLOORS} 层 / 3.6 m</b></li>
          <li><span>幕墙</span><b>镜面镀膜玻璃</b></li>
          <li><span>结构</span><b>清水混凝土 + 铝型材</b></li>
        </ul>
        <div className="index">
          <b>01</b><i/><span>{stage}</span>
          <em>{climbing ? `${storeys}/${FLOORS} 层` : `${Math.round(progress * 100)}%`}</em>
        </div>
      </aside>

      <div className="controls">
        <div className="control-group">
          <span className="group-label">时间</span>
          <div className="group-row" role="group" aria-label="一天四时">
            {TIMES.map((t) => (
              <button key={t.id} disabled={!ready} aria-pressed={time === t.id}
                onClick={() => setTime(t.id)}>{t.label}</button>
            ))}
          </div>
        </div>
        <div className="control-group">
          <span className="group-label">视角</span>
          <div className="group-row" role="group" aria-label="观赏视角">
            {VIEWS.map(([id, label]) => (
              <button key={id} disabled={!ready} aria-pressed={view === id}
                onClick={() => detail(id)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="control-group">
          <div className="group-row">
            <button disabled={!ready} onClick={replay}>重新建造 ↺</button>
          </div>
        </div>
      </div>

      <div className="orbit-hint">拖动环视 · 滚轮近观</div>

      <div className="transport">
        <button className="play" disabled={!ready} onClick={toggle} aria-label={playing ? '暂停' : '播放'}>{playing ? 'Ⅱ' : '▶'}</button>
        <div className="timeline">
          <span style={{ width: `${progress * 100}%` }}/>
          <input aria-label="施工进度" disabled={!ready} type="range" min="0" max="1000"
            value={Math.round(progress * 1000)} onChange={(e) => seek(Number(e.target.value) / 1000)}/>
        </div>
        <time>{(progress * DURATION).toFixed(1)} / {DURATION} S</time>
      </div>

      {!ready && <div className="scene-loading">起吊 · 建造中</div>}
    </div>
  </main>;
}
