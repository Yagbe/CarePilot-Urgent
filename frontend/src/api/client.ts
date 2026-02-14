const API = "";

export async function postIntake(body: {
  first_name: string;
  last_name?: string;
  phone?: string;
  dob?: string;
  symptoms: string;
  duration_text?: string;
  arrival_window?: string;
}): Promise<{ pid: string; token: string; redirect: string }> {
  const r = await fetch(`${API}/api/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || "Intake failed");
  }
  return r.json();
}

export async function postKioskCheckin(code: string): Promise<{
  ok: boolean;
  checked_in: boolean;
  message: string;
  token: string;
  estimated_wait_min: number;
  display_name?: string;
}> {
  const r = await fetch(`${API}/api/kiosk-checkin/json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error("Check-in request failed");
  return r.json();
}

export async function postStaffLogin(password: string): Promise<{ ok: boolean; redirect: string }> {
  const r = await fetch(`${API}/api/staff/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    credentials: "same-origin",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.detail as string) || "Login failed");
  return data;
}

export type PublicQueueItem = {
  token: string;
  status: string;
  status_label?: string;
  estimated_wait_min?: number;
  position_in_line?: number;
  providers_active?: number;
  updated_at?: string;
  eta_explanation?: string;
};

export async function getQueue(): Promise<PublicQueueItem[]> {
  const r = await fetch(`${API}/api/queue`, { credentials: "same-origin" });
  if (!r.ok) throw new Error("Failed to load queue");
  return r.json();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type StaffQueueItem = {
  id: string;
  token: string;
  full_name?: string;
  status: string;
  status_label?: string;
  lane?: string;
  estimated_wait_min?: number;
  symptoms?: string;
  duration_text?: string;
  chief_complaint?: string;
  symptom_list?: string[];
  red_flags?: string[];
  ai_cluster?: string;
  ai_complexity?: string;
  ai_visit_duration?: number;
  suggested_resources?: string[];
  resource_tags?: string[];
  vitals_latest?: { spo2?: number; hr?: number; temp_c?: number } | null;
};

export async function getStaffQueue(): Promise<{
  items: StaffQueueItem[];
  provider_count: number;
  avg_wait_min?: number;
  lane_counts?: { Fast?: number; Standard?: number; Complex?: number };
}> {
  const r = await fetch(`${API}/api/staff-queue`, { credentials: "same-origin" });
  if (!r.ok) throw new ApiError("Unauthorized or failed", r.status);
  return r.json();
}

export async function getDemoMode(): Promise<{ demo_mode: boolean }> {
  const r = await fetch(`${API}/api/demo-mode`, { credentials: "same-origin" });
  if (!r.ok) return { demo_mode: false };
  return r.json();
}

export async function postDemoSeed(): Promise<{ ok: boolean; demo_mode: boolean }> {
  const r = await fetch(`${API}/demo/seed`, { method: "POST", credentials: "same-origin" });
  if (!r.ok) throw new ApiError("Failed to seed demo", r.status);
  return r.json();
}

export async function postDemoReset(): Promise<{ ok: boolean; demo_mode: boolean }> {
  const r = await fetch(`${API}/demo/reset`, { method: "POST", credentials: "same-origin" });
  if (!r.ok) throw new ApiError("Failed to reset", r.status);
  return r.json();
}

export type VitalsInput = {
  spo2?: number;
  hr?: number;
  temp_c?: number;
  bp_sys?: number;
  bp_dia?: number;
  device_id?: string;
};

export async function postVitalsSubmit(tokenOrPid: string, vitals: VitalsInput): Promise<{ ok: boolean; ts: string }> {
  const form = new FormData();
  form.append("token", tokenOrPid);
  form.append("device_id", vitals.device_id ?? "kiosk");
  if (vitals.spo2 != null) form.append("spo2", String(vitals.spo2));
  if (vitals.hr != null) form.append("hr", String(vitals.hr));
  if (vitals.temp_c != null) form.append("temp_c", String(vitals.temp_c));
  if (vitals.bp_sys != null) form.append("bp_sys", String(vitals.bp_sys));
  if (vitals.bp_dia != null) form.append("bp_dia", String(vitals.bp_dia));
  const r = await fetch(`${API}/api/vitals/submit`, { method: "POST", body: form, credentials: "same-origin" });
  if (!r.ok) throw new Error("Failed to submit vitals");
  return r.json();
}

export type VitalsReading = {
  spo2?: number;
  hr?: number;
  temp_c?: number;
  bp_sys?: number;
  bp_dia?: number;
  ts?: string;
  device_id?: string;
};

export async function getVitalsForPatient(pid: string): Promise<{ ok: boolean; vitals: VitalsReading | null }> {
  const r = await fetch(`${API}/api/vitals/${pid}`, { credentials: "same-origin" });
  if (!r.ok) throw new ApiError("Failed to load vitals", r.status);
  return r.json();
}

export async function postVitalsSimulate(pid: string): Promise<void> {
  const form = new FormData();
  form.append("pid", pid);
  const r = await fetch(`${API}/api/vitals/simulate`, { method: "POST", body: form, credentials: "same-origin" });
  if (!r.ok) throw new Error("Failed to simulate vitals");
}

export async function postAiChat(message: string): Promise<{ reply: string; red_flags?: string[] }> {
  const form = new FormData();
  form.append("message", message);
  form.append("role", "patient");
  const r = await fetch(`${API}/api/ai/chat`, { method: "POST", body: form, credentials: "same-origin" });
  if (!r.ok) throw new Error("AI chat failed");
  return r.json();
}

export async function getLobbyLoad(): Promise<{ level: string; queue_size: number }> {
  const r = await fetch(`${API}/api/lobby-load`, { credentials: "same-origin" });
  if (!r.ok) return { level: "Low", queue_size: 0 };
  return r.json();
}

export type AnalyticsData = {
  provider_count: number;
  current_queue: number;
  current_avg_wait: number;
  current_peak_wait?: number;
  lane_counts?: { Fast?: number; Standard?: number; Complex?: number };
  forecast: {
    labels: string[];
    arrivals: number[];
    wait_projection: number[];
    recommendation: string;
  };
};

export async function getAnalytics(providers?: number): Promise<AnalyticsData> {
  const q = providers != null ? `?providers=${providers}` : "";
  const r = await fetch(`${API}/api/analytics${q}`, { credentials: "same-origin" });
  if (!r.ok) throw new ApiError("Failed to load analytics", r.status);
  return r.json();
}

export async function setStatus(pid: string, status: string): Promise<void> {
  const form = new FormData();
  form.append("status", status);
  const r = await fetch(`${API}/api/staff/status/${pid}`, {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error("Failed to update status");
}

export async function setProviderCount(count: number): Promise<void> {
  const form = new FormData();
  form.append("count", String(count));
  const r = await fetch(`${API}/api/provider-count`, {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error("Failed to update provider count");
}
