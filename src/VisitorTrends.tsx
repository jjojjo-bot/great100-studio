import { useEffect, useState } from "react";
import { BarChart3, LoaderCircle, RefreshCw } from "lucide-react";
import { getCloudSession } from "./cloud-session";
import "./visitor-trends.css";

export interface VisitorPoint { period_start: string; period_end: string; visitors: number }
export interface VisitorTrendsData {
  today: string;
  today_visitors: number;
  week_visitors: number;
  daily: VisitorPoint[];
  weekly: VisitorPoint[];
}
type Period = "daily" | "weekly";
const count = (value: number) => value.toLocaleString("ko-KR");
const date = (value: string) => `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))}`;
const range = (point: VisitorPoint) => point.period_start === point.period_end ? date(point.period_start) : `${date(point.period_start)}–${date(point.period_end)}`;

export function VisitorTrends() {
  const context = getCloudSession();
  const [allowed, setAllowed] = useState(false);
  const [data, setData] = useState<VisitorTrendsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState<Period>("daily");
  const [selected, setSelected] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!context) return;
    let active = true;
    let pending = false;
    let authorized = false;
    const requests = new Set<AbortController>();
    const call = async (name: string) => {
      const controller = new AbortController(); requests.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try { return await context.client.rpc(name).abortSignal(controller.signal); }
      finally { window.clearTimeout(timeout); requests.delete(controller); }
    };
    const refresh = async () => {
      if (!active || !authorized || pending || document.visibilityState === "hidden") return;
      pending = true; setLoading(true);
      try {
        const result = await call("great100_visitor_trends");
        if (!active) return;
        if (result.error) {
          if (result.error.code === "42501") { authorized = false; setAllowed(false); setData(null); }
          else setError(true);
          return;
        }
        setData(result.data as VisitorTrendsData); setError(false);
      } catch { if (active) setError(true); }
      finally { pending = false; if (active) setLoading(false); }
    };
    void (async () => {
      try {
        const result = await call("great100_is_analytics_admin");
        if (!active || result.error || result.data !== true) return;
        authorized = true; setAllowed(true); await refresh();
      } catch { /* No administrator card is exposed before access is confirmed. */ }
    })();
    const update = () => { void refresh(); };
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    window.addEventListener("great100:visit-recorded", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      active = false; requests.forEach(controller => controller.abort()); window.clearInterval(timer);
      window.removeEventListener("focus", update); window.removeEventListener("online", update);
      window.removeEventListener("great100:visit-recorded", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [context?.client, context?.userId, reload]);

  if (!allowed) return null;
  const points = data?.[period] || [];
  const current = points[selected ?? points.length - 1];
  const maximum = Math.max(2, ...points.map(point => point.visitors));
  const scale = maximum <= 10 ? Math.ceil(maximum / 2) * 2 : Math.ceil(maximum / 10) * 10;
  return <aside className="visitor-trends" aria-label="방문 추이">
    <div className="visitor-trends-heading"><h3><BarChart3 size={17} /> 방문 추이</h3><span>관리자</span><button type="button" aria-label="방문 통계 새로고침" title="방문 통계 새로고침" disabled={loading} onClick={() => setReload(value => value + 1)}>{loading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</button></div>
    <div className="visitor-trends-metrics"><div><span>오늘</span><strong>{data ? count(data.today_visitors) : "—"}<small>명</small></strong></div><div><span>이번 주</span><strong>{data ? count(data.week_visitors) : "—"}<small>명</small></strong></div></div>
    <div className="visitor-trends-controls"><span>{period === "daily" ? "최근 14일" : "최근 8주"}</span><div role="group" aria-label="방문 통계 단위">{(["daily", "weekly"] as const).map(value => <button type="button" key={value} aria-pressed={period === value} onClick={() => { setPeriod(value); setSelected(null); }}>{value === "daily" ? "일별" : "주별"}</button>)}</div></div>
    {error ? <div className="visitor-trends-message" role="status">통계를 불러오지 못했어요.<button type="button" onClick={() => setReload(value => value + 1)}>다시 시도</button></div>
      : !data ? <div className="visitor-trends-message" role="status">방문 기록을 불러오고 있어요.</div>
        : <>
          <div className="visitor-trends-detail" aria-live="polite">{current && <><span>{range(current)}{period === "weekly" && selected === null ? " · 이번 주" : ""}</span><strong>{count(current.visitors)}명</strong></>}</div>
          <div className="visitor-trends-plot"><div className="visitor-trends-axis" aria-hidden="true"><span>{count(scale)}</span><span>{count(scale / 2)}</span><span>0</span></div><div className="visitor-trends-bars" role="group" aria-label={period === "daily" ? "일별 방문자 수" : "주별 방문자 수"} onMouseLeave={() => setSelected(null)}>{points.map((point, index) => <button type="button" key={point.period_start} aria-label={`${range(point)} 방문자 ${count(point.visitors)}명`} title={`${range(point)} · ${count(point.visitors)}명`} className={`${index === (selected ?? points.length - 1) ? "active" : ""}${point.visitors === 0 ? " empty" : ""}`} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onBlur={() => setSelected(null)} onClick={() => setSelected(index)}><span style={{ height: point.visitors ? `${Math.max(4, point.visitors / scale * 100)}%` : "2px" }} /></button>)}</div></div>
          <div className="visitor-trends-dates" aria-hidden="true"><span>{points[0] && date(points[0].period_start)}</span><span>{points.at(-1) && date(points.at(-1)!.period_end)}</span></div>
          {points.every(point => point.visitors === 0) && <p className="visitor-trends-empty">아직 기록된 방문이 없어요.</p>}
        </>}
    <p className="visitor-trends-note">로그인 사용자 · 한국 시간{period === "weekly" ? " · 월요일 시작" : ""}</p>
  </aside>;
}
