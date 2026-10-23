import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_MIS_CSV_BYTES,
  MisCsvParseError,
  parseMisCsv,
} from './parser.ts'

const headers = [
  'Doctors Deparment', 'Hospital Number', 'Patient Name', 'Gender Data', 'Age',
  'Phone Mobile', 'M Status Data', 'Blood Group', 'Address', 'Patient Type',
  'Bill Module Name', 'Admission Id', 'Admission Date', 'Dis Date', 'Invoice Id',
  'Invoice By', 'Invoice Date', 'Invoice Datetime', 'Doctor Name', 'Second Doctor Name',
  'Contributor Doctor Name', 'Mpo Name', 'Parent Itemtype Name', 'Item Type Name',
  'Bu Name', 'Item Id', 'Item Name', 'Sales Amt', 'Item Disc', 'Net Sales', 'Net Coll',
  'Cancel Amt',
]

function row(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    'Hospital Number': '000123',
    'Patient Name': 'Test Patient',
    Age: '35Y 3M 21D',
    'Invoice Id': 'INV-0001',
    'Invoice Date': '01/02/2026',
    'Item Id': '0017',
    'Item Name': 'Consultation',
    'Sales Amt': '00100.2500',
    'Item Disc': '0.2500',
    'Net Sales': '100.0000',
    'Net Coll': '0.0000',
    'Cancel Amt': '0',
    ...overrides,
  }
  return headers.map((header) => values[header] ?? '').join(',')
}

function csv(dataRows: string[], headerRow = headers.join(',')) {
  return Buffer.from([headerRow, ...dataRows].join('\r\n'), 'utf8')
}

test('parses the approved MIS header and preserves raw cells, zeros and leading zeroes', () => {
  const parsed = parseMisCsv(csv([row()]))
  assert.equal(parsed.sourceRowCount, 1)
  assert.deepEqual(parsed.issues, [])
  assert.equal(parsed.rows[0].sourceRowNumber, 2)
  assert.equal(parsed.rows[0].normalizedValues.hospital_number, '000123')
  assert.equal(parsed.rows[0].normalizedValues.invoice_id, 'INV-0001')
  assert.equal(parsed.rows[0].normalizedValues.item_id, '0017')
  assert.equal(parsed.rows[0].normalizedValues.invoice_date, '2026-02-01')
  assert.equal(parsed.rows[0].normalizedValues.net_collection, '0')
  assert.equal(parsed.rows[0].rawCells[27], '00100.2500')
  assert.equal(parsed.rows[0].rowSha256.length, 64)
  assert.equal(parsed.headerSha256.length, 64)
  assert.equal(parsed.rowsetSha256.length, 64)
})

test('recognizes the age contract with a persisted reference year', () => {
  const parsed = parseMisCsv(csv([row()]), { referenceYear: 2026 })
  assert.equal(parsed.rows[0].normalizedValues.age_years, 35)
  assert.equal(parsed.rows[0].normalizedValues.birth_year, 1991)

  const replay = parseMisCsv(csv([row()]), { referenceYear: 2027 })
  assert.equal(replay.rows[0].normalizedValues.birth_year, 1992)
  assert.notEqual(parsed.rows[0].normalizedValues.birth_year, replay.rows[0].normalizedValues.birth_year)
})

test('distinguishes blank optional cells from numeric zero', () => {
  const parsed = parseMisCsv(csv([row({
    'Patient Name': '',
    'Phone Mobile': '',
    'Net Coll': '0',
  })]))
  assert.equal(parsed.rows[0].normalizedValues.patient_name, null)
  assert.equal(parsed.rows[0].normalizedValues.phone_mobile, null)
  assert.equal(parsed.rows[0].normalizedValues.net_collection, '0')
  assert.equal(parsed.issues.length, 0)
})

