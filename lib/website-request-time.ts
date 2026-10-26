/** Website submission time, always displayed in the clinic's timezone. */
export function formatWebsiteRequestTime(value: string | null | undefined): string | null {
  // A date without an offset is not an authoritative submission timestamp.
  if (!value || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date)} BDT`
}
