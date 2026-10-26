export function invoiceLookupKey(row: { patient_id?: number | null; invoice_check_date?: string | null }) {
  return row.patient_id != null && row.invoice_check_date
    ? `${row.patient_id}:${row.invoice_check_date}`
    : null
}
