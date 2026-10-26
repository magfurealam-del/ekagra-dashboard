"use client";
import {
  ChartPanel,
  Note,
  RankedBars,
} from "@/components/admin/DecisionCharts";
export function SchedulingInsights({
  rows,
}: {
  rows: {
    appointment_date: string;
    appointment_type: string | null;
    doctor_service: string | null;
    appointment_status: string | null;
  }[];
}) {
  const active = rows.filter(
    (r) =>
      r.appointment_status !== "Cancelled" &&
      r.appointment_status !== "Rescheduled",
  );
  const services: Record<string, number> = {},
    doctors: Record<string, number> = {};
  for (const r of active) {
    const s = r.appointment_type || "Unspecified";
    services[s] = (services[s] ?? 0) + 1;
    const d = r.doctor_service || "Unassigned";
    doctors[d] = (doctors[d] ?? 0) + 1;
  }
  return (
    <details className="rounded-xl border bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium text-teal-800">
        Scheduling insights · {active.length} appointments in this month and
        doctor filter
      </summary>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartPanel
          title="Scheduled demand by service"
          subtitle="Cancelled and rescheduled records excluded"
        >
          <RankedBars
            rows={Object.entries(services)
              .map(([label, count]) => ({ label, count }))
              .sort((a, b) => b.count - a.count)}
          />
        </ChartPanel>
        <ChartPanel
          title="Appointment mix by doctor"
          subtitle="Scheduled appointment counts, not utilization or physician performance"
        >
          <RankedBars
            rows={Object.entries(doctors)
              .map(([label, count]) => ({ label, count }))
              .sort((a, b) => b.count - a.count)}
          />
        </ChartPanel>
      </div>
      <Note>
        The calendar shows demand by day. Offered slots and appointment
        durations are required before calculating capacity utilization.
      </Note>
    </details>
  );
}
export function AvailabilityTimeline({
  rows,
}: {
  rows: { name: string; start: string; end: string; available: boolean }[];
}) {
  const minutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  return (
    <details className="rounded-xl border bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium text-teal-800">
        View the day’s availability timeline
      </summary>
      <div className="mt-5 space-y-4">
        <div className="flex justify-between text-xs text-slate-500">
          <span>00:00</span>
          <span>12:00</span>
          <span>24:00</span>
        </div>
        {rows.map((r) => {
          const start = minutes(r.start),
            end = minutes(r.end);
          return (
            <div key={r.name}>
              <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
                <span>{r.name}</span>
                <span className="text-xs tabular-nums text-slate-600">
                  {r.available
                    ? `${r.start.slice(0, 5)}–${r.end.slice(0, 5)}${end < start ? " (overnight)" : ""}`
                    : "Unavailable"}
                </span>
              </div>
              <div
                className="relative h-4 overflow-hidden rounded bg-slate-100"
                aria-hidden="true"
              >
                {r.available &&
                  Number.isFinite(start) &&
                  Number.isFinite(end) && (
                    <>
                      <span
                        className="absolute h-full rounded bg-teal-700"
                        style={{
                          left: `${(start / 1440) * 100}%`,
                          width: `${(((end >= start ? end : 1440) - start) / 1440) * 100}%`,
                        }}
                      />
                      {end < start && (
                        <span
                          className="absolute left-0 h-full rounded bg-teal-700"
                          style={{ width: `${(end / 1440) * 100}%` }}
                        />
                      )}
                    </>
                  )}
              </div>
            </div>
          );
        })}
      </div>
      <Note>
        Hours include daily overrides. They do not establish the number of
        available appointment slots.
      </Note>
    </details>
  );
}
