import { Suspense } from "react";
import Link from "next/link";
import JoinFrameClient from "./JoinFrameClient";
import { verifyInviteTokenServer } from "@/lib/invite-auth";

export const dynamic = "force-dynamic";

interface JoinFramePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function JoinFramePage({ searchParams }: JoinFramePageProps) {
  const query = await searchParams;
  const rawToken = typeof query.token === "string" ? query.token : "";
  const rawFrameId = typeof query.frameId === "string" ? query.frameId : "";

  let isValid = false;
  let validatedFrameId = rawFrameId;

  if (rawToken) {
    const claims = verifyInviteTokenServer(rawToken);
    if (claims && (!rawFrameId || claims.room === rawFrameId)) {
      isValid = true;
      validatedFrameId = claims.room;
    } else if (!claims && process.env.WS_INTERNAL_URL) {
      try {
        const verifyRes = await fetch(
          `${process.env.WS_INTERNAL_URL}/api/invites/verify?token=${encodeURIComponent(rawToken)}`,
          { cache: "no-store", signal: AbortSignal.timeout(3000) }
        );
        if (verifyRes.ok) {
          const data = (await verifyRes.json()) as { valid?: boolean; frameId?: string };
          if (data.valid && data.frameId) {
            isValid = true;
            validatedFrameId = data.frameId;
          }
        }
      } catch {
        // invalid or unreachable
      }
    }
  }

  if (!isValid || !validatedFrameId) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-md border border-slate-200 max-w-md w-full p-8 text-center space-y-4">
          <h1 className="text-xl font-extrabold text-slate-900">Tautan Undangan Tidak Valid</h1>
          <p className="text-sm text-slate-600">
            Tautan undangan sudah kadaluarsa, rusak, atau frame telah ditutup oleh pemiliknya.
          </p>
          <Link
            href="/"
            className="inline-block w-full py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm transition-colors"
          >
            Kembali ke Beranda
          </Link>
        </div>
      </main>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center">Memuat undangan...</div>}>
      <JoinFrameClient validatedFrameId={validatedFrameId} inviteToken={rawToken} />
    </Suspense>
  );
}
