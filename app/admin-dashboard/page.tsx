"use client";
export const dynamic = "force-dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { ExecutiveHeader } from "@/components/admin/ExecutiveHeader";
import { DecisionPanels } from "@/components/admin/DecisionPanels";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clinicDate,
  rangeFor,
  previousRangeFor,
  validRange,
  DASHBOARD_TABS,
  type RangeKey,
  type DashboardTab as Tab,
} from "@/lib/dashboard-presentation";
import type {
  AdRow,
  AgentRow,
  DecisionInsights,
  DecisionMetrics,
  SourceRow,
} from "@/lib/decision-dashboard";
export default function AdminDashboardPage() {
  const router = useRouter();
  const { profile, isAdmin, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && profile && !isAdmin) router.replace("/");
  }, [authLoading, profile, isAdmin, router]);

  const [tab, setTab] = useState<Tab>("overview");
  const [rangeKey, setRangeKey] = useState<RangeKey>("month");
  const [customStart, setCustomStart] = useState(
    () => `${clinicDate().slice(0, 7)}-01`,
  );
  const [customEnd, setCustomEnd] = useState(() => clinicDate());
  const [compare, setCompare] = useState(true);
  const { start, end } = useMemo(
    () => rangeFor(rangeKey, customStart, customEnd),
    [rangeKey, customStart, customEnd],
  );
  const rangeValid = validRange(start, end);
  const prevRange = useMemo(
    () =>
      validRange(start, end)
        ? previousRangeFor(start, end)
        : { start: "", end: "" },
    [start, end],
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [prevRefreshedAt, setPrevRefreshedAt] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<{
    pending?: boolean;
    published_at?: string;
    crm_updated_at?: string;
    billing_updated_at?: string;
  } | null>(null);

  const [insights, setInsights] = useState<DecisionInsights | null>(null);
  const [metrics, setMetrics] = useState<DecisionMetrics | null>(null);
  const [prevMetrics, setPrevMetrics] = useState<DecisionMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adRows, setAdRows] = useState<AdRow[] | null>(null);
  const [agentPerf, setAgentPerf] = useState<{ agents: AgentRow[] } | null>(
    null,
  );
  const [sourcePerf, setSourcePerf] = useState<{ sources: SourceRow[] } | null>(
    null,
  );
  useEffect(() => {
    if (!isAdmin || !rangeValid) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    // Clear the prior report immediately when starting a different date-bound request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    setMetrics(null);
    setPrevMetrics(null);
    setRefreshedAt(null);
    setPrevRefreshedAt(null);
    setReconciliation(null);
    setAdRows(null);
    setAgentPerf(null);
    setSourcePerf(null);
    Promise.resolve(
      supabase
        .rpc("get_decision_dashboard", {
          p_start_date: start,
          p_end_date: end,
          p_compare: compare,
        })
        .abortSignal(controller.signal),
    )
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) throw error;
        if (!data || data.contract_version !== 3 || !data.insights)
          throw new Error("The reporting contract is unavailable.");
        setInsights(data.insights);
        setMetrics(data.metrics);
        setPrevMetrics(data.previous);
        setRefreshedAt(data.refreshed_at);
        setPrevRefreshedAt(data.previous ? data.refreshed_at : null);
        setAgentPerf(data.agents);
        setSourcePerf(data.sources);
        setAdRows(data.ads);
        setReconciliation(data.reconciliation);
      })
      .catch((error: { message?: string }) => {
        if (!cancelled)
          setError(
            error.message ||
              "The report could not be loaded. Select Refresh report to try again.",
          );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [start, end, compare, isAdmin, profile?.id, rangeValid, reloadKey]);

  function reloadSnapshot() {
    setReloadKey((key) => key + 1);
  }
  useEffect(() => {
    const onPop = () => {
      const section = new URLSearchParams(window.location.search).get(
        "section",
      );
      setTab(
        DASHBOARD_TABS.some((item) => item.key === section)
          ? (section as Tab)
          : "overview",
      );
    };
    onPop();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function selectTab(value: Tab) {
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("section", value);
    window.history.pushState(null, "", url);
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-5 pb-12">
      <ExecutiveHeader
        rangeKey={rangeKey}
        setRangeKey={setRangeKey}
        customStart={customStart}
        customEnd={customEnd}
        setCustomStart={setCustomStart}
        setCustomEnd={setCustomEnd}
        start={start}
        end={end}
        compare={compare}
        setCompare={setCompare}
        refreshedAt={refreshedAt}
        loading={loading}
        reload={reloadSnapshot}
        tab={tab}
        setTab={selectTab}
      />
      {compare && rangeValid && (
        <p className="text-xs text-slate-600">
          Comparing with {prevRange.start} – {prevRange.end} (equal-length prior
          period).
          {prevRefreshedAt && (
            <>
              {" "}
              Comparison read:{" "}
              {new Date(prevRefreshedAt).toLocaleString("en-GB", {
                timeZone: "Asia/Dhaka",
              })}{" "}
              BDT.
            </>
          )}
          {!loading &&
            metrics &&
            !prevMetrics &&
            " No comparison is available; changes are not estimated."}
        </p>
      )}
      {reconciliation && (
        <div
          className={`rounded-lg border p-3 text-xs leading-relaxed ${reconciliation.pending ? "border-amber-200 bg-amber-50 text-amber-900" : "bg-white text-slate-600"}`}
          role="status"
        >
          All sections and comparison periods share one database read. Contact
          dates use Bangladesh time.
          {reconciliation.published_at && (
            <>
              {" "}
              Evidence publication:{" "}
              {new Date(reconciliation.published_at).toLocaleString("en-GB", {
                timeZone: "Asia/Dhaka",
              })}{" "}
              BDT.
            </>
          )}
          {reconciliation.pending && (
            <strong className="block mt-1">
              Reconciliation is pending. CRM activity is current; invoice and
              acquisition evidence may still change after publication.
            </strong>
          )}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {error}
        </div>
      )}
      {!rangeValid || error ? null : loading ? (
        <div role="status" aria-label="Loading dashboard" className="space-y-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : metrics && insights ? (
        <>
          <DecisionPanels
            tab={tab}
            metrics={metrics}
            previous={prevMetrics}
            compare={compare}
            insights={insights!}
            agents={agentPerf?.agents ?? []}
            sources={sourcePerf?.sources ?? []}
            ads={adRows ?? []}
            onSelect={selectTab}
          />
        </>
      ) : null}
    </div>
  );
}
