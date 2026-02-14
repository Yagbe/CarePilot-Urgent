import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { StaffTopbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAnalytics, getLobbyLoad, getDemoMode, ApiError, type AnalyticsData } from "@/api/client";

function drawLineChart(
  canvas: HTMLCanvasElement | null,
  labels: string[],
  values: number[],
  color: string
) {
  if (!canvas || !labels.length || !values.length) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "hsl(var(--card))";
  ctx.fillRect(0, 0, w, h);
  const pad = 30;
  const max = Math.max(1, ...values);
  const stepX = (w - pad * 2) / Math.max(1, values.length - 1);

  ctx.strokeStyle = "hsl(var(--border))";
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (v / max) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "hsl(var(--foreground))";
  ctx.font = "11px sans-serif";
  values.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (v / max) * (h - pad * 2);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (labels[i]) ctx.fillText(labels[i], x - 14, h - 10);
  });
}

export function Analytics() {
  const navigate = useNavigate();
  const [demoMode, setDemoMode] = useState(false);
  const [providers, setProviders] = useState(1);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [lobby, setLobby] = useState({ level: "Low", queue_size: 0 });
  const arrivalsRef = useRef<HTMLCanvasElement>(null);
  const waitRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    getDemoMode().then((d) => setDemoMode(d.demo_mode)).catch(() => {});
  }, []);

  useEffect(() => {
    const load = () => {
      getAnalytics(providers)
        .then(setData)
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) {
            navigate("/staff/login", { replace: true });
            return;
          }
          setData(null);
        });
      getLobbyLoad().then(setLobby).catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [providers, navigate]);

  useEffect(() => {
    if (!data?.forecast) return;
    drawLineChart(arrivalsRef.current, data.forecast.labels, data.forecast.arrivals, "#0ea5e9");
    drawLineChart(waitRef.current, data.forecast.labels, data.forecast.wait_projection, "#f59e0b");
  }, [data]);

  const lc = data?.lane_counts || {};
  const laneMix = `Fast ${lc.Fast ?? 0} • Standard ${lc.Standard ?? 0} • Complex ${lc.Complex ?? 0}`;
  const peak = data
    ? Math.max(...(data.forecast?.wait_projection ?? []), data.current_peak_wait ?? 0)
    : 0;

  return (
    <>
      <StaffTopbar demoMode={demoMode} />
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold">Operational Analytics</h1>
        <p className="text-muted-foreground text-sm">Forecasting and what-if staffing impact for the next 2 hours.</p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Providers available (what-if)</CardTitle>
            <CardContent className="pt-2">
              <input
                type="range"
                min={1}
                max={3}
                value={providers}
                onChange={(e) => setProviders(Number(e.target.value))}
                className="w-full"
              />
              <p className="text-muted-foreground text-sm">Provider count: <strong>{providers}</strong></p>
            </CardContent>
          </CardHeader>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Current Queue</CardTitle>
              <span className="text-2xl font-bold">{data?.current_queue ?? 0}</span>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Current Avg Wait</CardTitle>
              <span className="text-2xl font-bold">{data?.current_avg_wait ?? 0} min</span>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Predicted Peak Wait</CardTitle>
              <span className="text-2xl font-bold">{peak} min</span>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-sm">Lobby Occupancy Score</CardTitle>
            <span className="text-2xl font-bold">{lobby.level} ({lobby.queue_size})</span>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-sm">Lane Routing Mix</CardTitle>
            <span className="text-lg font-semibold">{laneMix}</span>
          </CardHeader>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Predicted Arrivals (next 2h)</CardTitle>
            </CardHeader>
            <CardContent>
              <canvas ref={arrivalsRef} width={520} height={220} className="w-full max-w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Predicted Wait Projection</CardTitle>
            </CardHeader>
            <CardContent>
              <canvas ref={waitRef} width={520} height={220} className="w-full max-w-full" />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommended Action</CardTitle>
            <CardContent className="pt-0">
              <p className="text-muted-foreground">{data?.forecast?.recommendation ?? "Loading…"}</p>
            </CardContent>
          </CardHeader>
        </Card>
      </main>
    </>
  );
}
