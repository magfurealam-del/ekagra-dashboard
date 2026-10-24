# MIS ingestion: production operation

The production upload page is available at https://project-sbcum.vercel.app/admin/mis-upload. Active administrators can upload the approved UTF-8 CSV, review validation and reconciliation status, and retry eligible failed invoice jobs. Processing runs in the configured overnight window.

The original source file and normalized rows are retained as append-only evidence. Every upload is treated as an authoritative snapshot for invoices present in that file: included invoices are fully replaced, while absent invoices are unchanged. Exact file replays resume their original receipt. Verify the export before upload because the format has no revision marker to identify an accidental stale snapshot.

Uploads must match the approved MIS export structure and fit within the 20 MiB / 50,000-row limit. Select the correct age reference year. Any rejected row prevents the invoice batch from entering the worker. Review invoice-level errors and resolve them before retrying.

The worker runs on the configured overnight schedule. Database checks enforce the Dhaka processing window. Canonical invoices commit individually; finance, patient lifetime attribution, CRM contact history, and dashboard summaries publish in later stages. Wait for the upload status to show downstream publication complete before treating reports as current.

After upload, reconcile signed source totals and invoice counts against the protected review view. Investigate failed jobs and confirm that the queue drains and the same file remains unchanged.
