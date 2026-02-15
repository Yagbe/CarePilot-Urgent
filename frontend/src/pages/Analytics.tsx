import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StaffTopbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAnalytics, getLobbyLoad, getDemoMode, ApiError, type AnalyticsData } from "@/api/client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const CHART_COLORS = {
  arrivals: "hsl(var(--chart-1))",
  wait: "hsl(var(--chart-2))",
  grid: "hsl(var(--border))",
  axis: "hsl(var(--muted-foreground))",
  tooltipBg: "hsl(var(--card))",
  tooltipBorder: "hsl(var(--border))",
  chartBg: "hsl(var(--muted) / 0.2)",
};

function buildChartData(forecast: AnalyticsData["forecast"] | undefined) {
  if (!forecast?.labels?.length) return [];
  return forecast.labels.map((label, i) => ({
    name: label,
    arrivals: forecast.arrivals[i] ?? 0,
    wait: forecast.wait_projection[i] ?? 0,
  }));
}

export function Analytics() {
  const navigate = useNavigate();
  const [demoMode, setDemoMode] = useState(false);
  const [providers, setProviders] = useState(1);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [lobby, setLobby] = useState({ level: "Low", queue_size: 0 });
  const chartData = buildChartData(data?.forecast);

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

  const lc = data?.lane_counts || {};
  const laneMix = `Fast ${lc.Fast ?? 0} • Standard ${lc.Standard ?? 0} • Complex ${lc.Complex ?? 0}`;
  const peak = data
    ? Math.max(...(data.forecast?.wait_projection ?? []), data.current_peak_wait ?? 0)
    : 0;

  return (
    <>
      <StaffTopbar demoMode={demoMode} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold">Operational Analytics</h1>
        <p className="text-muted-foreground text-sm">
          Forecasting and what-if staffing impact for the next 2 hours.
        </p>

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
                className="w-full accent-primary"
              />
              <p className="text-muted-foreground text-sm">
                Provider count: <strong>{providers}</strong>
              </p>
            </CardContent>
          </CardHeader>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Current Queue</CardTitle>
              <span className="text-3xl font-bold tabular-nums">{data?.current_queue ?? 0}</span>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Current Avg Wait</CardTitle>
              <span className="text-3xl font-bold tabular-nums">{data?.current_avg_wait ?? 0} min</span>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Predicted Peak Wait</CardTitle>
              <span className="text-3xl font-bold tabular-nums">{peak} min</span>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Lobby</CardTitle>
              <span className="text-2xl font-bold">{lobby.level}</span>
              <span className="text-muted-foreground text-sm"> ({lobby.queue_size})</span>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-sm">Lane mix</CardTitle>
            <p className="text-lg font-semibold">{laneMix}</p>
          </CardHeader>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Predicted arrivals (next 2h)</CardTitle>
              <CardContent className="pt-2">
                <div className="h-[280px] w-full rounded-lg bg-muted/20 p-3">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                        <defs>
                          <linearGradient id="arrivalsGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_COLORS.arrivals} stopOpacity={0.4} />
                            <stop offset="100%" stopColor={CHART_COLORS.arrivals} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
                          axisLine={{ stroke: CHART_COLORS.grid }}
                          tickLine={{ stroke: CHART_COLORS.grid }}
                        />
                        <YAxis
                          tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
                          axisLine={false}
                          tickLine={{ stroke: CHART_COLORS.grid }}
                          tickFormatter={(v) => String(v)}
                          width={28}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: CHART_COLORS.tooltipBg,
                            border: `1px solid ${CHART_COLORS.tooltipBorder}`,
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                          formatter={(value: number | undefined) => [value ?? 0, "Arrivals"]}
                          labelFormatter={(label) => `Period: ${label}`}
                        />
                        <Area
                          type="monotone"
                          dataKey="arrivals"
                          stroke={CHART_COLORS.arrivals}
                          strokeWidth={2}
                          fill="url(#arrivalsGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                      No forecast data yet
                    </div>
                  )}
                </div>
              </CardContent>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Predicted wait (min)</CardTitle>
              <CardContent className="pt-2">
                <div className="h-[280px] w-full rounded-lg bg-muted/20 p-3">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                        <defs>
                          <linearGradient id="waitGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_COLORS.wait} stopOpacity={0.4} />
                            <stop offset="100%" stopColor={CHART_COLORS.wait} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
                          axisLine={{ stroke: CHART_COLORS.grid }}
                          tickLine={{ stroke: CHART_COLORS.grid }}
                        />
                        <YAxis
                          tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
                          axisLine={false}
                          tickLine={{ stroke: CHART_COLORS.grid }}
                          tickFormatter={(v) => `${v}`}
                          width={32}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: CHART_COLORS.tooltipBg,
                            border: `1px solid ${CHART_COLORS.tooltipBorder}`,
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                          formatter={(value: number | undefined) => [`${value ?? 0} min`, "Wait"]}
                          labelFormatter={(label) => `Period: ${label}`}
                        />
                        <Area
                          type="monotone"
                          dataKey="wait"
                          stroke={CHART_COLORS.wait}
                          strokeWidth={2}
                          fill="url(#waitGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                      No forecast data yet
                    </div>
                  )}
                </div>
              </CardContent>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Arrivals vs wait (combined)</CardTitle>
            <CardContent className="pt-2">
              <div className="h-[300px] w-full rounded-lg bg-muted/20 p-3">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 44, left: 8, bottom: 24 }}>
                      <defs>
                        <linearGradient id="arrivalsCombo" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART_COLORS.arrivals} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={CHART_COLORS.arrivals} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="waitCombo" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART_COLORS.wait} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={CHART_COLORS.wait} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
                        axisLine={{ stroke: CHART_COLORS.grid }}
                        tickLine={{ stroke: CHART_COLORS.grid }}
                      />
                      <YAxis
                        yAxisId="arrivals"
                        tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
                        axisLine={false}
                        tickLine={{ stroke: CHART_COLORS.grid }}
                        width={28}
                        label={{ value: "Arrivals", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: CHART_COLORS.axis } }}
                      />
                      <YAxis
                        yAxisId="wait"
                        orientation="right"
                        tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
                        axisLine={false}
                        tickLine={{ stroke: CHART_COLORS.grid }}
                        tickFormatter={(v) => `${v}`}
                        width={32}
                        label={{ value: "Wait (min)", angle: 90, position: "insideRight", style: { fontSize: 11, fill: CHART_COLORS.axis } }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: CHART_COLORS.tooltipBg,
                          border: `1px solid ${CHART_COLORS.tooltipBorder}`,
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(value: number | undefined, name?: string) => [
                          (name ?? "") === "arrivals" ? (value ?? 0) : `${value ?? 0} min`,
                          (name ?? "") === "arrivals" ? "Arrivals" : "Wait",
                        ]}
                        labelFormatter={(label) => `Period: ${label}`}
                      />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                      <Area
                        yAxisId="arrivals"
                        type="monotone"
                        dataKey="arrivals"
                        name="Arrivals"
                        stroke={CHART_COLORS.arrivals}
                        strokeWidth={2}
                        fill="url(#arrivalsCombo)"
                      />
                      <Area
                        yAxisId="wait"
                        type="monotone"
                        dataKey="wait"
                        name="Wait (min)"
                        stroke={CHART_COLORS.wait}
                        strokeWidth={2}
                        fill="url(#waitCombo)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                    No forecast data yet
                  </div>
                )}
              </div>
            </CardContent>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommended action</CardTitle>
            <CardContent className="pt-0">
              <p className="text-muted-foreground">
                {data?.forecast?.recommendation ?? "Loading…"}
              </p>
            </CardContent>
          </CardHeader>
        </Card>
      </main>
    </>
  );
}