test('reports missing required identity and financial values without replacing them with zero', () => {
  const parsed = parseMisCsv(csv([row({ 'Hospital Number': '', 'Net Sales': '' })]))
  assert.equal(parsed.rows[0].normalizedValues.hospital_number, null)
  assert.equal(parsed.rows[0].normalizedValues.net_sales, null)
  assert.ok(parsed.issues.some((issue) => issue.field === 'hospital_number' && issue.code === 'required_value_missing'))
  assert.ok(parsed.issues.some((issue) => issue.field === 'net_sales' && issue.code === 'required_value_missing'))
})

test('counts structural blank records separately and retains the next source record number', () => {
  const parsed = parseMisCsv(csv([row(), '', row({ 'Invoice Id': 'INV-0002' })]))
  assert.equal(parsed.sourceRowCount, 2)
  assert.equal(parsed.blankRecordCount, 1)
  assert.deepEqual(parsed.rows.map((item) => item.sourceRowNumber), [2, 4])
})

test('rejects unknown, duplicate and incomplete headers', () => {
  const unknown = [...headers]
  unknown[0] = 'Unexpected Department'
  assert.throws(() => parseMisCsv(csv([row()], unknown.join(','))), (error: unknown) =>
    error instanceof MisCsvParseError && error.code === 'invalid_header')

  const duplicate = [...headers]
  duplicate[1] = duplicate[0]
  assert.throws(() => parseMisCsv(csv([row()], duplicate.join(','))), (error: unknown) =>
    error instanceof MisCsvParseError && error.code === 'invalid_header')

  assert.throws(() => parseMisCsv(csv([row()], headers.slice(1).join(','))), (error: unknown) =>
    error instanceof MisCsvParseError && error.code === 'invalid_header')
})

test('rejects ambiguous, impossible and non-DD/MM/YYYY dates', () => {
  for (const value of ['2026-02-01', '31/02/2026', '1/2/2026']) {
    const parsed = parseMisCsv(csv([row({ 'Invoice Date': value })]))
    assert.ok(parsed.issues.some((issue) => issue.field === 'invoice_date' && issue.code === 'invalid_date'))
  }
})

test('rejects malformed or over-precision decimals and preserves signed precision', () => {
  const parsed = parseMisCsv(csv([
    row({ 'Net Sales': '-00012.3400' }),
    row({ 'Invoice Id': 'INV-0002', 'Net Sales': '1.00001' }),
    row({ 'Invoice Id': 'INV-0003', 'Net Sales': '1e3' }),
  ]))
  assert.equal(parsed.rows[0].normalizedValues.net_sales, '-12.34')
  assert.ok(parsed.issues.some((issue) => issue.sourceRowNumber === 3 && issue.code === 'invalid_money'))
  assert.ok(parsed.issues.some((issue) => issue.sourceRowNumber === 4 && issue.code === 'invalid_money'))
})

test('rejects invalid UTF-8, NUL bytes and oversized uploads', () => {
  assert.throws(() => parseMisCsv(Buffer.from([0xff, 0xfe])), (error: unknown) =>
    error instanceof MisCsvParseError && error.code === 'invalid_encoding')
  assert.throws(() => parseMisCsv(Buffer.from([0])), (error: unknown) =>
    error instanceof MisCsvParseError && error.code === 'not_csv')
  assert.throws(() => parseMisCsv(Buffer.alloc(MAX_MIS_CSV_BYTES + 1)), (error: unknown) =>
    error instanceof MisCsvParseError && error.code === 'file_too_large')
})

test('rejects malformed quoting and wrong row widths', () => {
  assert.throws(() => parseMisCsv(Buffer.from(`${headers.join(',')}\n"unclosed`)), (error: unknown) =>
    error instanceof MisCsvParseError && error.code === 'invalid_csv')
  assert.throws(() => parseMisCsv(Buffer.from(`${headers.join(',')}\nshort,row`)), (error: unknown) =>
    error instanceof MisCsvParseError && error.code === 'invalid_csv')
})

test('requires an explicitly pinned supported reference year', () => {
  assert.throws(() => parseMisCsv(csv([row()]), { referenceYear: 2201 }), (error: unknown) =>
    error instanceof MisCsvParseError && error.code === 'invalid_reference_year')
})
