"use client";
import { useState } from "react";
import { ExecutiveOverview } from "./ExecutiveOverview";
import {
  ChartPanel,
  DataTable,
  DelayPlot,
  Empty,
  Filter,
  Note,
  PageIntro,
  RankedBars,
  RateDots,
  StackedBars,
  Stat,
  TrendChart,
  WorkflowLink,
} from "./DecisionCharts";
import {
  CALL_SERIES,
  OUTCOME_SERIES,
  humanize,
  isHumanAgent,
  rateText,
  topRows,
  type AdRow,
  type AgentRow,
  type Cohort,
  type DecisionInsights,
  type DecisionMetrics,
  type SourceRow,
} from "@/lib/decision-dashboard";
import {
  formatMoney,
  formatNumber,
  type DashboardTab,
} from "@/lib/dashboard-presentation";

type Props = {
  tab: DashboardTab;
  metrics: DecisionMetrics;
  previous: DecisionMetrics | null;
  compare: boolean;
  insights: DecisionInsights;
  agents: AgentRow[];
  sources: SourceRow[];
  ads: AdRow[];
  onSelect: (tab: DashboardTab) => void;
};
const grid = "grid gap-5 lg:grid-cols-2";
const statGrid = "grid grid-cols-2 gap-3 lg:grid-cols-4";
const cohortOptions = [7, 14, 30].map((n) => ({
  value: String(n),
  label: `${n}-day window`,
}));
function CohortControl({
  horizon,
  setHorizon,
}: {
  horizon: number;
  setHorizon: (n: number) => void;
}) {
  return (
    <Filter
      label="Follow-up window"
      value={String(horizon)}
      onChange={(n) => setHorizon(Number(n))}
      options={cohortOptions}
    />
  );
}
function CohortNote({ cohort }: { cohort: Cohort }) {
  return (
    <Note>
      Contacts dated in the selected period, with {cohort.horizon} days to reach
      a scheduled visit plus the evidence grace interval.{" "}
      {formatNumber(cohort.immature)} recent contacts excluded until mature.
      Each stage counts a contact once. Historical evidence is assessed as of
      this report.
    </Note>
  );
}
export function OutcomeTrend({ insights }: { insights: DecisionInsights }) {
  const [metric, setMetric] = useState("revenue");
  return (
    <ChartPanel
      title="How outcomes are changing"
      subtitle={
        metric === "revenue"
          ? "CRM-linked billed revenue by invoice date · BDT"
          : "Strict verified visits by appointment date · recent dates remain blank"
      }
      action={
        <Filter
          label="Trend"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "revenue", label: "Billed revenue" },
            { value: "verified", label: "Verified visits" },
          ]}
        />
      }
    >
      <TrendChart
        data={insights.daily}
        series={[
          {
            key: metric,
            label:
              metric === "revenue"
                ? "CRM billed revenue (BDT)"
                : "Evidence-verified visits",
            color: "#0f766e",
          },
        ]}
        currency={metric === "revenue"}
      />
      <Note>
        {metric === "revenue"
          ? "Billed revenue is not cash collected. Current-period billing may still be incomplete."
          : "Evidence can arrive late. A drop in verified visits may reflect unresolved records, not a drop in clinical attendance."}
      </Note>
    </ChartPanel>
  );
}
export function DecisionPanels({
  tab,
  metrics,
  previous,
  compare,
  insights,
  agents,
  sources,
  ads,
  onSelect,
}: Props) {
  const [horizon, setHorizon] = useState(14);
  const [channel, setChannel] = useState("incoming");
  const [agent, setAgent] = useState("");
  const cohort =
    insights.cohorts.find((c) => c.horizon === horizon) ?? insights.cohorts[0];
  const people = agents.filter(isHumanAgent);
  const other = agents.filter((a) => !isHumanAgent(a));
  const active = people.find((a) => a.agent === agent) ?? people[0];
  const attendance = metrics.attendance;
  const sourceCounts = sources
    .filter((s) => s.leads > 0)
    .map((s) => ({ label: s.source, count: s.leads }));
  const periodOutcomes = insights.attempt_outcomes.map((r) => ({
    ...r,
    label: humanize(r.label),
  }));
  const noCohort = (
    <Empty text="No mature contacts for this window. Choose an earlier reporting period or a shorter follow-up window." />
  );
  const purpose =
    channel === "confirmation" ? "Confirmation rate" : "Recorded booking rate";
  const channelNumerator = (a: AgentRow) =>
    channel === "incoming"
      ? a.incoming_booked
      : channel === "outgoing_leads"
        ? a.outgoing_leads_booked
        : channel === "outbound"
          ? a.outbound_booked
          : a.confirmation_confirmed;
  const channelDenominator = (a: AgentRow) =>
    channel === "incoming"
      ? a.incoming
      : channel === "outgoing_leads"
        ? a.outgoing_leads
        : channel === "outbound"
          ? a.outbound
          : a.confirmation;
  if (tab === "overview")
    return (
      <ExecutiveOverview
        metrics={metrics}
        previous={previous}
        compare={compare}
        onSelect={onSelect}
        outcomeTrend={<OutcomeTrend insights={insights} />}
      />
    );
  if (tab === "agents")
    return (
      <div className="space-y-5">
        <PageIntro
          eyebrow="Team performance"
          title="Workload and outcomes, in context"
        >
          Compare the same call purpose. Rates describe recorded activity, not
          an agent’s causal contribution to visits or revenue.
        </PageIntro>
        <div className={statGrid}>
          <Stat
            label="Active human agents"
            value={people.length}
            sub="At least one recorded call; system and unassigned rows excluded"
          />
          <Stat
            label="Recorded calls"
            value={formatNumber(
              agents.reduce(
                (n, a) =>
                  n +
                  a.incoming +
                  a.outgoing_leads +
                  a.outbound +
                  a.confirmation,
                0,
              ),
            )}
            sub="Incoming, outgoing, outbound and confirmation"
          />
          <Stat
            label="Outbound bookings"
            value={formatNumber(
              agents.reduce((n, a) => n + a.outbound_booked, 0),
            )}
            sub="Recorded booked-appointment outcomes"
          />
          <Stat
            label="Confirmation attempts"
            value={formatNumber(agents.reduce((n, a) => n + a.confirmation, 0))}
            sub="Confirmation is a separate purpose, not a booking opportunity"
          />
        </div>
        <div className={grid}>
          <ChartPanel
            title="Where the workload sits"
            subtitle="Recorded calls by agent and purpose · shared count scale"
          >
            <StackedBars
              rows={people.map((a) => ({
                label: a.agent,
                values: {
                  incoming: a.incoming,
                  outgoing_leads: a.outgoing_leads,
                  outbound: a.outbound,
                  confirmation: a.confirmation,
                },
              }))}
              series={CALL_SERIES}
            />
          </ChartPanel>
          <ChartPanel
            title={purpose}
            subtitle="Numerator / attempts shown for every agent · fixed 0–100% scale"
            action={
              <Filter
                label="Call purpose"
                value={channel}
                onChange={setChannel}
                options={CALL_SERIES.map((s) => ({
                  value: s.key,
                  label: s.label,
                }))}
              />
            }
          >
            <RateDots
              rows={people.map((a) => ({
                label: a.agent,
                numerator: channelNumerator(a),
                denominator: channelDenominator(a),
              }))}
            />
            <Note>
              Small counts and different case mixes can produce large rate
              differences. Repeated attempts are not independent patients; no
              league table or performance verdict is inferred.
            </Note>
          </ChartPanel>
        </div>
        <ChartPanel
          title="Selected agent detail"
          subtitle="Exact activity counts for coaching and investigation"
          action={
            <Filter
              label="Agent"
              value={active?.agent ?? ""}
              onChange={setAgent}
              options={people.map((a) => ({ value: a.agent, label: a.agent }))}
            />
          }
        >
          {active ? (
            <>
              <DataTable
                headers={["Purpose", "Attempts", "Recorded outcome", "Rate"]}
                rows={[
                  [
                    "Incoming",
                    active.incoming,
                    `${active.incoming_booked} booked`,
                    rateText(active.incoming_booked, active.incoming),
                  ],
                  [
                    "Outgoing",
                    active.outgoing_leads,
                    `${active.outgoing_leads_booked} booked`,
                    rateText(
                      active.outgoing_leads_booked,
                      active.outgoing_leads,
                    ),
                  ],
                  [
                    "Outbound",
                    active.outbound,
                    `${active.outbound_booked} booked`,
                    rateText(active.outbound_booked, active.outbound),
                  ],
                  [
                    "Confirmation",
                    active.confirmation,
                    `${active.confirmation_confirmed} confirmed`,
                    rateText(
                      active.confirmation_confirmed,
                      active.confirmation,
                    ),
                  ],
                ]}
              />
              <Note>
                CRM-attributed billed revenue:{" "}
                {formatMoney(active.revenue_new + active.revenue_followup)}.
                Attribution is not a measure of agent causality.
              </Note>
            </>
          ) : (
            <Empty />
          )}
          <div className="mt-4">
            <WorkflowLink href="/call-kpis">
              Investigate recorded calls
            </WorkflowLink>
          </div>
          {other.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-slate-600">
                System, unassigned and non-call activity ({other.length} rows)
              </summary>
              <DataTable
                headers={["Recorded identity", "Calls"]}
                rows={other.map((a) => [
                  a.agent,
                  a.incoming + a.outgoing_leads + a.outbound + a.confirmation,
                ])}
              />
            </details>
          )}
        </ChartPanel>
      </div>
    );
  if (tab === "channels")
    return (
      <div className="space-y-5">
        <PageIntro eyebrow="Acquisition" title="Which sources become visits?">
          Separate contact volume from conversion after equal follow-up time.
          Recorded patient type is not proof of first-time clinical acquisition.
        </PageIntro>
        <div className={grid}>
          <ChartPanel
            title="Contact volume by source"
            subtitle="All contacts by original contact date · counts, not unique patients"
          >
            <RankedBars rows={topRows(sourceCounts)} />
            <details className="mt-5">
              <summary className="cursor-pointer text-xs font-medium text-teal-800">
                Patient type and all source counts
              </summary>
              <DataTable
                headers={["Source", "Contacts", "New", "Returning", "Unknown"]}
                rows={sources
                  .filter((s) => s.leads > 0)
                  .map((s) => [
                    s.source,
                    s.leads,
                    s.new_leads,
                    s.old_leads,
                    s.leads - s.new_leads - s.old_leads,
                  ])}
              />
            </details>
          </ChartPanel>
          <ChartPanel
            title="Contact-to-verified-visit conversion"
            subtitle="Verified contacts / mature contacts from the same source"
            action={<CohortControl horizon={horizon} setHorizon={setHorizon} />}
          >
            {cohort?.contacts ? (
              <RateDots
                rows={cohort.sources
                  .filter((s) => s.contacts > 0)
                  .map((s) => ({
                    label: s.name,
                    numerator: s.verified,
                    denominator: s.contacts,
                  }))}
              />
            ) : (
              noCohort
            )}
            {cohort && <CohortNote cohort={cohort} />}
          </ChartPanel>
        </div>
        <ChartPanel
          title="Time to first scheduled visit"
          subtitle="Days from contact to first non-cancelled scheduled visit on/after contact · bookings without a visit date are not included"
        >
          <DelayPlot rows={insights.delays} />
          <details className="mt-5">
            <summary className="cursor-pointer text-xs font-medium text-teal-800">
              All delay values and unbooked contacts
            </summary>
            <DataTable
              headers={[
                "Source",
                "Contacts",
                "With scheduled visit",
                "Median days",
                "75th percentile",
                "Without scheduled visit",
              ]}
              rows={insights.delays.map((r) => [
                r.name,
                r.contacts,
                r.scheduled,
                r.median_days == null ? "—" : Number(r.median_days.toFixed(1)),
                r.p75_days == null ? "—" : Number(r.p75_days.toFixed(1)),
                `${r.contacts - r.scheduled} (${rateText(r.contacts - r.scheduled, r.contacts)})`,
              ])}
            />
          </details>
          <Note>
            Delay statistics describe contacts who obtained a scheduled visit.
            The last column keeps the excluded contacts visible. This is
            scheduling delay, not first-response time.
          </Note>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium text-teal-800">
              Catchment areas
            </summary>
            <RankedBars
              rows={(metrics.by_location ?? []).map((r) => ({
                label: r.area,
                count: r.count,
              }))}
            />
            <Note>
              Recorded areas among contacts; free-text geography may be
              incomplete.
            </Note>
          </details>
        </ChartPanel>
      </div>
    );
  if (tab === "funnel")
    return (
      <div className="space-y-5">
        <PageIntro
          eyebrow="Follow-ups"
          title="Turn follow-up work into next steps"
        >
          Read cohort outcomes separately from today’s open work. Queue age
          measures elapsed days since creation, not a promised callback
          deadline.
        </PageIntro>
        <div className={grid}>
          <ChartPanel
            title="One contact cohort, one observation window"
            subtitle="Distinct contacts followed to a scheduled and evidence-verified visit"
            action={<CohortControl horizon={horizon} setHorizon={setHorizon} />}
          >
            {cohort?.contacts ? (
              <>
                <RankedBars
                  rows={[
                    { label: "Mature contacts", count: cohort.contacts },
                    {
                      label: `Scheduled visit within ${horizon} days`,
                      count: cohort.scheduled,
                    },
                    {
                      label: `Verified visit within ${horizon} days`,
                      count: cohort.verified,
                    },
                  ]}
                />
                <DataTable
                  headers={["Conversion", "Rate"]}
                  rows={[
                    [
                      "Contact → scheduled visit",
                      rateText(cohort.scheduled, cohort.contacts),
                    ],
                    [
                      "Contact → verified visit",
                      rateText(cohort.verified, cohort.contacts),
                    ],
                  ]}
                />
              </>
            ) : (
              noCohort
            )}
            {cohort && <CohortNote cohort={cohort} />}
          </ChartPanel>
          <ChartPanel
            title="Age of the open callback queue"
            subtitle={`${formatNumber(insights.queue.total)} open items · full queue as of this report · not date-range filtered`}
            action={
              <WorkflowLink href="/outgoing-calls">Work the queue</WorkflowLink>
            }
          >
            <RankedBars rows={insights.queue.age} color="#b45309" />
            <details className="mt-5">
              <summary className="cursor-pointer text-xs font-medium text-teal-800">
                Open items by category
              </summary>
              <RankedBars
                rows={topRows(
                  insights.queue.categories.map((r) => ({
                    ...r,
                    label: humanize(r.label),
                  })),
                )}
              />
            </details>
          </ChartPanel>
        </div>
        <ChartPanel
          title="What happened on outbound attempts"
          subtitle="Structured recorded outcomes by call date · every attempt counted once"
        >
          <RankedBars rows={periodOutcomes} />
          <Note>
            These are attempt outcomes, not nested funnel stages or unique
            people. No classification from free-text notes is used.
          </Note>
        </ChartPanel>
      </div>
    );
  if (tab === "revenue")
    return (
      <div className="space-y-5">
        <PageIntro
          eyebrow="Revenue"
          title="Billed revenue, with a clear boundary"
        >
          Use the CRM-linked invoice population to track revenue. The wider
          acquisition ledger is shown separately and must not be added to it.
        </PageIntro>
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label="CRM-attributed billed revenue"
            value={formatMoney(metrics.total_revenue)}
            sub="Validated, deduplicated invoices dated in this period"
          />
          <Stat
            label="Linked invoices"
            value={formatNumber(metrics.validation?.attributed_invoice_count)}
            sub="Billed amounts do not establish collection"
          />
        </div>
        <div className={grid}>
          <OutcomeTrend insights={insights} />
          <ChartPanel
            title="CRM-attributed revenue by source"
            subtitle="The same invoice population as the headline · BDT"
          >
            <RankedBars
              rows={topRows(
                (metrics.revenue_by_source ?? []).map((r) => ({
                  label: r.source,
                  count: r.revenue,
                })),
              )}
              formatter={formatMoney}
            />
          </ChartPanel>
        </div>
        <ChartPanel
          title="Coverage of the separate acquisition ledger"
          subtitle="Patients with and without CRM contacts · invoice value, not marketing ROI"
        >
          {metrics.revenue_scope ? (
            <>
              <StackedBars
                percent
                rows={[
                  {
                    label: "Acquisition ledger billed revenue (BDT)",
                    values: {
                      assigned:
                        metrics.revenue_scope.acquisition_ledger_total -
                        metrics.revenue_scope.unattributed_acquisition,
                      unknown: metrics.revenue_scope.unattributed_acquisition,
                    },
                  },
                ]}
                series={[
                  {
                    key: "assigned",
                    label: "Assigned acquisition source",
                    color: "#0f766e",
                  },
                  {
                    key: "unknown",
                    label: "Unattributed / historical",
                    color: "#d97706",
                  },
                ]}
              />
              <Note>
                Total:{" "}
                {formatMoney(metrics.revenue_scope.acquisition_ledger_total)}.
                This ledger overlaps the CRM-linked subset; the totals are not
                additive. Attribution is not proof of incremental revenue.
              </Note>
            </>
          ) : (
            <Empty text="Acquisition-ledger coverage is unavailable." />
          )}
        </ChartPanel>
      </div>
    );
  if (tab === "sources")
    return (
      <div className="space-y-5">
        <PageIntro
          eyebrow="Attribution"
          title="How complete is the source story?"
        >
          A recorded source supports classification. It does not by itself
          validate campaign causality or establish a first-time patient.
        </PageIntro>
        <div className={grid}>
          <ChartPanel
            title="Contact source completeness"
            subtitle="All contacts in the selected contact-date period"
          >
            <StackedBars
              percent
              rows={[
                {
                  label: "Contacts",
                  values: {
                    known: insights.attribution.known_source,
                    unknown: insights.attribution.unknown_source,
                  },
                },
              ]}
              series={[
                { key: "known", label: "Source recorded", color: "#0f766e" },
                { key: "unknown", label: "Unknown source", color: "#d97706" },
              ]}
            />
            <Note>
              Canonical source where available; otherwise the recorded CRM
              source.
            </Note>
          </ChartPanel>
          <ChartPanel
            title="Invoice matches needing review"
            subtitle="Review records by invoice date · counts may include candidates for the same invoice"
            action={
              <WorkflowLink href="/admin/marketing-review">
                Review attribution
              </WorkflowLink>
            }
          >
            <RankedBars
              rows={insights.attribution.review_reasons.map((r) => ({
                ...r,
                label: humanize(r.label),
              }))}
              color="#b45309"
            />
          </ChartPanel>
        </div>
        <ChartPanel
          title="Fields available for analysis"
          subtitle="Each field uses all contacts as its denominator · fields overlap and must not be added"
        >
          <RateDots
            rows={insights.attribution.fields.map((r) => ({
              label: r.label,
              numerator: r.count,
              denominator: metrics.total_leads ?? 0,
            }))}
          />
          <Note>
            Presence is not correctness. Unknown values remain visible instead
            of being reassigned to a better-performing source.
          </Note>
        </ChartPanel>
      </div>
    );
  if (tab === "quality")
    return (
      <div className="space-y-5">
        <PageIntro
          eyebrow="Data quality"
          title="See what is verified—and what is still open"
        >
          Missing invoice evidence does not prove nonattendance. No-charge care
          needs a separate clinical evidence source.
        </PageIntro>
        <div className={statGrid}>
          <Stat
            label="Eligible appointments"
            value={formatNumber(attendance.eligible)}
            sub={`Appointment dates through ${attendance.eligible_through}`}
          />
          <Stat
            label="Evidence-verified"
            value={formatNumber(attendance.verified)}
            sub={`${rateText(attendance.verified, attendance.eligible)} of eligible appointments`}
          />
          <Stat
            label="Unresolved evidence"
            value={formatNumber(attendance.unresolved)}
            sub="Requires outcome or evidence reconciliation"
          />
          <Stat
            label="Not yet eligible"
            value={formatNumber(attendance.awaiting_maturity)}
            sub="Recent or future appointments; not included below"
          />
        </div>
        <ChartPanel
          title="One eligible appointment population"
          subtitle="Every eligible appointment appears in exactly one outcome"
          action={
            <WorkflowLink href="/admin/mis-upload">
              Inspect MIS evidence
            </WorkflowLink>
          }
        >
          <StackedBars
            percent
            rows={[
              {
                label: "Eligible appointments",
                values: {
                  verified: attendance.verified,
                  no_show: attendance.explicit_no_show,
                  unresolved: attendance.unresolved,
                },
              },
            ]}
            series={OUTCOME_SERIES}
          />
          <Note>
            {attendance.excluded} cancelled/rescheduled appointments excluded.
            One complete Bangladesh calendar day is allowed for evidence.
            Verified coverage is not a final clinical show rate.
          </Note>
        </ChartPanel>
        <div className={grid}>
          <ChartPanel
            title="Age of unresolved appointments"
            subtitle="Days since scheduled visit as of this report · selected period only"
          >
            <RankedBars rows={insights.quality.age} color="#b45309" />
          </ChartPanel>
          <ChartPanel
            title="Why evidence remains unresolved"
            subtitle="Exclusive reporting categories; underlying records are not modified"
          >
            <RankedBars rows={insights.quality.reasons} color="#b45309" />
          </ChartPanel>
        </div>
      </div>
    );
  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="Ad performance"
        title="Campaign outcomes backed by evidence"
      >
        Contact dates, appointment dates and invoice dates describe different
        period populations. Use the cohort view for comparable conversion.
      </PageIntro>
      <div className={grid}>
        <ChartPanel
          title="Campaign cohort conversion"
          subtitle="Verified contacts / mature campaign contacts"
          action={<CohortControl horizon={horizon} setHorizon={setHorizon} />}
        >
          {cohort?.campaigns.some((c) => c.contacts > 0) ? (
            <RateDots
              rows={cohort.campaigns
                .filter((c) => c.contacts > 0)
                .map((c) => ({
                  label: c.name,
                  numerator: c.verified,
                  denominator: c.contacts,
                }))}
            />
          ) : (
            <Empty text="No mature attributed campaign contacts in this window. Change the period or inspect attribution coverage." />
          )}
          {cohort && (
            <CohortNote
              cohort={{
                ...cohort,
                immature: cohort.campaigns.reduce(
                  (sum, row) => sum + row.immature,
                  0,
                ),
              }}
            />
          )}
        </ChartPanel>
        <ChartPanel
          title="Campaign contact volume"
          subtitle="Contacts logged in the selected period · grouped by campaign"
        >
          {ads.length ? (
            <RankedBars
              rows={topRows(
                Object.values(
                  ads.reduce<Record<string, { label: string; count: number }>>(
                    (map, a) => {
                      const key = a.campaign_id;
                      map[key] ??= { label: a.campaign_name || key, count: 0 };
                      map[key].count += a.leads;
                      return map;
                    },
                    {},
                  ),
                ),
              )}
            />
          ) : (
            <Empty text="No attributed ad records for this period." />
          )}
          <Note>
            Spend, currency and an agreed attribution window are required before
            CAC or ROAS can be shown.
          </Note>
          <div className="mt-4">
            <WorkflowLink href="/admin/marketing-review">
              Inspect attribution
            </WorkflowLink>
          </div>
        </ChartPanel>
      </div>
      <ChartPanel
        title="Ad-level period detail"
        subtitle="Scheduled-contact counts include linked appointments at any date; eligible visit rates use mature appointment dates. Revenue uses acquisition-attributed invoices, not the CRM subset."
      >
        <DataTable
          headers={[
            "Campaign / ad",
            "Contacts",
            "Contacts with appointment",
            "All appointments",
            "Eligible",
            "Verified / eligible",
            "Unresolved",
            "Billed revenue",
          ]}
          rows={ads.map((a) => {
            const e = insights.ad_eligible.find(
              (e) => e.campaign_id === a.campaign_id && e.ad_id === a.ad_id,
            );
            return [
              <span key="ad" className="block min-w-40">
                <strong className="block font-medium">
                  {a.campaign_name || a.campaign_id}
                </strong>
                <span className="text-xs text-slate-600">
                  {a.ad_name || a.ad_id || "Unspecified ad"}
                </span>
              </span>,
              a.leads,
              a.booked,
              a.appointments,
              e?.eligible ?? "—",
              e
                ? `${a.completed} / ${e.eligible} (${rateText(a.completed, e.eligible)})`
                : "—",
              e?.unresolved ?? "—",
              formatMoney(a.revenue),
            ];
          })}
        />
      </ChartPanel>
    </div>
  );
}
