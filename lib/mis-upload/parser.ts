import { createHash } from 'node:crypto'
import { parse } from 'csv-parse/sync'

export const MIS_CSV_SCHEMA_VERSION = 'ekagra-mis-csv-v1'
export const MIS_CSV_PARSER_VERSION = 'mis-csv-parser-v1'
export const MIS_CSV_NORMALIZATION_VERSION = 'mis-normalization-v1'
export const MAX_MIS_CSV_BYTES = 20 * 1024 * 1024
export const MAX_MIS_CSV_ROWS = 50_000
export const MAX_MIS_CSV_RECORD_SIZE = 64 * 1024

const HEADER_FIELDS = [
  ['Doctors Deparment', 'doctors_department'],
  ['Hospital Number', 'hospital_number'],
  ['Patient Name', 'patient_name'],
  ['Gender Data', 'gender'],
  ['Age', 'age'],
  ['Phone Mobile', 'phone_mobile'],
  ['M Status Data', 'marital_status'],
  ['Blood Group', 'blood_group'],
  ['Address', 'address'],
  ['Patient Type', 'patient_type'],
  ['Bill Module Name', 'bill_module_name'],
  ['Admission Id', 'admission_id'],
  ['Admission Date', 'admission_date'],
  ['Dis Date', 'discharge_date'],
  ['Invoice Id', 'invoice_id'],
  ['Invoice By', 'invoice_by'],
  ['Invoice Date', 'invoice_date'],
  ['Invoice Datetime', 'invoice_datetime'],
  ['Doctor Name', 'doctor_name'],
  ['Second Doctor Name', 'second_doctor_name'],
  ['Contributor Doctor Name', 'contributor_doctor_name'],
  ['Mpo Name', 'mpo_name'],
  ['Parent Itemtype Name', 'parent_item_type_name'],
  ['Item Type Name', 'item_type_name'],
  ['Bu Name', 'business_unit_name'],
  ['Item Id', 'item_id'],
  ['Item Name', 'item_name'],
  ['Sales Amt', 'sales_amount'],
  ['Item Disc', 'item_discount'],
  ['Net Sales', 'net_sales'],
  ['Net Coll', 'net_collection'],
  ['Cancel Amt', 'cancellation_amount'],
] as const

const CANONICAL_HEADERS = new Map(
  HEADER_FIELDS.map(([source, target]) => [normalizeHeader(source), target]),
)

// These fields are NOT NULL in the current public.mis_reports contract. Keep
// rows with missing values in immutable staging, but prevent them from being
// treated as import-ready until the canonical schema/business contract changes.
const REQUIRED_TEXT_FIELDS = [
  'hospital_number',
  'patient_name',
  'phone_mobile',
  'patient_type',
  'bill_module_name',
  'invoice_id',
  'invoice_by',
  'parent_item_type_name',
  'item_type_name',
  'item_id',
  'item_name',
] as const
const REQUIRED_MONEY_FIELDS = [
  'sales_amount',
  'item_discount',
  'net_sales',
  'net_collection',
  'cancellation_amount',
] as const

export type MisUploadIssue = {
  sourceRowNumber: number
  field: string
  code: 'required_value_missing' | 'invalid_date' | 'invalid_age' | 'invalid_money'
}

export type ParsedMisRow = {
  sourceRowNumber: number
  rawCells: string[]
  normalizedValues: Record<string, string | number | null>
  rowSha256: string
}

export type ParsedMisCsv = {
  schemaVersion: typeof MIS_CSV_SCHEMA_VERSION
  parserVersion: typeof MIS_CSV_PARSER_VERSION
  referenceYear: number
  headers: string[]
  canonicalHeaders: string[]
  headerSha256: string
  rowsetSha256: string
  sourceRowCount: number
  blankRecordCount: number
  rows: ParsedMisRow[]
  issues: MisUploadIssue[]
}

export class MisCsvParseError extends Error {
  readonly code:
    | 'file_too_large'
    | 'invalid_encoding'
    | 'not_csv'
    | 'invalid_csv'
    | 'invalid_header'
    | 'too_many_rows'
    | 'invalid_reference_year'

  constructor(message: string, code: MisCsvParseError['code']) {
    super(message)
    this.name = 'MisCsvParseError'
    this.code = code
  }
}

function normalizeHeader(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function parseIsoDate(value: string): string | null {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value.trim())) return null
  const [day, month, year] = value.trim().split('/').map(Number)
  if (year < 1890 || year > 2200) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseAge(value: string, referenceYear: number): { years: number; birthYear: number } | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{1,3}$/.test(trimmed)) {
    const years = Number(trimmed)
    return years <= 130 ? { years, birthYear: referenceYear - years } : null
  }

  const match = trimmed.match(/^(?:(\d{1,3})\s*Y)?\s*(?:(\d{1,2})\s*M)?\s*(?:(\d{1,2})\s*D)?$/i)
  if (!match || !match[1] && !match[2] && !match[3]) return null
  const years = Number(match[1] ?? 0)
  const months = Number(match[2] ?? 0)
  const days = Number(match[3] ?? 0)
  if (years > 130 || months > 11 || days > 31 || referenceYear - years < 1890) return null
  return { years, birthYear: referenceYear - years }
}

function parseMoney(value: string): string | null {
  const trimmed = value.trim()
  if (!/^-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(trimmed)) return null

  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [wholeText, fraction = ''] = unsigned.split('.')
  const whole = (wholeText || '0').replace(/^0+(?=\d)/, '')
  if (whole.length > 14) return null // numeric(18,4)

  const normalizedFraction = fraction.replace(/0+$/, '')
  const isZero = /^0+$/.test(whole) && normalizedFraction.length === 0
  return `${negative && !isZero ? '-' : ''}${whole}${normalizedFraction ? `.${normalizedFraction}` : ''}`
}

