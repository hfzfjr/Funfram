import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h1 className="text-2xl font-extrabold text-slate-900">Kebijakan Privasi FunFram</h1>
          <Link href="/" className="text-sm font-semibold text-sky-600 hover:underline">
            Kembali ke Beranda
          </Link>
        </div>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-base font-bold text-slate-900">1. Prinsip Minimisasi Data (UU PDP)</h2>
          <p>
            FunFram dirancang dengan prinsip privasi sejak awal. Anda dapat menggunakan aplikasi
            dengan nama tampilan pilihan tanpa wajib mengunggah kartu identitas di tahap awal.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-base font-bold text-slate-900">2. Video, Audio &amp; Pesan Obrolan</h2>
          <p>
            Streaming video dan audio dikirim langsung antar-peramban (WebRTC P2P) atau melalui
            relay terenkripsi (Cloudflare TURN) dan <strong>tidak disimpan</strong> oleh server
            kami. Pesan obrolan sesi bersifat sementara dan terhapus otomatis saat sesi berakhir.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-base font-bold text-slate-900">3. Data Keamanan &amp; Moderasi</h2>
          <p>
            Untuk mencegah penyalahgunaan dan menegakkan pemblokiran, sistem mencatat metadata teknis
            minimal (seperti alamat IP ter-hash, log laporan pelanggaran, dan persetujuan usia 18+).
          </p>
        </section>
      </div>
    </main>
  );
}
