import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h1 className="text-2xl font-extrabold text-slate-900">Syarat &amp; Ketentuan FunFram</h1>
          <Link href="/" className="text-sm font-semibold text-sky-600 hover:underline">
            Kembali ke Beranda
          </Link>
        </div>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-base font-bold text-slate-900">1. Batas Usia Minimal (18+)</h2>
          <p>
            FunFram hanya ditujukan bagi pengguna berusia <strong>18 tahun ke atas</strong>. Dengan
            menggunakan layanan ini, Anda menyatakan dan menjamin bahwa Anda telah berusia minimal
            18 tahun. Pengguna di bawah umur dilarang mengakses atau menggunakan fitur panggilan
            video acak.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-base font-bold text-slate-900">2. Perilaku &amp; Konten yang Dilarang</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Dilarang menampilkan ketelanjangan, konten pornografi/NSFW, atau tindakan seksual.</li>
            <li>Dilarang melakukan pelecehan, ujaran kebencian, ancaman, perundungan, atau penipuan.</li>
            <li>Dilarang merekam atau menyebarkan video lawan bicara tanpa persetujuan.</li>
            <li>Dilarang menggunakan bot, skrip otomatis, atau memanipulasi trafik sistem.</li>
          </ul>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-base font-bold text-slate-900">3. Pelaporan &amp; Pemblokiran</h2>
          <p>
            Pengguna dapat menekan tombol <strong>Laporkan</strong> kapan saja selama panggilan.
            Pengguna yang dilaporkan akan langsung diblokir dari pertemuan berikutnya dan dapat
            dikenai pemblokiran permanen sesuai ketentuan hukum Indonesia (UU ITE, UU PDP, dan PP
            TUNAS).
          </p>
        </section>
      </div>
    </main>
  );
}
