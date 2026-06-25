"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { LookupItem } from "@/types";

interface Dropdowns {
  doctors: LookupItem[];
  callCategories: LookupItem[];
  sources: LookupItem[];
  appointmentStatuses: LookupItem[];
  finalStatuses: LookupItem[];
  patientNewOld: LookupItem[];
  leadCategories: LookupItem[];
  internalLeadCategories: LookupItem[];
  agents: LookupItem[];
  adCampaigns: LookupItem[];
  callOutcomes: LookupItem[];
  priorities: LookupItem[];
  timeSlots: LookupItem[];
}

export function useDropdowns() {
  const [dropdowns, setDropdowns] = useState<Dropdowns>({
    doctors: [], callCategories: [], sources: [], appointmentStatuses: [],
    finalStatuses: [], patientNewOld: [], leadCategories: [], internalLeadCategories: [],
    agents: [], adCampaigns: [], callOutcomes: [], priorities: [], timeSlots: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const tables = [
        ["lookup_doctors", "doctors"],
        ["lookup_call_categories", "callCategories"],
        ["lookup_sources_of_appointment", "sources"],
        ["lookup_appointment_statuses", "appointmentStatuses"],
        ["lookup_final_statuses", "finalStatuses"],
        ["lookup_patient_new_old", "patientNewOld"],
        ["lookup_lead_categories", "leadCategories"],
        ["lookup_internal_lead_categories", "internalLeadCategories"],
        ["lookup_call_center_agents", "agents"],
        ["lookup_ad_campaigns", "adCampaigns"],
        ["lookup_call_outcomes", "callOutcomes"],
        ["lookup_followup_priorities", "priorities"],
        ["lookup_appointment_time_slots", "timeSlots"],
      ] as const;

      const results = await Promise.all(
        tables.map(([table]) =>
          supabase.from(table).select("*").eq("is_active", true).order("sort_order")
        )
      );

      const merged: Partial<Dropdowns> = {};
      tables.forEach(([, key], i) => {
        merged[key] = (results[i].data || []) as LookupItem[];
      });

      setDropdowns(merged as Dropdowns);
      setLoading(false);
    }
    fetch();
  }, []);

  return { dropdowns, loading };
}