export function parseMisCsv(
  input: Uint8Array,
  options: { referenceYear?: number } = {},
): ParsedMisCsv {
  const candidateReferenceYear = options.referenceYear
  if (input.byteLength > MAX_MIS_CSV_BYTES) {
    throw new MisCsvParseError('CSV exceeds the 20 MiB intake limit.', 'file_too_large')
  }
  if (typeof candidateReferenceYear !== 'number' ||
    !Number.isInteger(candidateReferenceYear) ||
    candidateReferenceYear < 1890 ||
    candidateReferenceYear > 2200) {
    throw new MisCsvParseError('Reference year is outside the supported range.', 'invalid_reference_year')
  }
  if (input.includes(0)) throw new MisCsvParseError('NUL bytes are not allowed in CSV.', 'not_csv')

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input)
  } catch {
    throw new MisCsvParseError('CSV must use UTF-8 encoding.', 'invalid_encoding')
  }

  let records: string[][]
  try {
    records = parse(text, {
      bom: true,
      columns: false,
      skip_empty_lines: false,
      relax_column_count: true,
      max_record_size: MAX_MIS_CSV_RECORD_SIZE,
    }) as string[][]
  } catch (error) {
    throw new MisCsvParseError(
      error instanceof Error ? error.message : 'CSV structure is invalid.',
      'invalid_csv',
    )
  }

  const [header, ...dataRecords] = records
  if (!header || header.length !== HEADER_FIELDS.length) {
    throw new MisCsvParseError(`Expected ${HEADER_FIELDS.length} MIS columns.`, 'invalid_header')
  }

  const canonicalHeaders = header.map((value) => CANONICAL_HEADERS.get(normalizeHeader(value)))
  if (canonicalHeaders.some((value) => !value)) {
    throw new MisCsvParseError('CSV contains an unrecognized MIS column header.', 'invalid_header')
  }
  if (new Set(canonicalHeaders).size !== HEADER_FIELDS.length) {
    throw new MisCsvParseError('CSV contains duplicate MIS column headers.', 'invalid_header')
  }
  if (dataRecords.length > MAX_MIS_CSV_ROWS) {
    throw new MisCsvParseError('CSV exceeds the 50,000 record intake limit.', 'too_many_rows')
  }

  const referenceYear = candidateReferenceYear
  const headerSha256 = sha256(JSON.stringify(canonicalHeaders))
  const rowset = createHash('sha256')
  const rows: ParsedMisRow[] = []
  const issues: MisUploadIssue[] = []
  let blankRecordCount = 0

  dataRecords.forEach((rawCells, index) => {
    const sourceRowNumber = index + 2
    if (rawCells.every((cell) => cell === '')) {
      blankRecordCount += 1
      return
    }
    if (rawCells.length !== header.length) {
      throw new MisCsvParseError(
        `CSV record ${sourceRowNumber} has ${rawCells.length} fields; expected ${header.length}.`,
        'invalid_csv',
      )
    }

    const normalizedValues: Record<string, string | number | null> = {}
    const record = Object.fromEntries(
      (canonicalHeaders as string[]).map((field, cellIndex) => [field, rawCells[cellIndex]]),
    ) as Record<string, string>

    for (const [field, value] of Object.entries(record)) {
      if (field.endsWith('_date') || field === 'invoice_datetime') {
        if (!value.trim()) normalizedValues[field] = null
        else {
          const isoDate = parseIsoDate(value)
          normalizedValues[field] = isoDate
          if (!isoDate) issues.push({ sourceRowNumber, field, code: 'invalid_date' })
        }
      } else if (field === 'age') {
        if (!value.trim()) {
          normalizedValues.age_years = null
          normalizedValues.birth_year = null
          issues.push({ sourceRowNumber, field, code: 'required_value_missing' })
        } else {
          const age = parseAge(value, referenceYear)
          normalizedValues.age_years = age?.years ?? null
          normalizedValues.birth_year = age?.birthYear ?? null
          if (!age) issues.push({ sourceRowNumber, field, code: 'invalid_age' })
        }
      } else if ((REQUIRED_MONEY_FIELDS as readonly string[]).includes(field)) {
        const amount = parseMoney(value)
        normalizedValues[field] = amount
        if (!amount) {
          issues.push({
            sourceRowNumber,
            field,
            code: value.trim() ? 'invalid_money' : 'required_value_missing',
          })
        }
      } else {
        normalizedValues[field] = emptyToNull(value)
      }
    }

    for (const field of REQUIRED_TEXT_FIELDS) {
      if (!String(normalizedValues[field] ?? '').trim()) {
        issues.push({ sourceRowNumber, field, code: 'required_value_missing' })
      }
    }
    for (const field of ['invoice_date', 'invoice_datetime'] as const) {
      if (!normalizedValues[field]) {
        issues.push({ sourceRowNumber, field, code: 'required_value_missing' })
      }
    }

    const rowSha256 = sha256(JSON.stringify(rawCells))
    rowset.update(`${sourceRowNumber}:${rowSha256}\n`)
    rows.push({ sourceRowNumber, rawCells, normalizedValues, rowSha256 })
  })

  return {
    schemaVersion: MIS_CSV_SCHEMA_VERSION,
    parserVersion: MIS_CSV_PARSER_VERSION,
    referenceYear,
    headers: header,
    canonicalHeaders: canonicalHeaders as string[],
    headerSha256,
    rowsetSha256: rowset.digest('hex'),
    sourceRowCount: rows.length,
    blankRecordCount,
    rows,
    issues,
  }
}
