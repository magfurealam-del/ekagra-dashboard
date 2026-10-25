// Minimal runtime boundary for local Edge Function type checks. Deno supplies
// its complete built-in declarations when the function runs in Supabase.
declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}
